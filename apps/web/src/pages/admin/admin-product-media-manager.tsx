import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import type { AdminProductImage } from '../../api/types';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';

const formText = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

const formFile = (form: HTMLFormElement, key: string): File | null => {
  const control = form.elements.namedItem(key);
  if (!(control instanceof HTMLInputElement) || control.type !== 'file') return null;
  return control.files?.item(0) ?? null;
};

export function AdminProductMediaManager({
  productId,
  productVersion,
}: {
  productId: string;
  productVersion: number;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const images = useQuery({
    queryKey: ['admin', 'product', productId, 'images'],
    queryFn: () => adminDataClient.productImages(productId),
  });
  const variants = useQuery({
    queryKey: ['admin', 'product', productId, 'variants'],
    queryFn: () => adminDataClient.productVariants(productId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId, 'images'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId, 'variants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] }),
    ]);
  };
  const upload = useMutation({
    mutationFn: (input: {
      file: File;
      expectedOwnerVersion: number;
      variantId?: string;
      altTextFr: string;
      altTextAr: string;
      isPrimary: boolean;
    }) => adminDataClient.uploadProductImage(productId, input),
    onSuccess: async () => {
      setMessage(t('admin.media.uploaded'));
      await refresh();
    },
  });
  const metadata = useMutation({
    mutationFn: ({
      image,
      altTextFr,
      altTextAr,
    }: {
      image: AdminProductImage;
      altTextFr: string;
      altTextAr: string;
    }) => adminDataClient.updateProductImage(productId, image, { altTextFr, altTextAr }),
    onSuccess: async () => {
      setMessage(t('admin.media.metadataSaved'));
      await refresh();
    },
  });
  const replace = useMutation({
    mutationFn: ({ image, file }: { image: AdminProductImage; file: File }) =>
      adminDataClient.replaceProductImage(productId, image, file),
    onSuccess: async () => {
      setMessage(t('admin.media.replaced'));
      await refresh();
    },
  });
  const action = useMutation<
    unknown,
    Error,
    { image: AdminProductImage; kind: 'primary' | 'delete' | 'up' | 'down' }
  >({
    mutationFn: ({
      image,
      kind,
    }: {
      image: AdminProductImage;
      kind: 'primary' | 'delete' | 'up' | 'down';
    }) => {
      if (kind === 'primary') return adminDataClient.setPrimaryProductImage(productId, image);
      if (kind === 'delete') return adminDataClient.deleteProductImage(productId, image);
      const ownerImages =
        images.data?.items
          .filter((candidate) => candidate.variantId === image.variantId)
          .sort((left, right) => left.sortOrder - right.sortOrder) ?? [];
      const index = ownerImages.findIndex((candidate) => candidate.id === image.id);
      const target = kind === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ownerImages.length) {
        return Promise.resolve({
          imageIds: ownerImages.map(({ id }) => id),
          ownerVersion: image.ownerVersion,
        });
      }
      [ownerImages[index], ownerImages[target]] = [ownerImages[target]!, ownerImages[index]!];
      return adminDataClient.reorderProductImages(
        productId,
        image,
        ownerImages.map(({ id }) => id),
      );
    },
    onSuccess: async () => {
      setMessage(t('admin.media.actionCompleted'));
      await refresh();
    },
  });
  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = formFile(formElement, 'file');
    const variantId = formText(form, 'variantId');
    if (!file) return;
    const ownerVersion = variantId
      ? variants.data?.items.find((variant) => variant.id === variantId)?.version
      : productVersion;
    if (!ownerVersion) return;
    try {
      await upload.mutateAsync({
        file,
        expectedOwnerVersion: ownerVersion,
        ...(variantId ? { variantId } : {}),
        altTextFr: formText(form, 'altTextFr'),
        altTextAr: formText(form, 'altTextAr'),
        isPrimary: form.get('isPrimary') === 'on',
      });
      formElement.reset();
    } catch {
      // React Query exposes the safe server error below the form.
    }
  };
  const submitMetadata = (image: AdminProductImage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    metadata.mutate({
      image,
      altTextFr: formText(form, 'altTextFr'),
      altTextAr: formText(form, 'altTextAr'),
    });
  };
  const submitReplacement = (image: AdminProductImage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = formFile(event.currentTarget, 'file');
    if (file) replace.mutate({ image, file });
  };
  const error =
    images.error ??
    variants.error ??
    upload.error ??
    metadata.error ??
    replace.error ??
    action.error;
  const variantNames = new Map(
    variants.data?.items.map((variant) => [
      variant.id,
      i18n.resolvedLanguage === 'ar' ? variant.nameAr : variant.nameFr,
    ]) ?? [],
  );

  return (
    <section className="admin-panel admin-media-manager" aria-labelledby="product-media-title">
      <header className="admin-media-manager__heading">
        <div>
          <h2 id="product-media-title">{t('admin.media.title')}</h2>
          <p>{t('admin.media.description')}</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void images.refetch()}>
          <RefreshCw aria-hidden="true" size={16} />
          {t('admin.refresh')}
        </Button>
      </header>

      <form className="admin-media-upload" onSubmit={(event) => void submitUpload(event)}>
        <div className="admin-form-grid">
          <div className="field">
            <label htmlFor="product-image-file">{t('admin.media.file')}</label>
            <input
              id="product-image-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
            />
          </div>
          <SelectField name="variantId" label={t('admin.media.owner')}>
            <option value="">{t('admin.media.productOwner')}</option>
            {variants.data?.items
              .filter((variant) => !variant.archivedAt)
              .map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.nameFr} · {variant.sku}
                </option>
              ))}
          </SelectField>
          <FormField name="altTextFr" label={t('admin.media.altFr')} maxLength={300} required />
          <FormField
            name="altTextAr"
            label={t('admin.media.altAr')}
            maxLength={300}
            dir="rtl"
            required
          />
        </div>
        <CheckboxField name="isPrimary" label={t('admin.media.makePrimary')} />
        <Button type="submit" variant="admin" loading={upload.isPending}>
          <ImagePlus aria-hidden="true" size={17} />
          {t('admin.media.upload')}
        </Button>
      </form>

      {message ? (
        <p className="admin-action-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? <ErrorState compact /> : null}
      {images.isPending || variants.isPending ? (
        <LoadingState label={t('common.loading')} tone="admin" />
      ) : null}
      {!images.isPending && !images.data?.items.length ? (
        <EmptyState title={t('admin.media.empty')} />
      ) : null}

      <div className="admin-media-grid">
        {images.data?.items.map((image) => {
          const ownerImages = images.data.items.filter(
            (candidate) => candidate.variantId === image.variantId,
          );
          const ownerIndex = ownerImages.findIndex((candidate) => candidate.id === image.id);
          return (
            <article className="admin-media-card" key={image.id}>
              <img
                src={image.url}
                alt={i18n.resolvedLanguage === 'ar' ? image.altTextAr : image.altTextFr}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
              />
              <div className="admin-media-card__meta">
                <strong>
                  {image.variantId
                    ? (variantNames.get(image.variantId) ?? t('admin.media.variantOwner'))
                    : t('admin.media.productOwner')}
                </strong>
                <span>
                  {image.width}×{image.height} · {Math.ceil(image.byteSize / 1024)} KB ·{' '}
                  {image.moderationStatus}
                </span>
                {image.isPrimary ? (
                  <span className="account-state account-state--active">
                    {t('admin.media.primary')}
                  </span>
                ) : null}
              </div>
              <form onSubmit={(event) => submitMetadata(image, event)}>
                <FormField
                  name="altTextFr"
                  label={t('admin.media.altFr')}
                  defaultValue={image.altTextFr}
                  maxLength={300}
                  required
                />
                <FormField
                  name="altTextAr"
                  label={t('admin.media.altAr')}
                  defaultValue={image.altTextAr}
                  maxLength={300}
                  dir="rtl"
                  required
                />
                <Button type="submit" variant="admin" loading={metadata.isPending}>
                  {t('common.save')}
                </Button>
              </form>
              <form
                className="admin-media-replace"
                onSubmit={(event) => submitReplacement(image, event)}
              >
                <label htmlFor={`replace-${image.id}`}>{t('admin.media.replace')}</label>
                <input
                  id={`replace-${image.id}`}
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
                <Button type="submit" variant="ghost" loading={replace.isPending}>
                  {t('admin.media.replace')}
                </Button>
              </form>
              <div className="admin-row-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={ownerIndex <= 0}
                  aria-label={t('admin.media.moveUp')}
                  onClick={() => action.mutate({ image, kind: 'up' })}
                >
                  <ArrowUp aria-hidden="true" size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={ownerIndex >= ownerImages.length - 1}
                  aria-label={t('admin.media.moveDown')}
                  onClick={() => action.mutate({ image, kind: 'down' })}
                >
                  <ArrowDown aria-hidden="true" size={16} />
                </Button>
                {!image.isPrimary ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => action.mutate({ image, kind: 'primary' })}
                  >
                    <Star aria-hidden="true" size={16} />
                    {t('admin.media.makePrimary')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t('admin.media.confirmDelete'))) {
                      action.mutate({ image, kind: 'delete' });
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t('common.delete')}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
