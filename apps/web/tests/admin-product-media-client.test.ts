import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminProductImage } from '../src/api/types';
import { json, requestUrl } from './test-app';

const image: AdminProductImage = {
  id: 'image-1',
  productId: 'product-1',
  variantId: null,
  url: `/api/v1/media/${'a'.repeat(64)}`,
  contentType: 'image/avif',
  originalFilename: 'safe-product.avif',
  byteSize: 2048,
  checksumSha256: 'b'.repeat(64),
  width: 600,
  height: 600,
  altTextFr: 'Produit',
  altTextAr: 'منتج',
  sortOrder: 0,
  isPrimary: true,
  moderationStatus: 'APPROVED',
  ownerVersion: 2,
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
};

class FakeXmlHttpRequest {
  static latest: FakeXmlHttpRequest;

  readonly headers = new Map<string, string>();
  readonly listeners = new Map<string, EventListener[]>();
  readonly uploadListeners = new Map<string, EventListener[]>();
  readonly upload = {
    addEventListener: (type: string, listener: EventListener) => {
      this.uploadListeners.set(type, [...(this.uploadListeners.get(type) ?? []), listener]);
    },
  };
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  withCredentials = false;
  timeout = 0;
  status = 0;
  responseText = '';

  constructor() {
    FakeXmlHttpRequest.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }

  progress(loaded: number, total: number) {
    const event = { lengthComputable: true, loaded, total } as ProgressEvent;
    for (const listener of this.uploadListeners.get('progress') ?? []) listener(event);
  }

  respond(status: number, payload: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(payload);
    for (const listener of this.listeners.get('load') ?? []) listener(new Event('load'));
  }
}

describe('administrator product media multipart client', () => {
  beforeEach(() => {
    document.documentElement.lang = 'fr';
    document.cookie = 'vape_admin_csrf=csrf-value; Path=/';
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports measured upload bytes and preserves admin CSRF credentials', async () => {
    const file = new File(['safe-image'], 'product.avif', { type: 'image/avif' });
    const onProgress = vi.fn();
    const pending = adminDataClient.uploadProductImage(
      'product-1',
      {
        file,
        expectedOwnerVersion: 1,
        altTextFr: 'Produit',
        altTextAr: 'منتج',
        isPrimary: true,
      },
      onProgress,
    );
    const request = FakeXmlHttpRequest.latest;

    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/v1/admin/products/product-1/images');
    expect(request.withCredentials).toBe(true);
    expect(request.timeout).toBe(120_000);
    expect(request.headers).toMatchObject(
      new Map([
        ['Accept', 'application/json'],
        ['Accept-Language', 'fr'],
        ['X-Client-Context', 'admin'],
        ['X-CSRF-Token', 'csrf-value'],
      ]),
    );
    expect(request.headers.has('Content-Type')).toBe(false);
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('file')).toBe(file);

    request.progress(25, 100);
    expect(onProgress).toHaveBeenCalledWith(25);
    request.respond(201, { data: image });

    await expect(pending).resolves.toEqual(image);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('surfaces duplicate-check error codes from multipart responses', async () => {
    const pending = adminDataClient.replaceProductImage(
      'product-1',
      image,
      new File(['same'], 'same.avif', { type: 'image/avif' }),
    );

    FakeXmlHttpRequest.latest.respond(409, {
      code: 'PRODUCT_IMAGE_UNCHANGED',
      message: 'The replacement is unchanged.',
    });

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: 'PRODUCT_IMAGE_UNCHANGED',
    });
  });

  it.each(['APPROVE', 'REJECT'] as const)(
    'sends the protected %s imported-media review confirmation',
    async (decision) => {
      const pendingImage: AdminProductImage = {
        ...image,
        id: 'pending-image-1',
        isPrimary: false,
        moderationStatus: 'PENDING',
        url: '/api/v1/admin/products/product-1/images/pending-image-1/content',
      };
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(
          json({
            ...pendingImage,
            moderationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          }),
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      await adminDataClient.reviewProductImage('product-1', pendingImage, decision);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0]!;
      expect(requestUrl(input)).toBe(
        '/api/v1/admin/products/product-1/images/pending-image-1/review',
      );
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
      });
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body');
      expect(JSON.parse(requestBody)).toEqual({
        expectedOwnerVersion: 2,
        decision,
        confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
      });
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Client-Context')).toBe('admin');
      expect(headers.get('X-CSRF-Token')).toBe('csrf-value');
    },
  );

  it('sends the protected draft media-review transition with its exact confirmation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        json({
          id: 'product-1',
          publicationStatus: 'DRAFT',
          needsMediaReview: false,
          version: 8,
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await adminDataClient.confirmProductMediaReview(
      'product-1',
      7,
      'Every candidate matches its exact model and flavour.',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(requestUrl(input)).toBe('/api/v1/admin/products/product-1/media-review/confirm');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body)).toEqual({
      version: 7,
      reason: 'Every candidate matches its exact model and flavour.',
      confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Client-Context')).toBe('admin');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-value');
  });
});
