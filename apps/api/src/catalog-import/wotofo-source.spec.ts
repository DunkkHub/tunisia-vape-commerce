import { describe, expect, it, vi } from 'vitest';
import { WOTOFO_PRODUCTS } from './wotofo-catalog';
import {
  assertOfficialImageUrl,
  verifyWotofoProductPayload,
  WotofoSourceClient,
  WotofoSourceError,
} from './wotofo-source';

const definition = WOTOFO_PRODUCTS.find(({ key }) => key === 'nexbar-20k-20')!;

const payload = {
  handle: definition.handle,
  title: 'Wotofo nexBar 20k',
  featured_image: '//cdn.shopify.com/s/files/1/0038/8032/1113/files/wotofo-nexbar-20k-3.jpg?v=1',
  variants: definition.options.map((option) => ({ option1: option, option2: '20mg' })),
};

describe('Wotofo official source verification', () => {
  it('accepts the exact reviewed option set and orders it deterministically', () => {
    const verified = verifyWotofoProductPayload(definition, payload);
    expect(verified.variants.map(({ option }) => option)).toEqual(definition.options);
    expect(verified.productImageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
  });

  it('rejects changed option sets and non-official image locations', () => {
    expect(() =>
      verifyWotofoProductPayload(definition, {
        ...payload,
        variants: payload.variants.slice(1),
      }),
    ).toThrowError(WotofoSourceError);
    expect(() => assertOfficialImageUrl('https://example.com/product.jpg')).toThrowError(
      /verified Wotofo asset path/,
    );
  });

  it('downloads a bounded official image and rejects declared oversize responses', async () => {
    const url = 'https://cdn.shopify.com/s/files/1/0038/8032/1113/files/wotofo-nexbar-20k-3.jpg';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('not-read', {
          headers: { 'content-type': 'image/jpeg', 'content-length': '999' },
        }),
      );
    const client = new WotofoSourceClient(fetcher);
    await expect(client.downloadImage(url, 10)).resolves.toMatchObject({
      contentType: 'image/jpeg',
      originalFilename: 'wotofo-nexbar-20k-3.jpg',
    });
    await expect(client.downloadImage(url, 10)).rejects.toMatchObject({
      code: 'WOTOFO_IMAGE_TOO_LARGE',
    });
  });

  it('rejects an oversized official product response before parsing JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '2097153' },
      }),
    );
    await expect(new WotofoSourceClient(fetcher).verify(definition)).rejects.toMatchObject({
      code: 'WOTOFO_PRODUCT_JSON_TOO_LARGE',
    });
  });

  it('does not retry before a long server-supplied rate-limit window', async () => {
    const url = 'https://cdn.shopify.com/s/files/1/0038/8032/1113/files/wotofo-nexbar-20k-3.jpg';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    );

    await expect(new WotofoSourceClient(fetcher).downloadImage(url, 1_024)).rejects.toMatchObject({
      code: 'WOTOFO_SOURCE_RATE_LIMITED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
