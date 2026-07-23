import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminProductImage } from '../src/api/types';
import { AdminProductMediaManager } from '../src/pages/admin/admin-product-media-manager';
import { json, requestUrl } from './test-app';

const createObjectUrl = vi.fn().mockReturnValue('blob:local-product-preview');
const revokeObjectUrl = vi.fn();

const image: AdminProductImage = {
  id: 'image-1',
  productId: 'product-1',
  variantId: null,
  url: '/api/v1/media/'.concat('a'.repeat(64)),
  contentType: 'image/webp',
  originalFilename: 'catalogue-face.webp',
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
  updatedAt: '2026-07-20T10:05:00.000Z',
};

describe('administrator product media workflow', () => {
  beforeEach(() => {
    document.cookie = 'vape_admin_csrf=test-csrf; Path=/';
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
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
    let resolveUpload!: (value: AdminProductImage) => void;
    const uploadPromise = new Promise<AdminProductImage>((resolve) => {
      resolveUpload = resolve;
    });
    const uploadSpy = vi
      .spyOn(adminDataClient, 'uploadProductImage')
      .mockImplementation((_productId, _payload, onProgress) => {
        onProgress?.(37);
        return uploadPromise;
      });
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
    expect(
      await screen.findByRole('img', { name: 'Aperçu local de l’image sélectionnée' }),
    ).toHaveAttribute('src', 'blob:local-product-preview');
    expect(screen.getByText('product.jpg')).toBeVisible();
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
      expect.any(Function),
    );
    expect(uploadSpy.mock.calls[0]?.[1].file).toBe(file);
    const progress = await screen.findByRole('progressbar', {
      name: 'Progression du téléversement de l’image',
    });
    expect(progress).toHaveValue(37);
    await act(async () => {
      resolveUpload({ ...image, id: 'image-2', ownerVersion: 4 });
      await uploadPromise;
    });
    expect(await screen.findByText('Image validée et téléversée.')).toBeVisible();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:local-product-preview');
  });

  it('keeps the authenticated review queue reachable across every result page', async () => {
    const reviewImages = [1, 2].map((page): AdminProductImage => ({
      ...image,
      id: `pending-image-${page}`,
      url: `/api/v1/admin/products/product-1/images/pending-image-${page}/content`,
      altTextFr: `Image importée à vérifier ${page}`,
      altTextAr: `صورة مستوردة للمراجعة ${page}`,
      isPrimary: false,
      moderationStatus: 'PENDING',
    }));
    const imageRequests: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/products/product-1/images?')) {
        imageRequests.push(url);
        const query = new URL(url, 'http://localhost').searchParams;
        const page = Number(query.get('page'));
        const reviewRequired = query.get('reviewRequired') === 'true';
        if (reviewRequired) {
          return Promise.resolve(
            json({
              items: [reviewImages[page - 1]],
              page,
              pageSize: 50,
              total: 2,
              totalPages: 2,
            }),
          );
        }
        return Promise.resolve(
          json({ items: [image], page: 1, pageSize: 50, total: 1, totalPages: 1 }),
        );
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [] }));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminProductMediaManager productId="product-1" productVersion={3} />
      </AppProviders>,
    );

    expect(await screen.findByRole('img', { name: 'Produit vu de face' })).toBeVisible();
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Afficher uniquement les images en attente de contrôle',
      }),
    );

    const firstPendingImage = await screen.findByRole('img', {
      name: 'Image importée à vérifier 1',
    });
    expect(firstPendingImage).toHaveAttribute(
      'src',
      '/api/v1/admin/products/product-1/images/pending-image-1/content',
    );
    expect(screen.getByRole('button', { name: 'Approuver l’image' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rejeter l’image' })).toBeVisible();
    expect(
      screen.getByRole('navigation', { name: 'Pagination des images du produit' }),
    ).toBeVisible();
    expect(screen.getByText('Page 1 sur 2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Page suivante' }));

    expect(await screen.findByRole('img', { name: 'Image importée à vérifier 2' })).toHaveAttribute(
      'src',
      '/api/v1/admin/products/product-1/images/pending-image-2/content',
    );
    expect(screen.getByText('Page 2 sur 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Page suivante' })).toBeDisabled();
    expect(imageRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining('page=1&pageSize=50&reviewRequired=true'),
        expect.stringContaining('page=2&pageSize=50&reviewRequired=true'),
      ]),
    );
  });

  it('prevents a second owner-version mutation until image reordering and refresh complete', async () => {
    const galleryImage: AdminProductImage = {
      ...image,
      id: 'image-2',
      altTextFr: 'Galerie produit',
      altTextAr: 'معرض المنتج',
      sortOrder: 1,
      isPrimary: false,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(
          json({ items: [image, galleryImage], page: 1, pageSize: 50, total: 2, totalPages: 1 }),
        );
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [] }));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(adminDataClient, 'productImagesForOwner').mockResolvedValue({
      items: [image, galleryImage],
      page: 1,
      pageSize: 50,
      total: 2,
      totalPages: 1,
    });
    let resolveReorder!: (value: { imageIds: string[]; ownerVersion: number }) => void;
    const reorderPromise = new Promise<{ imageIds: string[]; ownerVersion: number }>((resolve) => {
      resolveReorder = resolve;
    });
    vi.spyOn(adminDataClient, 'reorderProductImages').mockReturnValue(reorderPromise);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminProductMediaManager productId="product-1" productVersion={3} />
      </AppProviders>,
    );

    expect(await screen.findByRole('img', { name: 'Galerie produit' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Déplacer l’image vers le haut' })[1]!);

    await waitFor(() => expect(adminDataClient.reorderProductImages).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Définir comme principale' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Supprimer' })[0]).toBeDisabled();

    await act(async () => {
      resolveReorder({ imageIds: ['image-2', 'image-1'], ownerVersion: 4 });
      await reorderPromise;
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Définir comme principale' })).toBeEnabled(),
    );
  });

  it('keeps a flagged draft non-public while explicitly completing its media review', async () => {
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
      if (
        url.endsWith('/admin/products/product-1/media-review/confirm') &&
        init?.method === 'POST'
      ) {
        return Promise.resolve(
          json({
            id: 'product-1',
            publicationStatus: 'DRAFT',
            needsMediaReview: false,
            requiresPricing: true,
            requiresStock: true,
            version: 4,
          }),
        );
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminProductMediaManager
          productId="product-1"
          productVersion={3}
          productPublicationStatus="DRAFT"
          needsMediaReview
        />
      </AppProviders>,
    );

    expect(await screen.findByRole('img', { name: 'Produit vu de face' })).toBeVisible();
    const submit = screen.getByRole('button', { name: 'Confirmer le contrôle des images' });
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByLabelText('Motif du contrôle'),
      'Chaque image correspond au modèle et à la saveur contrôlés.',
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: /Je confirme avoir traité chaque image en attente ou en quarantaine/i,
      }),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestUrl(input).endsWith('/admin/products/product-1/media-review/confirm') &&
            init?.method === 'POST',
        ),
      ).toBe(true);
    });
    expect(
      await screen.findByText('Contrôle des images confirmé. Le produit reste en brouillon.'),
    ).toBeVisible();
  });
});
