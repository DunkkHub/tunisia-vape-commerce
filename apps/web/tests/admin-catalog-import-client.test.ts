import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminCatalogImportBatch } from '../src/api/types';
import { json, requestUrl } from './test-app';

const previewBatch: AdminCatalogImportBatch = {
  id: 'preview-1',
  importKey: 'catalog-review-1',
  dryRun: true,
  payloadHash: 'a'.repeat(64),
  format: 'JSON',
  source: 'ADMIN_UPLOAD',
  schemaVersion: '1.0',
  status: 'PREVIEW_VALID',
  partialMode: true,
  overridePrice: false,
  overrideStatus: false,
  overrideImages: false,
  rowCount: 1,
  appliedCount: 0,
  result: { validCount: 1, invalidCount: 0, canApply: true },
  previewBatchId: null,
  createdByUserId: 'admin-1',
  createdAt: '2026-07-20T10:00:00.000Z',
  completedAt: '2026-07-20T10:00:01.000Z',
  rolledBackAt: null,
  rows: [],
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

  respond(status: number, payload: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(payload);
    for (const listener of this.listeners.get('load') ?? []) listener(new Event('load'));
  }
}

function confirmationFromBody(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  const payload = JSON.parse(body) as unknown;
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('confirmation' in payload) ||
    typeof payload.confirmation !== 'string'
  ) {
    return null;
  }
  return payload.confirmation;
}

describe('administrator catalogue import API client', () => {
  beforeEach(() => {
    document.documentElement.lang = 'fr';
    document.cookie = 'vape_admin_csrf=csrf-import; Path=/';
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends every import safety option explicitly in the protected multipart preview', async () => {
    const file = new File(['{"schemaVersion":"1.0","rows":[]}'], 'catalog.json', {
      type: 'application/json',
    });
    const progress = vi.fn();
    const pending = adminDataClient.previewCatalogImport(
      {
        file,
        importKey: previewBatch.importKey,
        format: 'JSON',
        partialMode: true,
        overridePrice: false,
        overrideStatus: false,
        overrideImages: true,
      },
      progress,
    );
    const request = FakeXmlHttpRequest.latest;

    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/v1/admin/catalog/imports/preview');
    expect(request.withCredentials).toBe(true);
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf-import');
    expect(request.body).toBeInstanceOf(FormData);
    const body = request.body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('importKey')).toBe(previewBatch.importKey);
    expect(body.get('format')).toBe('JSON');
    expect(body.get('partialMode')).toBe('true');
    expect(body.get('overridePrice')).toBe('false');
    expect(body.get('overrideStatus')).toBe('false');
    expect(body.get('overrideImages')).toBe('true');

    request.respond(201, { data: previewBatch });
    await expect(pending).resolves.toEqual(previewBatch);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('uses fixed server confirmation phrases and downloads the versioned template', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith('/template.csv')) {
        return Promise.resolve(
          new Response('\uFEFFschemaVersion,productKey\r\n1.0,\r\n', {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="catalog-import-v1.csv"',
            },
          }),
        );
      }
      if (url.endsWith('/media/apply')) {
        return Promise.resolve(
          json({
            batch: previewBatch,
            report: {
              successful: [],
              missing: [],
              rejected: [],
              duplicates: [],
              productsRequiringManualReview: [],
            },
            requestConfirmation: confirmationFromBody(init?.body),
          }),
        );
      }
      return Promise.resolve(
        json({
          ...previewBatch,
          requestConfirmation: confirmationFromBody(init?.body),
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await adminDataClient.applyCatalogImport(previewBatch.id);
    await adminDataClient.importCatalogMedia(previewBatch.id);
    await adminDataClient.rollbackCatalogImport(previewBatch.id);
    const template = await adminDataClient.downloadCatalogImportTemplate();

    const applyCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith(`/admin/catalog/imports/${previewBatch.id}/apply`),
    );
    const rollbackCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith(`/admin/catalog/imports/${previewBatch.id}/rollback`),
    );
    const mediaCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith(`/admin/catalog/imports/${previewBatch.id}/media/apply`),
    );
    expect(confirmationFromBody(applyCall?.[1]?.body)).toBe('APPLY_CATALOG_IMPORT');
    expect(confirmationFromBody(mediaCall?.[1]?.body)).toBe('IMPORT_CATALOG_MEDIA');
    expect(confirmationFromBody(rollbackCall?.[1]?.body)).toBe('ROLLBACK_CATALOG_IMPORT');
    expect(template).toMatchObject({ filename: 'catalog-import-v1.csv', rowCount: null });
    expect(template.content).toContain('schemaVersion,productKey');
  });
});
