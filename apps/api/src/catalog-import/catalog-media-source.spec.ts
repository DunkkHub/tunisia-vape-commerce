import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import {
  CatalogMediaSourceClient,
  CatalogMediaSourceError,
  createPinnedCatalogMediaLookup,
  isPublicCatalogMediaAddress,
} from './catalog-media-source';

const publicResolver = vi.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);

describe('CatalogMediaSourceClient', () => {
  it('recognizes public and non-public address ranges conservatively', () => {
    expect(isPublicCatalogMediaAddress('8.8.8.8')).toBe(true);
    expect(isPublicCatalogMediaAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicCatalogMediaAddress('127.0.0.1')).toBe(false);
    expect(isPublicCatalogMediaAddress('10.0.0.1')).toBe(false);
    expect(isPublicCatalogMediaAddress('169.254.169.254')).toBe(false);
    expect(isPublicCatalogMediaAddress('::1')).toBe(false);
    expect(isPublicCatalogMediaAddress('fd00::1')).toBe(false);
  });

  it('pins each connection lookup to the addresses already validated by the resolver', async () => {
    const lookup = createPinnedCatalogMediaLookup([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);

    const addresses = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        lookup('media.example.com', { all: true }, (error, result) => {
          if (error) reject(error);
          else resolve(result as Array<{ address: string; family: number }>);
        });
      },
    );

    expect(addresses).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('uses the pinned lookup for a real Undici connection without consulting public DNS', async () => {
    let observedHost = '';
    const server = createServer((request, response) => {
      observedHost = request.headers.host ?? '';
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('pinned-connection');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const dispatcher = new Agent({
      connect: {
        lookup: createPinnedCatalogMediaLookup([{ address: '127.0.0.1', family: 4 }]),
      },
    });

    try {
      const response = await undiciFetch(
        `http://catalog-media-pinned.invalid:${address.port}/image`,
        { dispatcher },
      );

      expect(await response.text()).toBe('pinned-connection');
      expect(observedHost).toBe(`catalog-media-pinned.invalid:${address.port}`);
    } finally {
      await dispatcher.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it('downloads only an allowlisted HTTPS raster response and removes URL secrets', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const fetcher = vi
      .fn<
        (
          input: string | URL,
          init?: NonNullable<Parameters<typeof undiciFetch>[1]>,
        ) => Promise<Response>
      >()
      .mockResolvedValue(
        new Response(Buffer.from('image-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    const client = new CatalogMediaSourceClient(['media.example.com'], fetcher, resolver);

    const image = await client.downloadImage(
      'https://media.example.com/products/item.png?signature=secret#fragment',
      1_024,
    );

    expect(image.sourceUrl).toBe('https://media.example.com/products/item.png');
    expect(image.originalFilename).toBe('item.png');
    expect(image.contentType).toBe('image/png');
    expect(resolver).toHaveBeenCalledWith('media.example.com', { all: true, verbatim: true });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('secret');
    expect(fetcher.mock.calls[0]?.[1]?.dispatcher).toBeInstanceOf(Agent);
  });

  it('rejects hosts outside the explicit operator allowlist', async () => {
    const fetcher = vi.fn();
    const client = new CatalogMediaSourceClient(['media.example.com'], fetcher, publicResolver);

    await expect(
      client.downloadImage('https://other.example.com/item.png', 1_024),
    ).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_HOST_NOT_ALLOWED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted hostname when any DNS answer is non-public', async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const fetcher = vi.fn();
    const client = new CatalogMediaSourceClient(['media.example.com'], fetcher, resolver);

    await expect(
      client.downloadImage('https://media.example.com/item.png', 1_024),
    ).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_PRIVATE_ADDRESS_REJECTED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('revalidates redirect destinations against the allowlist', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://internal.example.net/secret.png' },
      }),
    );
    const client = new CatalogMediaSourceClient(
      ['media.example.com'],
      fetcher,
      vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
    );

    await expect(
      client.downloadImage('https://media.example.com/item.png', 1_024),
    ).rejects.toBeInstanceOf(CatalogMediaSourceError);
    await expect(
      client.downloadImage('https://media.example.com/item.png', 1_024),
    ).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_HOST_NOT_ALLOWED',
    });
  });

  it('retains the requested provenance URL while recording an allowlisted redirect target', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/cdn/item.png' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('image-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    const client = new CatalogMediaSourceClient(
      ['media.example.com'],
      fetcher,
      vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
    );

    const image = await client.downloadImage('https://media.example.com/item.png', 1_024);

    expect(image.sourceUrl).toBe('https://media.example.com/item.png');
    expect(image.resolvedSourceUrl).toBe('https://media.example.com/cdn/item.png');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('enforces the configured byte limit before buffering', async () => {
    const client = new CatalogMediaSourceClient(
      ['media.example.com'],
      vi.fn().mockResolvedValue(
        new Response(Buffer.alloc(32), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '32' },
        }),
      ),
      vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
    );

    await expect(
      client.downloadImage('https://media.example.com/item.png', 16),
    ).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_IMAGE_TOO_LARGE',
    });
  });

  it('does not retry before a long HTTP-date rate-limit window', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': new Date(Date.now() + 60_000).toUTCString() },
      }),
    );
    const client = new CatalogMediaSourceClient(
      ['media.example.com'],
      fetcher,
      vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
    );

    await expect(
      client.downloadImage('https://media.example.com/item.png', 1_024),
    ).rejects.toMatchObject({
      code: 'CATALOG_MEDIA_SOURCE_RATE_LIMITED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
