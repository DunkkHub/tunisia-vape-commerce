import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import {
  ProductImageValidatorService,
  sanitizeOriginalFilename,
  type UploadedProductImage,
} from './product-image-validator.service';

const avifSupported = Boolean(sharp.format.heif?.input.buffer && sharp.format.heif.output.buffer);

const configuration = (maximumBytes = 10 * 1_024 * 1_024, maximumPixels = 40_000_000) =>
  ({
    get: vi.fn((key: keyof Environment) =>
      key === 'UPLOAD_MAX_BYTES' ? maximumBytes : maximumPixels,
    ),
  }) as unknown as ConfigService<Environment, true>;

const upload = (buffer: Buffer, mimetype: string, size = buffer.length): UploadedProductImage => ({
  buffer,
  mimetype,
  originalname: 'customer-controlled-name',
  size,
});

describe('ProductImageValidatorService', () => {
  let png: Buffer;
  let jpeg: Buffer;
  let webp: Buffer;
  let avif: Buffer | undefined;

  beforeAll(async () => {
    const pixels = {
      create: { width: 3, height: 2, channels: 3 as const, background: '#ba32d5' },
    };
    [png, jpeg, webp, avif] = await Promise.all([
      sharp(pixels).png().toBuffer(),
      sharp(pixels).jpeg().toBuffer(),
      sharp(pixels).webp().toBuffer(),
      avifSupported ? sharp(pixels).avif().toBuffer() : Promise.resolve(undefined),
    ]);
  });

  it.each([
    ['image/png', 'png', () => png],
    ['image/jpeg', 'jpg', () => jpeg],
    ['image/webp', 'webp', () => webp],
  ] as const)('fully decodes an exact safe %s raster', async (mimetype, extension, bytes) => {
    const result = await new ProductImageValidatorService(configuration()).validate(
      upload(bytes(), mimetype),
    );

    expect(result).toMatchObject({
      contentType: mimetype,
      extension,
      byteSize: result.bytes.length,
      width: 3,
      height: 2,
      originalFilename: `customer-controlled-name.${extension}`,
    });
    expect(result.bytes).not.toBe(bytes());
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 3, height: 2 });
  });

  it.runIf(avifSupported)('accepts and safely re-encodes AVIF when Sharp supports it', async () => {
    const result = await new ProductImageValidatorService(configuration()).validate(
      upload(avif!, 'image/avif'),
    );

    expect(result).toMatchObject({
      contentType: 'image/avif',
      extension: 'avif',
      width: 3,
      height: 2,
      originalFilename: 'customer-controlled-name.avif',
    });
    expect((await sharp(result.bytes).metadata()).format).toBe('heif');
  });

  it('auto-orients pixels and strips EXIF while retaining a safe raster', async () => {
    const source = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#155e75' },
    })
      .jpeg()
      .withIccProfile('p3')
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.icc).toBeDefined();

    const result = await new ProductImageValidatorService(configuration()).validate(
      upload(source, 'image/jpeg'),
    );
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({ width: 3, height: 2 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toEqual(sourceMetadata.icc);
  });

  it('sanitizes path components, bidi controls, misleading extensions, and length', () => {
    expect(sanitizeOriginalFilename('../../folder\\\u202Eevil.exe', 'jpg')).toBe('evil.jpg');
    expect(sanitizeOriginalFilename('   ...   ', 'webp')).toBe('image-upload.webp');
    expect(sanitizeOriginalFilename(`${'a'.repeat(300)}.png`, 'png')).toHaveLength(255);
  });

  it('rejects a declared MIME type that disagrees with magic bytes', async () => {
    await expect(
      new ProductImageValidatorService(configuration()).validate(upload(png, 'image/jpeg')),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_MIME_MISMATCH' } });
  });

  it.each([
    ['SVG', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['Windows executable', Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
    ['ELF executable', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['ZIP payload', Buffer.from('PK\u0003\u0004payload', 'binary')],
  ])('rejects %s content before image decoding', async (_label, bytes) => {
    await expect(
      new ProductImageValidatorService(configuration()).validate(upload(bytes, 'image/png')),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_TYPE_NOT_ALLOWED' } });
  });

  it('rejects a structurally bounded PNG that cannot be decoded', async () => {
    const emptyPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('IEND'),
      Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ]);

    await expect(
      new ProductImageValidatorService(configuration()).validate(upload(emptyPng, 'image/png')),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_DECODE_FAILED' } });
  });

  it.each([
    ['PNG', () => Buffer.concat([png, Buffer.from('payload')]), 'image/png'],
    [
      'JPEG',
      () => Buffer.concat([jpeg, Buffer.from('payload'), Buffer.from([0xff, 0xd9])]),
      'image/jpeg',
    ],
    ['WebP', () => Buffer.concat([webp, Buffer.from('payload')]), 'image/webp'],
  ] as const)(
    'rejects trailing content after the exact %s container',
    async (_label, bytes, mimetype) => {
      await expect(
        new ProductImageValidatorService(configuration()).validate(upload(bytes(), mimetype)),
      ).rejects.toMatchObject({ response: { code: 'IMAGE_CONTAINER_INVALID' } });
    },
  );

  it.runIf(avifSupported)('rejects trailing content after the exact AVIF container', async () => {
    await expect(
      new ProductImageValidatorService(configuration()).validate(
        upload(Buffer.concat([avif!, Buffer.from('payload')]), 'image/avif'),
      ),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_CONTAINER_INVALID' } });
  });

  it('enforces the configured byte limit before decoding', async () => {
    await expect(
      new ProductImageValidatorService(configuration(png.length - 1)).validate(
        upload(png, 'image/png'),
      ),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_TOO_LARGE' } });
  });

  it('enforces the configured decoded-pixel limit', async () => {
    await expect(
      new ProductImageValidatorService(configuration(png.length, 5)).validate(
        upload(png, 'image/png'),
      ),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_PIXEL_LIMIT_EXCEEDED' } });
  });

  it('rejects missing, empty, and transport-size-inconsistent files', async () => {
    const service = new ProductImageValidatorService(configuration());
    await expect(service.validate(undefined)).rejects.toMatchObject({
      response: { code: 'IMAGE_FILE_REQUIRED' },
    });
    await expect(service.validate(upload(Buffer.alloc(0), 'image/png'))).rejects.toMatchObject({
      response: { code: 'IMAGE_FILE_REQUIRED' },
    });
    await expect(service.validate(upload(png, 'image/png', png.length + 1))).rejects.toMatchObject({
      response: { code: 'IMAGE_TOO_LARGE' },
    });
  });
});
