import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminProductImage } from '../src/api/types';
import { AdminProductMediaManager } from '../src/pages/admin/admin-product-media-manager';
import { json, requestUrl } from './test-app';

const image: AdminProductImage = {
  id: 'image-1',
  productId: 'product-1',
  variantId: null,
  url: '/api/v1/media/'.concat('a'.repeat(64)),
  contentType: 'image/webp',
  byteSize: 4096,
  checksumSha256: 'b'.repeat(64),
  width: 800,
  height: 800,
  altTextFr: 'Produit vu de face',
  altTextAr: 'المنتج من الأمام',
  sortOrder: 0,
  isPrimary: true,
  moderationStatus: 'APPROVED',
  ownerVersion: 3,
  createdAt: '2026-07-20T10:00:00.000Z',
};

describe('administrator product media workflow', () => {
  beforeEach(() => {
    document.cookie = 'vape_admin_csrf=test-csrf; Path=/';
  });

  it('lists validated images and uploads through the protected multipart endpoint', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(
          json({ items: [image], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [] }));
      }
      if (url.endsWith('/admin/products/product-1/images') && init?.method === 'POST') {
        return Promise.resolve(json({ ...image, id: 'image-2', ownerVersion: 4 }));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const uploadSpy = vi
      .spyOn(adminDataClient, 'uploadProductImage')
      .mockResolvedValue({ ...image, id: 'image-2', ownerVersion: 4 });
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminProductMediaManager productId="product-1" productVersion={3} />
      </AppProviders>,
    );

    expect(await screen.findByRole('img', { name: 'Produit vu de face' })).toBeVisible();
    expect(screen.getByText('Principale')).toBeVisible();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'product.jpg', {
      type: 'image/jpeg',
    });
    const fileInput = screen.getByLabelText('Fichier image');
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('Expected a file input');
    await user.upload(fileInput, file);
    expect(fileInput.files?.item(0)).toBe(file);
    await user.type(screen.getAllByLabelText('Texte alternatif français')[0]!, 'Vue latérale');
    await user.type(screen.getAllByLabelText('Texte alternatif arabe')[0]!, 'من الجانب');
    const uploadButton = screen.getByRole('button', { name: /Téléverser l’image/ });
    fireEvent.submit(uploadButton.closest('form')!);

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    expect(uploadSpy).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({
        expectedOwnerVersion: 3,
        altTextFr: 'Vue latérale',
        altTextAr: 'من الجانب',
        isPrimary: false,
      }),
    );
    expect(uploadSpy.mock.calls[0]?.[1].file).toBe(file);
    expect(await screen.findByText('Image validée et téléversée.')).toBeVisible();
  });
});
