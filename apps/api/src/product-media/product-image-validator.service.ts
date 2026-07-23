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
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
  extension: 'jpg' | 'png' | 'webp' | 'avif';
  originalFilename: string;
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
  avif: { contentType: 'image/avif', extension: 'avif' },
} as const;

type SafeFormat = keyof typeof SAFE_TYPES;
const AVIF_SUPPORTED = Boolean(sharp.format.heif?.input.buffer && sharp.format.heif.output.buffer);

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
    if (format === 'avif' && !AVIF_SUPPORTED) throw this.unsupportedType();
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
      !metadataFormatMatches(metadata.format, format) ||
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

    let encoded: Buffer;
    let output: { width: number; height: number; format: string; size: number };
    try {
      // Auto-orient pixels, keep only the ICC profile needed for color fidelity, and re-encode the
      // selected safe raster format. Sharp strips EXIF, XMP, comments, and other untrusted metadata
      // unless they are explicitly retained. Producing new bytes also canonicalizes duplicate
      // detection across uploads that differ only by removable metadata.
      let pipeline = sharp(file.buffer, {
        animated: false,
        failOn: 'error',
        limitInputPixels: maximumPixels,
        sequentialRead: true,
      })
        .rotate()
        .keepIccProfile();
      pipeline = encodeRaster(pipeline, format);
      const result = await pipeline.toBuffer({ resolveWithObject: true });
      encoded = result.data;
      output = result.info;
    } catch {
      throw this.decodeFailed();
    }

    if (
      !metadataFormatMatches(output.format, format) ||
      !Number.isSafeInteger(output.width) ||
      !Number.isSafeInteger(output.height) ||
      output.width < 1 ||
      output.height < 1
    ) {
      throw this.decodeFailed();
    }
    if (encoded.length > maximumBytes) {
      throw new PayloadTooLargeException({
        code: 'IMAGE_TOO_LARGE_AFTER_PROCESSING',
        message: `The safely processed product image must not exceed ${maximumBytes} bytes.`,
      });
    }

    return {
      bytes: encoded,
      contentType: expected.contentType,
      extension: expected.extension,
      originalFilename: sanitizeOriginalFilename(file.originalname, expected.extension),
      byteSize: encoded.length,
      checksumSha256: createHash('sha256').update(encoded).digest('hex'),
      width: output.width,
      height: output.height,
    };
  }

  private unsupportedType(): BadRequestException {
    return new BadRequestException({
      code: 'IMAGE_TYPE_NOT_ALLOWED',
      message: AVIF_SUPPORTED
        ? 'Only non-animated JPEG, PNG, WebP, and AVIF product images are allowed.'
        : 'Only non-animated JPEG, PNG, and WebP product images are allowed.',
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
  if (isAvifContainer(bytes)) return 'avif';
  return null;
};

const hasExactContainerBoundary = (bytes: Buffer, format: SafeFormat): boolean => {
  if (format === 'jpeg') return hasExactJpegBoundary(bytes);
  if (format === 'avif') return hasExactIsoBmffBoundary(bytes);
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

const metadataFormatMatches = (metadataFormat: string | undefined, format: SafeFormat): boolean =>
  metadataFormat === format || (format === 'avif' && metadataFormat === 'heif');

const encodeRaster = (pipeline: sharp.Sharp, format: SafeFormat): sharp.Sharp => {
  if (format === 'jpeg') {
    return pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
  }
  if (format === 'png') return pipeline.png({ adaptiveFiltering: true, compressionLevel: 9 });
  if (format === 'webp') return pipeline.webp({ quality: 90, effort: 5 });
  return pipeline.avif({ quality: 65, effort: 5, chromaSubsampling: '4:4:4' });
};

const isAvifContainer = (bytes: Buffer): boolean => {
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  const firstBoxSize = bytes.readUInt32BE(0);
  if (firstBoxSize < 16 || firstBoxSize > bytes.length || (firstBoxSize - 8) % 4 !== 0) {
    return false;
  }
  for (let offset = 8; offset + 4 <= firstBoxSize; offset += 4) {
    const brand = bytes.toString('ascii', offset, offset + 4);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
};

const hasExactIsoBmffBoundary = (bytes: Buffer): boolean => {
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const size32 = bytes.readUInt32BE(offset);
    let boxSize: number;
    if (size32 === 0) return offset + 8 <= bytes.length;
    if (size32 === 1) {
      if (offset + 16 > bytes.length) return false;
      const size64 = bytes.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      boxSize = Number(size64);
      if (boxSize < 16) return false;
    } else {
      boxSize = size32;
      if (boxSize < 8) return false;
    }
    if (offset + boxSize > bytes.length) return false;
    offset += boxSize;
  }
  return offset === bytes.length;
};

export const sanitizeOriginalFilename = (originalName: string, extension: string): string => {
  const leaf = originalName.normalize('NFKC').replaceAll('\\', '/').split('/').at(-1) ?? '';
  const lastDot = leaf.lastIndexOf('.');
  const rawStem = lastDot > 0 ? leaf.slice(0, lastDot) : leaf;
  const stem = rawStem
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N} ._()+-]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/-+/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '');
  const suffix = `.${extension}`;
  const maximumStemLength = 255 - suffix.length;
  const boundedStem = [...(stem || 'image-upload')].slice(0, maximumStemLength).join('');
  return `${boundedStem}${suffix}`;
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
