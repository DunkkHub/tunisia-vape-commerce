import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
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
import { CheckboxField, FormField } from '../../components/ui/form-field';
import { invalidatePublicProductCaches } from './admin-product-cache';
import { AdminProductMediaReplacement } from './admin-product-media-replacement';
import { AdminProductMediaUpload } from './admin-product-media-upload';

const formText = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
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
  const [uploadBusy, setUploadBusy] = useState(false);
  const [replacementProgress, setReplacementProgress] = useState<{
    imageId: string;
    percentage: number;
  } | null>(null);
  const [replacementTargetId, setReplacementTargetId] = useState<string | null>(null);
  const [replacementResetToken, setReplacementResetToken] = useState(0);
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
      queryClient.invalidateQueries({
        queryKey: ['admin', 'product', productId],
        exact: true,
      }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] }),
      invalidatePublicProductCaches(queryClient),
    ]);
  };
  useEffect(() => {
    const totalPages = images.data?.totalPages ?? 0;
    if (totalPages <= 0 || page <= totalPages) return;
    const timeout = window.setTimeout(() => setPage(totalPages), 0);
    return () => window.clearTimeout(timeout);
  }, [images.data?.totalPages, page]);
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
      setReplacementTargetId(null);
      setReplacementResetToken((current) => current + 1);
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
            items: ownerImages,
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
  const submitMetadata = (image: AdminProductImage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    metadata.mutate({
      image,
      altTextFr: formText(form, 'altTextFr'),
      altTextAr: formText(form, 'altTextAr'),
    });
  };
  const submitReplacement = (image: AdminProductImage, file: File) => {
    setReplacementTargetId(image.id);
    setReplacementProgress({ imageId: image.id, percentage: 0 });
    replace.mutate({ image, file });
  };
  const error =
    images.error ??
    variants.error ??
    metadata.error ??
    replace.error ??
    action.error ??
    review.error ??
    completeMediaReview.error;
  const mediaMutationPending =
    uploadBusy ||
    metadata.isPending ||
    replace.isPending ||
    action.isPending ||
    review.isPending ||
    completeMediaReview.isPending;
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
            disabled={
              mediaMutationPending ||
              !mediaReviewAcknowledged ||
              mediaReviewReason.trim().length < 4
            }
          >
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.media.confirmReview')}
          </Button>
        </form>
      ) : null}

      <AdminProductMediaUpload
        productId={productId}
        productVersion={productVersion}
        variants={variants.data?.items ?? []}
        disabled={mediaMutationPending && !uploadBusy}
        onBusyChange={setUploadBusy}
        onRefresh={refresh}
        onUploaded={async (successMessage) => {
          setMessage(successMessage);
          await refresh();
        }}
      />

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
                <Button
                  type="submit"
                  variant="admin"
                  loading={metadata.isPending}
                  disabled={mediaMutationPending}
                >
                  {t('common.save')}
                </Button>
              </form>
              {image.moderationStatus === 'APPROVED' ? (
                <AdminProductMediaReplacement
                  imageId={image.id}
                  disabled={mediaMutationPending && replacementTargetId !== image.id}
                  pending={replace.isPending && replacementTargetId === image.id}
                  progress={
                    replacementProgress?.imageId === image.id
                      ? replacementProgress.percentage
                      : null
                  }
                  failed={replace.isError && replacementTargetId === image.id}
                  resetToken={replacementResetToken}
                  onReplace={(file) => submitReplacement(image, file)}
                />
              ) : null}
              <div className="admin-row-actions">
                {image.moderationStatus === 'APPROVED' && !reviewQueue ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={
                        mediaMutationPending || ((images.data?.total ?? 0) <= 50 && ownerIndex <= 0)
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
                        mediaMutationPending ||
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
                      disabled={mediaMutationPending}
                      onClick={() => review.mutate({ image, decision: 'APPROVE' })}
                    >
                      <CheckCircle2 aria-hidden="true" size={16} />
                      {t('admin.media.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      loading={review.isPending}
                      disabled={mediaMutationPending}
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
                    disabled={mediaMutationPending}
                    onClick={() => action.mutate({ image, kind: 'primary' })}
                  >
                    <Star aria-hidden="true" size={16} />
                    {t('admin.media.makePrimary')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="danger"
                  disabled={mediaMutationPending}
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
