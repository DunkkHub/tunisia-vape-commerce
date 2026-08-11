import 'reflect-metadata';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import { AdminProductMediaController } from './product-media.controller';
import { productMediaMulterOptions } from './product-media-multipart.options';
import { ProductMediaUploadGateInterceptor } from './product-media-upload-gate.interceptor';

const context = {} as ExecutionContext;

describe('ProductMediaUploadGateInterceptor', () => {
  it('enters Multer and the downstream handler for only one request at a time', () => {
    const gate = new ProductMediaUploadGateInterceptor();
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    const firstHandler = { handle: vi.fn(() => first) } satisfies CallHandler;
    const secondHandler = { handle: vi.fn(() => second) } satisfies CallHandler;

    gate.intercept(context, firstHandler).subscribe();
    gate.intercept(context, secondHandler).subscribe();

    expect(firstHandler.handle).toHaveBeenCalledOnce();
    expect(secondHandler.handle).not.toHaveBeenCalled();

    first.complete();

    expect(secondHandler.handle).toHaveBeenCalledOnce();
    second.complete();
  });

  it('releases the slot when downstream errors', () => {
    const gate = new ProductMediaUploadGateInterceptor();
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    const secondHandler = { handle: vi.fn(() => second) } satisfies CallHandler;

    gate.intercept(context, { handle: () => first }).subscribe({ error: () => undefined });
    gate.intercept(context, secondHandler).subscribe();
    first.error(new Error('multipart failed'));

    expect(secondHandler.handle).toHaveBeenCalledOnce();
    second.complete();
  });

  it('releases the slot when the active request unsubscribes', () => {
    const gate = new ProductMediaUploadGateInterceptor();
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    const secondHandler = { handle: vi.fn(() => second) } satisfies CallHandler;
    const active = gate.intercept(context, { handle: () => first }).subscribe();

    gate.intercept(context, secondHandler).subscribe();
    active.unsubscribe();

    expect(secondHandler.handle).toHaveBeenCalledOnce();
    second.complete();
  });

  it('passes the validated configured byte limit and bounded multipart counts to Multer', () => {
    const get = vi.fn().mockReturnValue(7_654_321);
    const options = productMediaMulterOptions({ get } as unknown as ConfigService<
      Environment,
      true
    >);

    expect(get).toHaveBeenCalledWith('UPLOAD_MAX_BYTES', { infer: true });
    expect(options.limits).toMatchObject({
      fileSize: 7_654_321,
      files: 1,
      fields: 5,
      parts: 7,
    });
  });

  it.each(['upload', 'replace'] as const)('runs the gate before Multer on %s', (method) => {
    const interceptors = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      AdminProductMediaController.prototype[method],
    ) as unknown[];

    expect(interceptors).toHaveLength(2);
    expect(interceptors[0]).toBe(ProductMediaUploadGateInterceptor);
  });
});
