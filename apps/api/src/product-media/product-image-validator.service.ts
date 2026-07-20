import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Environment } from '../config/environment';

export interface UploadedProductImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface ValidatedProductImage {
  bytes: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_TYPES = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
} as const;

type SafeFormat = keyof typeof SAFE_TYPES;

@Injectable()
export class ProductImageValidatorService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async validate(file: UploadedProductImage | undefined): Promise<ValidatedProductImage> {
    if (!file?.buffer || file.buffer.length === 0 || file.size === 0) {
      throw new BadRequestException({
        code: 'IMAGE_FILE_REQUIRED',
        message: 'A non-empty product image file is required.',
      });
    }
    const maximumBytes = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
    if (file.size !== file.buffer.length || file.buffer.length > maximumBytes) {
      throw new PayloadTooLargeException({
        code: 'IMAGE_TOO_LARGE',
        message: `The product image must not exceed ${maximumBytes} bytes.`,
      });
    }
    if (looksLikeSvg(file.buffer) || looksExecutable(file.buffer)) {
      throw this.unsupportedType();
    }

    const format = detectFormat(file.buffer);
    if (!format) throw this.unsupportedType();
    const expected = SAFE_TYPES[format];
    if (file.mimetype.trim().toLowerCase() !== expected.contentType) {
      throw new BadRequestException({
        code: 'IMAGE_MIME_MISMATCH',
        message: 'The declared image type does not match the file signature.',
      });
    }
    if (!hasExactContainerBoundary(file.buffer, format)) {
      throw new BadRequestException({
        code: 'IMAGE_CONTAINER_INVALID',
        message: 'The image container is malformed or contains trailing content.',
      });
    }

    const maximumPixels = this.config.get('UPLOAD_MAX_PIXELS', { infer: true });
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      metadata = await sharp(file.buffer, {
        animated: true,
        failOn: 'error',
        limitInputPixels: false,
        sequentialRead: true,
      }).metadata();
    } catch {
      throw this.decodeFailed();
    }
    const width = metadata.width;
    const height = metadata.height;
    if (
      metadata.format !== format ||
      !width ||
      !height ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height)
    ) {
      throw this.decodeFailed();
    }
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > maximumPixels) {
      throw new PayloadTooLargeException({
        code: 'IMAGE_PIXEL_LIMIT_EXCEEDED',
        message: `The decoded product image must not exceed ${maximumPixels} pixels.`,
      });
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new BadRequestException({
        code: 'ANIMATED_IMAGE_NOT_ALLOWED',
        message: 'Animated or multi-page product images are not allowed.',
      });
    }

    try {
      // Decode every pixel instead of trusting metadata alone. The original bytes are retained so
      // color profiles are not rewritten; strict container-boundary checks reject appended data.
      await sharp(file.buffer, {
        animated: false,
        failOn: 'error',
        limitInputPixels: maximumPixels,
        sequentialRead: true,
      })
        .raw()
        .toBuffer();
    } catch {
      throw this.decodeFailed();
    }

    return {
      bytes: file.buffer,
      contentType: expected.contentType,
      extension: expected.extension,
      byteSize: file.buffer.length,
      checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
      width,
      height,
    };
  }

  private unsupportedType(): BadRequestException {
    return new BadRequestException({
      code: 'IMAGE_TYPE_NOT_ALLOWED',
      message: 'Only non-animated JPEG, PNG, and WebP product images are allowed.',
    });
  }

  private decodeFailed(): BadRequestException {
    return new BadRequestException({
      code: 'IMAGE_DECODE_FAILED',
      message: 'The product image could not be decoded safely.',
    });
  }
}

const detectFormat = (bytes: Buffer): SafeFormat | null => {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
};

const hasExactContainerBoundary = (bytes: Buffer, format: SafeFormat): boolean => {
  if (format === 'jpeg') return hasExactJpegBoundary(bytes);
  if (format === 'webp') {
    return bytes.length >= 12 && bytes.readUInt32LE(4) + 8 === bytes.length;
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    offset = end;
    if (type === 'IEND') return length === 0 && offset === bytes.length;
  }
  return false;
};

const hasExactJpegBoundary = (bytes: Buffer): boolean => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  let insideScan = false;
  while (offset < bytes.length) {
    if (insideScan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      const marker = bytes[offset]!;
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      if (marker === 0xd9) return offset + 1 === bytes.length;
      offset = markerStart;
      insideScan = false;
      continue;
    }

    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9) return offset === bytes.length;
    if (marker === 0xd8 || marker === 0x00) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    offset += segmentLength;
    if (marker === 0xda) insideScan = true;
  }
  return false;
};

const looksLikeSvg = (bytes: Buffer): boolean => {
  const beginning = bytes.subarray(0, Math.min(bytes.length, 2_048)).toString('utf8').trimStart();
  const normalized = beginning.replace(/^\uFEFF/, '').toLowerCase();
  return (
    normalized.startsWith('<svg') || (normalized.startsWith('<?xml') && normalized.includes('<svg'))
  );
};

const looksExecutable = (bytes: Buffer): boolean =>
  (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) ||
  bytes.subarray(0, 4).toString('ascii') === '%PDF' ||
  bytes.subarray(0, 2).toString('ascii') === 'PK';
