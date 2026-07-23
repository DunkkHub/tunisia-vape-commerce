import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ImagePlus,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type { AdminProductImage, AdminProductPublicationStatus } from '../../api/types';
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
  productPublicationStatus = 'DRAFT',
  needsMediaReview = false,
}: {
  productId: string;
  productVersion: number;
  productPublicationStatus?: AdminProductPublicationStatus;
  needsMediaReview?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reviewQueue, setReviewQueue] = useState(false);
  const [mediaReviewReason, setMediaReviewReason] = useState('');
  const [mediaReviewAcknowledged, setMediaReviewAcknowledged] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [replacementProgress, setReplacementProgress] = useState<{
    imageId: string;
    percentage: number;
  } | null>(null);
  useEffect(() => {
    return () => {
      if (previewUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);
  const images = useQuery({
    queryKey: ['admin', 'product', productId, 'images', page, reviewQueue],
    queryFn: () => adminDataClient.productImages(productId, page, 50, reviewQueue),
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
  useEffect(() => {
    const totalPages = images.data?.totalPages ?? 0;
    if (totalPages <= 0 || page <= totalPages) return;
    const timeout = window.setTimeout(() => setPage(totalPages), 0);
    return () => window.clearTimeout(timeout);
  }, [images.data?.totalPages, page]);
  const upload = useMutation({
    mutationFn: (input: {
      file: File;
      expectedOwnerVersion: number;
      variantId?: string;
      altTextFr: string;
      altTextAr: string;
      isPrimary: boolean;
    }) => adminDataClient.uploadProductImage(productId, input, setUploadProgress),
    onSuccess: async () => {
      setMessage(t('admin.media.uploaded'));
      await refresh();
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadProgress(null);
    },
    onError: () => setUploadProgress(null),
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
      adminDataClient.replaceProductImage(productId, image, file, (percentage) =>
        setReplacementProgress({ imageId: image.id, percentage }),
      ),
    onSuccess: async () => {
      setMessage(t('admin.media.replaced'));
      await refresh();
      setReplacementProgress(null);
    },
    onError: () => setReplacementProgress(null),
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
      return adminDataClient.productImagesForOwner(productId, image.variantId).then((ownerPage) => {
        const ownerImages = [...ownerPage.items].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        );
        const index = ownerImages.findIndex((candidate) => candidate.id === image.id);
        const target = kind === 'up' ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= ownerImages.length) {
          return {
            imageIds: ownerImages.map(({ id }) => id),
            ownerVersion: image.ownerVersion,
          };
        }
        [ownerImages[index], ownerImages[target]] = [ownerImages[target]!, ownerImages[index]!];
        return adminDataClient.reorderProductImages(
          productId,
          image,
          ownerImages.map(({ id }) => id),
        );
      });
    },
    onSuccess: async () => {
      setMessage(t('admin.media.actionCompleted'));
      await refresh();
    },
  });
  const review = useMutation({
    mutationFn: ({
      image,
      decision,
    }: {
      image: AdminProductImage;
      decision: 'APPROVE' | 'REJECT';
    }) => adminDataClient.reviewProductImage(productId, image, decision),
    onSuccess: async () => {
      setMessage(t('admin.media.reviewCompleted'));
      await refresh();
    },
  });
  const completeMediaReview = useMutation({
    mutationFn: () =>
      adminDataClient.confirmProductMediaReview(
        productId,
        productVersion,
        mediaReviewReason.trim(),
      ),
    onSuccess: async () => {
      setMessage(t('admin.media.reviewConfirmed'));
      setMediaReviewReason('');
      setMediaReviewAcknowledged(false);
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
    setUploadProgress(0);
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
    if (file) {
      setReplacementProgress({ imageId: image.id, percentage: 0 });
      replace.mutate({ image, file });
    }
  };
  const error =
    images.error ??
    variants.error ??
    upload.error ??
    metadata.error ??
    replace.error ??
    action.error ??
    review.error ??
    completeMediaReview.error;
  const variantNames = new Map(
    variants.data?.items.map((variant) => [
      variant.id,
      i18n.resolvedLanguage === 'ar' ? variant.nameAr : variant.nameFr,
    ]) ?? [],
  );
  const specificError =
    error instanceof ApiError && error.code === 'PRODUCT_IMAGE_DUPLICATE'
      ? t('admin.media.duplicate')
      : error instanceof ApiError && error.code === 'PRODUCT_IMAGE_UNCHANGED'
        ? t('admin.media.unchanged')
        : error instanceof ApiError && error.code === 'PRODUCT_MEDIA_REVIEW_NOT_READY'
          ? t('admin.media.reviewNotReady')
          : null;

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

      {needsMediaReview && productPublicationStatus === 'DRAFT' ? (
        <form
          className="admin-media-review-completion"
          aria-labelledby="product-media-review-title"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            completeMediaReview.mutate();
          }}
        >
          <div className="admin-media-review-completion__heading">
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <h3 id="product-media-review-title">{t('admin.media.reviewConfirmationTitle')}</h3>
              <p>{t('admin.media.reviewConfirmationDescription')}</p>
            </div>
          </div>
          <FormField
            name="mediaReviewReason"
            label={t('admin.media.reviewReason')}
            hint={t('admin.media.reviewReasonHint')}
            value={mediaReviewReason}
            onChange={(event) => setMediaReviewReason(event.currentTarget.value)}
            minLength={4}
            maxLength={500}
            required
          />
          <CheckboxField
            name="mediaReviewAcknowledged"
            label={t('admin.media.reviewDeclaration')}
            checked={mediaReviewAcknowledged}
            onChange={(event) => setMediaReviewAcknowledged(event.currentTarget.checked)}
          />
          <Button
            type="submit"
            variant="admin"
            loading={completeMediaReview.isPending}
            disabled={!mediaReviewAcknowledged || mediaReviewReason.trim().length < 4}
          >
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.media.confirmReview')}
          </Button>
        </form>
      ) : null}

      <form className="admin-media-upload" onSubmit={(event) => void submitUpload(event)}>
        <div className="admin-form-grid">
          <div className="field">
            <label htmlFor="product-image-file">{t('admin.media.file')}</label>
            <input
              id="product-image-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(event) => {
                const file = event.currentTarget.files?.item(0) ?? null;
                setSelectedFile(file);
                setPreviewUrl(
                  file && typeof URL.createObjectURL === 'function'
                    ? URL.createObjectURL(file)
                    : null,
                );
                setUploadProgress(null);
                setMessage(null);
              }}
              required
            />
            <small>{t('admin.media.allowedTypes')}</small>
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
        {selectedFile && previewUrl ? (
          <figure className="admin-media-preview">
            <img src={previewUrl} alt={t('admin.media.previewAlt')} />
            <figcaption>
              <strong>{selectedFile.name}</strong>
              <span>
                {selectedFile.type || t('admin.media.unknownType')} ·{' '}
                {Math.ceil(selectedFile.size / 1024)} KB
              </span>
            </figcaption>
          </figure>
        ) : null}
        <CheckboxField name="isPrimary" label={t('admin.media.makePrimary')} />
        <Button type="submit" variant="admin" loading={upload.isPending}>
          <ImagePlus aria-hidden="true" size={17} />
          {t('admin.media.upload')}
        </Button>
        {upload.isPending && uploadProgress !== null ? (
          <div className="admin-media-progress" aria-live="polite">
            <span>{t('admin.media.uploadProgress', { percent: uploadProgress })}</span>
            <progress
              aria-label={t('admin.media.uploadProgressLabel')}
              max={100}
              value={uploadProgress}
            />
          </div>
        ) : null}
      </form>

      <label className="admin-media-review-filter">
        <input
          type="checkbox"
          checked={reviewQueue}
          onChange={(event) => {
            setReviewQueue(event.currentTarget.checked);
            setPage(1);
          }}
        />
        <span>{t('admin.media.reviewQueue')}</span>
      </label>

      {message ? (
        <p className="admin-action-success" role="status">
          {message}
        </p>
      ) : null}
      {specificError ? (
        <p className="admin-action-error" role="alert">
          {specificError}
        </p>
      ) : error ? (
        <ErrorState compact />
      ) : null}
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
                {image.originalFilename ? (
                  <span className="admin-media-filename" title={image.originalFilename}>
                    {t('admin.media.originalFilename')}: {image.originalFilename}
                  </span>
                ) : null}
                <span>
                  {t('admin.media.updatedAt')}:{' '}
                  <time dateTime={image.updatedAt}>
                    {new Intl.DateTimeFormat(i18n.resolvedLanguage === 'ar' ? 'ar-TN' : 'fr-TN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(image.updatedAt))}
                  </time>
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
              {image.moderationStatus === 'APPROVED' ? (
                <form
                  className="admin-media-replace"
                  onSubmit={(event) => submitReplacement(image, event)}
                >
                  <label htmlFor={`replace-${image.id}`}>{t('admin.media.replace')}</label>
                  <input
                    id={`replace-${image.id}`}
                    name="file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    required
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    loading={replace.isPending && replacementProgress?.imageId === image.id}
                    disabled={replace.isPending}
                  >
                    {t('admin.media.replace')}
                  </Button>
                  {replace.isPending && replacementProgress?.imageId === image.id ? (
                    <div className="admin-media-progress" aria-live="polite">
                      <span>
                        {t('admin.media.replaceProgress', {
                          percent: replacementProgress.percentage,
                        })}
                      </span>
                      <progress
                        aria-label={t('admin.media.replaceProgressLabel')}
                        max={100}
                        value={replacementProgress.percentage}
                      />
                    </div>
                  ) : null}
                </form>
              ) : null}
              <div className="admin-row-actions">
                {image.moderationStatus === 'APPROVED' && !reviewQueue ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={
                        action.isPending || ((images.data?.total ?? 0) <= 50 && ownerIndex <= 0)
                      }
                      aria-label={t('admin.media.moveUp')}
                      onClick={() => action.mutate({ image, kind: 'up' })}
                    >
                      <ArrowUp aria-hidden="true" size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={
                        action.isPending ||
                        ((images.data?.total ?? 0) <= 50 && ownerIndex >= ownerImages.length - 1)
                      }
                      aria-label={t('admin.media.moveDown')}
                      onClick={() => action.mutate({ image, kind: 'down' })}
                    >
                      <ArrowDown aria-hidden="true" size={16} />
                    </Button>
                  </>
                ) : null}
                {image.moderationStatus === 'PENDING' ? (
                  <>
                    <Button
                      type="button"
                      variant="admin"
                      loading={review.isPending}
                      onClick={() => review.mutate({ image, decision: 'APPROVE' })}
                    >
                      <CheckCircle2 aria-hidden="true" size={16} />
                      {t('admin.media.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      loading={review.isPending}
                      onClick={() => review.mutate({ image, decision: 'REJECT' })}
                    >
                      <XCircle aria-hidden="true" size={16} />
                      {t('admin.media.reject')}
                    </Button>
                  </>
                ) : null}
                {!image.isPrimary && image.moderationStatus === 'APPROVED' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ image, kind: 'primary' })}
                  >
                    <Star aria-hidden="true" size={16} />
                    {t('admin.media.makePrimary')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="danger"
                  disabled={action.isPending}
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
      {(images.data?.totalPages ?? 0) > 1 ? (
        <nav className="admin-media-pagination" aria-label={t('admin.media.pagination')}>
          <Button
            type="button"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t('admin.media.previousPage')}
          </Button>
          <span>
            {t('admin.media.pageStatus', {
              page,
              totalPages: images.data?.totalPages ?? 1,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={page >= (images.data?.totalPages ?? 1)}
            onClick={() => setPage((current) => current + 1)}
          >
            {t('admin.media.nextPage')}
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
