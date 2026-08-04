import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, ArrowLeft, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type {
  AdminProductCreatePayload,
  AdminProductType,
  AdminProductUpdatePayload,
} from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { AdminDisclosure } from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import {
  CheckboxField,
  FormField,
  SelectField,
  TextareaField,
} from '../../components/ui/form-field';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { invalidatePublicProductCaches } from './admin-product-cache';
import { AdminProductMediaManager } from './admin-product-media-manager';

const productTypes: AdminProductType[] = [
  'DEVICE',
  'E_LIQUID',
  'POD',
  'PREFILLED_POD_KIT',
  'PREFILLED_REPLACEMENT_POD',
  'COIL',
  'DISPOSABLE',
  'ACCESSORY',
  'OTHER',
];

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function nullableInteger(value: string) {
  return value === '' ? null : Number(value);
}

const formText = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

const errorMessageKeys: Record<string, string> = {
  INVALID_CATALOG_REFERENCE: 'admin.productErrors.invalidCatalogReference',
  INVALID_PROMOTIONAL_PRICE: 'admin.productErrors.invalidPromotionalPrice',
  MEDIA_REVIEW_CONFIRMATION_NOT_APPLICABLE:
    'admin.productErrors.mediaReviewConfirmationNotApplicable',
  PRODUCT_ARCHIVED: 'admin.productErrors.productArchived',
  PRODUCT_PUBLICATION_NOT_READY: 'admin.productErrors.productPublicationNotReady',
  PRODUCT_PUBLICATION_REQUIREMENTS_MISSING:
    'admin.productErrors.productPublicationRequirementsMissing',
  RECENT_AUTHENTICATION_REQUIRED: 'admin.productErrors.recentAuthenticationRequired',
  VALIDATION_ERROR: 'admin.productErrors.validation',
  VARIANT_ARCHIVED: 'admin.productErrors.variantArchived',
  VARIANT_PUBLICATION_NOT_READY: 'admin.productErrors.variantPublicationNotReady',
  VERSION_CONFLICT: 'admin.productErrors.versionConflict',
};

const blockerMessageKeys: Record<string, string> = {
  APPROVED_IMAGE_MISSING: 'admin.productErrors.blockers.approvedImageMissing',
  AVAILABLE_STOCK_MISSING: 'admin.productErrors.blockers.availableStockMissing',
  DELIVERY_METHOD_MISSING: 'admin.productErrors.blockers.deliveryMethodMissing',
  MEDIA_REVIEW_CONFIRMATION_REQUIRED:
    'admin.productErrors.blockers.mediaReviewConfirmationRequired',
  MEDIA_REVIEW_PENDING: 'admin.productErrors.blockers.mediaReviewPending',
  MEDIA_REVIEW_REQUIRED: 'admin.productErrors.blockers.mediaReviewRequired',
  NON_POSITIVE_PRICE: 'admin.productErrors.blockers.nonPositivePrice',
  PRICING_REVIEW_REQUIRED: 'admin.productErrors.blockers.pricingReviewRequired',
  SELLABLE_VARIANT_MISSING: 'admin.productErrors.blockers.sellableVariantMissing',
  STOCK_REVIEW_REQUIRED: 'admin.productErrors.blockers.stockReviewRequired',
  VARIANT_SKU_DUPLICATE: 'admin.productErrors.blockers.variantSkuDuplicate',
  VARIANT_SKU_INVALID: 'admin.productErrors.blockers.variantSkuInvalid',
};

function taxonomyStatusKey(status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED') {
  if (status === 'PUBLISHED') return 'admin.publishedStatus';
  if (status === 'SUSPENDED') return 'admin.suspended';
  if (status === 'ARCHIVED') return 'admin.taxonomy.archivedStatus';
  return 'admin.draft';
}

function AdminMutationError({ error, focus = false }: { error: unknown; focus?: boolean }) {
  const { t } = useTranslation();
  const alertRef = useRef<HTMLElement>(null);
  const apiError = error instanceof ApiError ? error : null;
  const messageKey = apiError ? errorMessageKeys[apiError.code] : undefined;
  const message = messageKey
    ? t(messageKey)
    : apiError?.message || t('admin.productErrors.fallback');

  useEffect(() => {
    if (focus) alertRef.current?.focus();
  }, [error, focus]);

  return (
    <section ref={alertRef} className="admin-form-error" role="alert" tabIndex={-1}>
      <AlertTriangle aria-hidden="true" size={20} />
      <div>
        <strong>{t('admin.productErrors.title')}</strong>
        <p>{message}</p>
        {apiError?.blockers.length ? (
          <>
            <p>{t('admin.productErrors.resolveRequirements')}</p>
            <ul>
              {apiError.blockers.map((blocker) => (
                <li key={blocker}>{t(blockerMessageKeys[blocker] ?? blocker)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {apiError?.requestId ? (
          <small>
            {t('admin.productErrors.requestReference', { requestId: apiError.requestId })}
          </small>
        ) : null}
      </div>
    </section>
  );
}

function VariantManager({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  type CreateVariantPayload = Parameters<typeof adminDataClient.createProductVariant>[1];
  type UpdateVariantPayload = Parameters<typeof adminDataClient.updateProductVariant>[2];
  const variants = useQuery({
    queryKey: ['admin', 'product', productId, 'variants'],
    queryFn: () => adminDataClient.productVariants(productId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId, 'variants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] }),
      invalidatePublicProductCaches(queryClient),
    ]);
  };
  const create = useMutation({
    mutationFn: (payload: CreateVariantPayload) =>
      adminDataClient.createProductVariant(productId, payload),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ variantId, payload }: { variantId: string; payload: UpdateVariantPayload }) =>
      adminDataClient.updateProductVariant(productId, variantId, payload),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: ({ variantId, action }: { variantId: string; action: 'archive' | 'restore' }) => {
      const variant = variants.data!.items.find((item) => item.id === variantId)!;
      return adminDataClient.productVariantArchiveAction(
        productId,
        variantId,
        action,
        variant.version,
      );
    },
    onSuccess: refresh,
  });
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const promotional = formText(form, 'promotionalPriceMillimes');
    create.mutate({
      nameFr: formText(form, 'nameFr'),
      nameAr: formText(form, 'nameAr'),
      sku: formText(form, 'sku'),
      color: nullableText(formText(form, 'color')),
      costMillimes: Number(formText(form, 'costMillimes')),
      priceMillimes: Number(formText(form, 'priceMillimes')),
      promotionalPriceMillimes: promotional ? Number(promotional) : null,
      lowStockThreshold: Number(formText(form, 'lowStockThreshold') || '0'),
    });
  };
  const submitUpdate = (event: FormEvent<HTMLFormElement>, variantId: string) => {
    event.preventDefault();
    const variant = variants.data?.items.find((item) => item.id === variantId);
    if (!variant) return;
    const form = new FormData(event.currentTarget);
    const promotional = formText(form, 'promotionalPriceMillimes');
    const cost = formText(form, 'costMillimes');
    const publicationStatus = formText(form, 'publicationStatus') as
      'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
    update.mutate({
      variantId,
      payload: {
        version: variant.version,
        nameFr: formText(form, 'nameFr'),
        nameAr: formText(form, 'nameAr'),
        sku: formText(form, 'sku'),
        color: nullableText(formText(form, 'color')),
        ...(cost ? { costMillimes: Number(cost) } : {}),
        priceMillimes: Number(formText(form, 'priceMillimes')),
        promotionalPriceMillimes: promotional ? Number(promotional) : null,
        lowStockThreshold: Number(formText(form, 'lowStockThreshold') || '0'),
        publicationStatus,
      },
    });
  };

  return (
    <section className="admin-panel">
      <h2>{t('admin.variantOps.title')}</h2>
      <p className="admin-editor__hint">{t('admin.variantOps.saveSeparately')}</p>
      {variants.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {variants.data?.items.map((variant) => (
        <form
          className="admin-panel"
          key={variant.id}
          onSubmit={(event) => submitUpdate(event, variant.id)}
        >
          <strong>
            {variant.nameFr} · {variant.sku}
          </strong>
          <div className="admin-form-grid">
            <FormField
              name="nameFr"
              label={t('admin.nameFr')}
              defaultValue={variant.nameFr}
              maxLength={200}
              disabled={Boolean(variant.archivedAt)}
              required
            />
            <FormField
              name="nameAr"
              label={t('admin.nameAr')}
              defaultValue={variant.nameAr}
              maxLength={200}
              dir="rtl"
              disabled={Boolean(variant.archivedAt)}
              required
            />
            <FormField
              name="sku"
              label={t('admin.columns.sku')}
              defaultValue={variant.sku}
              maxLength={100}
              disabled={Boolean(variant.archivedAt)}
              required
            />
            <FormField
              name="color"
              label={t('admin.variantOps.color')}
              defaultValue={variant.color ?? ''}
              maxLength={100}
              disabled={Boolean(variant.archivedAt)}
            />
            <FormField
              name="costMillimes"
              label={t('admin.variantOps.costMillimes')}
              type="number"
              min={0}
              defaultValue={variant.costMillimes ?? ''}
              disabled={Boolean(variant.archivedAt)}
            />
            <FormField
              name="priceMillimes"
              label={t('admin.variantOps.priceMillimes')}
              type="number"
              min={0}
              defaultValue={variant.priceMillimes}
              disabled={Boolean(variant.archivedAt)}
              required
            />
            <FormField
              name="promotionalPriceMillimes"
              label={t('admin.variantOps.promotionalPriceMillimes')}
              type="number"
              min={0}
              defaultValue={variant.promotionalPriceMillimes ?? ''}
              disabled={Boolean(variant.archivedAt)}
            />
            <FormField
              name="lowStockThreshold"
              label={t('admin.variantOps.lowStockThreshold')}
              type="number"
              min={0}
              defaultValue={variant.lowStockThreshold}
              disabled={Boolean(variant.archivedAt)}
            />
            <SelectField
              name="publicationStatus"
              label={t('common.status')}
              defaultValue={
                variant.publicationStatus === 'ARCHIVED' ? 'DRAFT' : variant.publicationStatus
              }
              disabled={Boolean(variant.archivedAt)}
            >
              <option value="DRAFT">{t('admin.draft')}</option>
              <option value="PUBLISHED">{t('admin.publishedStatus')}</option>
              <option value="SUSPENDED">{t('admin.suspended')}</option>
            </SelectField>
          </div>
          <div className="admin-heading-actions">
            <Button
              type="submit"
              variant="admin"
              loading={update.isPending && update.variables?.variantId === variant.id}
              disabled={Boolean(variant.archivedAt)}
            >
              {t('admin.variantOps.update')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={archive.isPending && archive.variables?.variantId === variant.id}
              onClick={() =>
                archive.mutate({
                  variantId: variant.id,
                  action: variant.archivedAt ? 'restore' : 'archive',
                })
              }
            >
              {variant.archivedAt ? t('admin.variantOps.restore') : t('admin.variantOps.archive')}
            </Button>
            <Button variant="ghost" asChild>
              <Link to={`/admin/inventory/${variant.id}`}>{t('admin.variantOps.manageStock')}</Link>
            </Button>
          </div>
          {update.isSuccess && update.variables?.variantId === variant.id ? (
            <p className="form-banner form-banner--success" role="status">
              <ShieldCheck aria-hidden="true" size={17} />
              {t('admin.variantOps.updated')}
            </p>
          ) : null}
          {update.isError && update.variables?.variantId === variant.id ? (
            <AdminMutationError error={update.error} focus />
          ) : null}
          {archive.isError && archive.variables?.variantId === variant.id ? (
            <AdminMutationError error={archive.error} focus />
          ) : null}
        </form>
      ))}
      <form className="admin-panel" onSubmit={submitCreate}>
        <h3>{t('admin.variantOps.newDraft')}</h3>
        <div className="admin-form-grid">
          <FormField name="nameFr" label={t('admin.nameFr')} required />
          <FormField name="nameAr" label={t('admin.nameAr')} dir="rtl" required />
          <FormField name="sku" label={t('admin.columns.sku')} required />
          <FormField name="color" label={t('admin.variantOps.color')} maxLength={100} />
          <FormField
            name="costMillimes"
            label={t('admin.variantOps.costMillimes')}
            type="number"
            min={0}
            required
          />
          <FormField
            name="priceMillimes"
            label={t('admin.variantOps.priceMillimes')}
            type="number"
            min={0}
            required
          />
          <FormField
            name="promotionalPriceMillimes"
            label={t('admin.variantOps.promotionalPriceMillimes')}
            type="number"
            min={0}
          />
          <FormField
            name="lowStockThreshold"
            label={t('admin.variantOps.lowStockThreshold')}
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <Button type="submit" variant="admin" loading={create.isPending}>
          {t('admin.variantOps.create')}
        </Button>
        {create.isSuccess ? (
          <p className="form-banner form-banner--success" role="status">
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.variantOps.created')}
          </p>
        ) : null}
        {create.isError ? <AdminMutationError error={create.error} focus /> : null}
      </form>
      {variants.isError ? <ErrorState compact onRetry={() => void variants.refetch()} /> : null}
    </section>
  );
}

export function AdminProductEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
  const canManageCategories = Boolean(user?.permissions.includes('categories.manage'));
  const canManageBrands = Boolean(user?.permissions.includes('brands.manage'));
  const canArchive = Boolean(user?.permissions.includes('products.archive'));
  const [saved, setSaved] = useState(false);
  const [taxonomyMessage, setTaxonomyMessage] = useState<string | null>(null);
  const pendingCategorySelection = useRef<string | null>(null);
  const pendingBrandSelection = useRef<string | null>(null);
  const integerOrBlank = z
    .string()
    .refine((value) => value === '' || /^\d+$/.test(value), t('validation.integer'));
  const schema = z.object({
    categoryId: z.string().trim().min(1, t('validation.required')),
    brandId: z.string(),
    nameFr: z.string().trim().min(2, t('validation.required')),
    nameAr: z.string().trim().min(2, t('validation.required')),
    slug: z
      .string()
      .trim()
      .min(2, t('validation.required'))
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, t('validation.slug')),
    productType: z.enum(productTypes),
    flavor: z.string().max(160),
    sku: z.string(),
    shortDescriptionFr: z.string().max(320),
    shortDescriptionAr: z.string().max(320),
    descriptionFr: z.string().max(20_000),
    descriptionAr: z.string().max(20_000),
    basePriceMillimes: integerOrBlank,
    promotionalPriceMillimes: integerOrBlank,
    minimumAge: integerOrBlank.refine(
      (value) => value === '' || (Number(value) >= 1 && Number(value) <= 120),
      t('validation.ageRange'),
    ),
    warningFr: z.string(),
    warningAr: z.string(),
    containsNicotine: z.boolean(),
    featured: z.boolean(),
    publicationStatus: z.enum(['DRAFT', 'PUBLISHED', 'SUSPENDED']),
    mediaReviewConfirmed: z.boolean(),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      categoryId: '',
      brandId: '',
      nameFr: '',
      nameAr: '',
      slug: '',
      productType: 'OTHER',
      flavor: '',
      sku: '',
      shortDescriptionFr: '',
      shortDescriptionAr: '',
      descriptionFr: '',
      descriptionAr: '',
      basePriceMillimes: '',
      promotionalPriceMillimes: '',
      minimumAge: '18',
      warningFr: '',
      warningAr: '',
      containsNicotine: false,
      featured: false,
      publicationStatus: 'DRAFT',
      mediaReviewConfirmed: false,
    },
  });
  const selectedPublicationStatus = useWatch({
    control: form.control,
    name: 'publicationStatus',
  });
  const selectedCategoryId = useWatch({
    control: form.control,
    name: 'categoryId',
  });
  const selectedBrandId = useWatch({
    control: form.control,
    name: 'brandId',
  });
  const product = useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => adminDataClient.product(id ?? ''),
    enabled: editing,
  });
  const categories = useQuery({
    queryKey: ['admin', 'categories', 'editor'],
    queryFn: adminDataClient.categories,
  });
  const brands = useQuery({
    queryKey: ['admin', 'brands', 'editor'],
    queryFn: adminDataClient.brands,
  });
  const selectedCategory = categories.data?.items.find(
    (category) => category.id === selectedCategoryId,
  );
  const selectedBrand = brands.data?.items.find((brand) => brand.id === selectedBrandId);
  const categoryNeedsPublication =
    selectedCategory !== undefined && selectedCategory.publicationStatus !== 'PUBLISHED';
  const brandNeedsPublication =
    selectedBrand !== undefined && selectedBrand.publicationStatus !== 'PUBLISHED';
  const createCategory = useMutation({
    mutationFn: async (payload: { nameFr: string; nameAr: string; slug: string }) => {
      const created = await adminDataClient.createCategory(payload);
      return adminDataClient.publishCategory(created);
    },
    onSuccess: (category) => {
      pendingCategorySelection.current = category.id;
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.categories>>>(
        ['admin', 'categories', 'editor'],
        (current) => {
          const items = [
            category,
            ...(current?.items.filter((item) => item.id !== category.id) ?? []),
          ];
          return {
            items,
            page: current?.page ?? 1,
            pageSize: current?.pageSize ?? 50,
            total: Math.max(current?.total ?? 0, items.length),
            totalPages: Math.max(current?.totalPages ?? 0, 1),
          };
        },
      );
      setTaxonomyMessage(t('admin.taxonomy.categoryCreated'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
  });
  const createBrand = useMutation({
    mutationFn: async (payload: { name: string; slug: string }) => {
      const created = await adminDataClient.createBrand(payload);
      return adminDataClient.publishBrand(created);
    },
    onSuccess: (brand) => {
      pendingBrandSelection.current = brand.id;
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.brands>>>(
        ['admin', 'brands', 'editor'],
        (current) => {
          const items = [brand, ...(current?.items.filter((item) => item.id !== brand.id) ?? [])];
          return {
            items,
            page: current?.page ?? 1,
            pageSize: current?.pageSize ?? 50,
            total: Math.max(current?.total ?? 0, items.length),
            totalPages: Math.max(current?.totalPages ?? 0, 1),
          };
        },
      );
      setTaxonomyMessage(t('admin.taxonomy.brandCreated'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
  });

  useEffect(() => {
    const categoryId = pendingCategorySelection.current;
    if (categoryId && categories.data?.items.some((category) => category.id === categoryId)) {
      form.setValue('categoryId', categoryId, { shouldValidate: true });
      pendingCategorySelection.current = null;
    }
    const brandId = pendingBrandSelection.current;
    if (brandId && brands.data?.items.some((brand) => brand.id === brandId)) {
      form.setValue('brandId', brandId, { shouldValidate: true });
      pendingBrandSelection.current = null;
    }
  }, [brands.data?.items, categories.data?.items, form]);

  useEffect(() => {
    if (!product.data) return;
    form.reset({
      categoryId: product.data.categoryId,
      brandId: product.data.brandId ?? '',
      nameFr: product.data.nameFr,
      nameAr: product.data.nameAr,
      slug: product.data.slug,
      productType: product.data.productType,
      flavor: product.data.flavor ?? '',
      sku: product.data.sku ?? '',
      shortDescriptionFr: product.data.shortDescriptionFr ?? '',
      shortDescriptionAr: product.data.shortDescriptionAr ?? '',
      descriptionFr: product.data.descriptionFr ?? '',
      descriptionAr: product.data.descriptionAr ?? '',
      basePriceMillimes:
        product.data.basePriceMillimes === null ? '' : String(product.data.basePriceMillimes),
      promotionalPriceMillimes:
        product.data.promotionalPriceMillimes === null
          ? ''
          : String(product.data.promotionalPriceMillimes),
      minimumAge: product.data.minimumAge === null ? '' : String(product.data.minimumAge),
      warningFr: product.data.warningFr ?? '',
      warningAr: product.data.warningAr ?? '',
      containsNicotine: product.data.containsNicotine,
      featured: product.data.featured,
      publicationStatus:
        product.data.publicationStatus === 'ARCHIVED' ? 'DRAFT' : product.data.publicationStatus,
      mediaReviewConfirmed: false,
    });
  }, [form, product.data]);

  const save = useMutation({
    mutationFn: (values: Values) => {
      const common: AdminProductCreatePayload = {
        categoryId: values.categoryId,
        brandId: nullableText(values.brandId),
        nameFr: values.nameFr,
        nameAr: values.nameAr,
        slug: values.slug,
        productType: values.productType,
        flavor: nullableText(values.flavor),
        sku: nullableText(values.sku),
        shortDescriptionFr: nullableText(values.shortDescriptionFr),
        shortDescriptionAr: nullableText(values.shortDescriptionAr),
        descriptionFr: nullableText(values.descriptionFr),
        descriptionAr: nullableText(values.descriptionAr),
        containsNicotine: values.containsNicotine,
        basePriceMillimes: nullableInteger(values.basePriceMillimes),
        promotionalPriceMillimes: nullableInteger(values.promotionalPriceMillimes),
        warningFr: nullableText(values.warningFr),
        warningAr: nullableText(values.warningAr),
        minimumAge: nullableInteger(values.minimumAge),
        featured: values.featured,
      };
      if (!editing || !id) return adminDataClient.createProduct(common);
      if (!product.data) throw new Error('Product version is unavailable.');
      const update: AdminProductUpdatePayload = {
        ...common,
        version: product.data.version,
        publicationStatus: values.publicationStatus,
        ...(product.data.needsMediaReview
          ? { mediaReviewConfirmed: values.mediaReviewConfirmed }
          : {}),
      };
      return adminDataClient.updateProduct(id, update);
    },
    onMutate: () => {
      setSaved(false);
      form.clearErrors('slug');
    },
    onSuccess: async (savedProduct) => {
      queryClient.setQueryData(['admin', 'product', savedProduct.id], savedProduct);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'product', savedProduct.id] }),
        invalidatePublicProductCaches(queryClient),
      ]);
      setSaved(true);
      setTimeout(() => {
        void navigate('/admin/catalog');
      }, 600);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PRODUCT_SLUG_CONFLICT') {
        form.setError(
          'slug',
          { type: 'server', message: t('admin.productErrors.slugConflict') },
          { shouldFocus: true },
        );
      }
    },
  });
  const publishSelectedCategory = useMutation({
    mutationFn: adminDataClient.publishCategory,
    onSuccess: (category) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.categories>>>(
        ['admin', 'categories', 'editor'],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === category.id ? category : item)),
              }
            : current,
      );
      setTaxonomyMessage(t('admin.taxonomy.categoryPublished'));
      save.reset();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
  });
  const publishSelectedBrand = useMutation({
    mutationFn: adminDataClient.publishBrand,
    onSuccess: (brand) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.brands>>>(
        ['admin', 'brands', 'editor'],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === brand.id ? brand : item)),
              }
            : current,
      );
      setTaxonomyMessage(t('admin.taxonomy.brandPublished'));
      save.reset();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
    },
  });
  const lifecycle = useMutation({
    mutationFn: () => {
      if (!id || !product.data) throw new Error('Product version is unavailable.');
      return product.data.publicationStatus === 'ARCHIVED'
        ? adminDataClient.restoreProduct(id, product.data.version)
        : adminDataClient.archiveProduct(id, product.data.version);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'product', id] }),
        invalidatePublicProductCaches(queryClient),
      ]);
      void navigate('/admin/catalog', { replace: true });
    },
  });
  const submit = form.handleSubmit((values) => save.mutate(values));
  const slugConflict =
    save.error instanceof ApiError && save.error.code === 'PRODUCT_SLUG_CONFLICT';

  if (editing && product.isPending)
    return <LoadingState label={t('common.loading')} tone="admin" />;
  if (editing && product.isError) return <ErrorState onRetry={() => void product.refetch()} />;

  return (
    <div className="admin-page admin-editor">
      <Link className="back-link" to="/admin/catalog">
        <ArrowLeft aria-hidden="true" size={17} />
        {t('admin.catalog')}
      </Link>
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('admin.catalog')}</span>
          <h1>{t('admin.productEditor')}</h1>
          <p>{t('admin.productEditorSubtitle')}</p>
        </div>
        {editing && product.data && canArchive ? (
          <Button
            type="button"
            variant={product.data.publicationStatus === 'ARCHIVED' ? 'admin' : 'danger'}
            loading={lifecycle.isPending}
            onClick={() => lifecycle.mutate()}
          >
            {product.data.publicationStatus === 'ARCHIVED' ? (
              <RotateCcw aria-hidden="true" size={17} />
            ) : (
              <Archive aria-hidden="true" size={17} />
            )}
            {t(
              product.data.publicationStatus === 'ARCHIVED'
                ? 'admin.taxonomy.restoreProduct'
                : 'admin.taxonomy.archiveProduct',
            )}
          </Button>
        ) : null}
      </header>
      {product.data?.publicationStatus === 'ARCHIVED' ? (
        <p className="form-banner">{t('admin.taxonomy.archivedProductHint')}</p>
      ) : null}
      {editing && user?.requiresRecentAuthentication ? (
        <p className="form-banner admin-editor__session-notice" role="note">
          <ShieldCheck aria-hidden="true" size={18} />
          {t('admin.productErrors.recentAuthenticationRequired')}
        </p>
      ) : null}
      {editing && taxonomyMessage ? (
        <p className="form-banner form-banner--success" role="status">
          <ShieldCheck aria-hidden="true" size={17} />
          {taxonomyMessage}
        </p>
      ) : null}
      {!editing && (canManageCategories || canManageBrands) ? (
        <AdminDisclosure title={t('admin.taxonomy.title')} description={t('admin.taxonomy.hint')}>
          <section className="admin-taxonomy-tools" aria-label={t('admin.taxonomy.title')}>
            {taxonomyMessage ? (
              <p className="form-banner form-banner--success" role="status">
                {taxonomyMessage}
              </p>
            ) : null}
            {canManageCategories ? (
              <form
                className="admin-form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  createCategory.mutate({
                    nameFr: formText(data, 'nameFr'),
                    nameAr: formText(data, 'nameAr'),
                    slug: formText(data, 'slug'),
                  });
                }}
              >
                <FormField name="nameFr" label={t('admin.nameFr')} required maxLength={160} />
                <FormField
                  name="nameAr"
                  label={t('admin.nameAr')}
                  required
                  maxLength={160}
                  dir="rtl"
                />
                <FormField
                  name="slug"
                  label={t('admin.slug')}
                  required
                  maxLength={180}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                />
                <Button type="submit" variant="admin" loading={createCategory.isPending}>
                  <Plus aria-hidden="true" size={17} /> {t('admin.taxonomy.createCategory')}
                </Button>
              </form>
            ) : null}
            {canManageBrands ? (
              <form
                className="admin-form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  createBrand.mutate({
                    name: formText(data, 'name'),
                    slug: formText(data, 'slug'),
                  });
                }}
              >
                <FormField
                  name="name"
                  label={t('admin.taxonomy.brandName')}
                  required
                  maxLength={160}
                />
                <FormField
                  name="slug"
                  label={t('admin.slug')}
                  required
                  maxLength={180}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                />
                <Button type="submit" variant="admin" loading={createBrand.isPending}>
                  <Plus aria-hidden="true" size={17} /> {t('admin.taxonomy.createBrand')}
                </Button>
              </form>
            ) : null}
            {createCategory.isError || createBrand.isError ? <ErrorState compact /> : null}
          </section>
        </AdminDisclosure>
      ) : null}
      <form className="admin-product-form" onSubmit={(event) => void submit(event)} noValidate>
        {!editing ? <p className="form-banner">{t('admin.createDraftNote')}</p> : null}
        {editing &&
        selectedPublicationStatus === 'PUBLISHED' &&
        (categoryNeedsPublication || brandNeedsPublication) ? (
          <section className="admin-publication-guidance" aria-labelledby="taxonomy-status-title">
            <div>
              <h2 id="taxonomy-status-title">{t('admin.taxonomy.publicationTitle')}</h2>
              <p>{t('admin.taxonomy.publicationHint')}</p>
            </div>
            <div className="admin-publication-guidance__items">
              {categoryNeedsPublication && selectedCategory ? (
                <article>
                  <div>
                    <strong>{selectedCategory.nameFr}</strong>
                    <span>{t(taxonomyStatusKey(selectedCategory.publicationStatus))}</span>
                  </div>
                  {canManageCategories && selectedCategory.publicationStatus !== 'ARCHIVED' ? (
                    <Button
                      type="button"
                      variant="admin"
                      loading={publishSelectedCategory.isPending}
                      onClick={() => publishSelectedCategory.mutate(selectedCategory)}
                    >
                      {t('admin.taxonomy.publishSelectedCategory')}
                    </Button>
                  ) : (
                    <small>{t('admin.taxonomy.publicationUnavailable')}</small>
                  )}
                </article>
              ) : null}
              {brandNeedsPublication && selectedBrand ? (
                <article>
                  <div>
                    <strong>{selectedBrand.name}</strong>
                    <span>{t(taxonomyStatusKey(selectedBrand.publicationStatus))}</span>
                  </div>
                  {canManageBrands && selectedBrand.publicationStatus !== 'ARCHIVED' ? (
                    <Button
                      type="button"
                      variant="admin"
                      loading={publishSelectedBrand.isPending}
                      onClick={() => publishSelectedBrand.mutate(selectedBrand)}
                    >
                      {t('admin.taxonomy.publishSelectedBrand')}
                    </Button>
                  ) : (
                    <small>{t('admin.taxonomy.publicationUnavailable')}</small>
                  )}
                </article>
              ) : null}
            </div>
            {publishSelectedCategory.isError ? (
              <AdminMutationError error={publishSelectedCategory.error} focus />
            ) : null}
            {publishSelectedBrand.isError ? (
              <AdminMutationError error={publishSelectedBrand.error} focus />
            ) : null}
          </section>
        ) : null}
        <div className="admin-product-form__groups">
          <fieldset className="admin-form-group">
            <legend>{t('admin.ui.productIdentity')}</legend>
            <div className="admin-form-grid">
              <FormField
                label={t('admin.nameFr')}
                lang="fr"
                error={form.formState.errors.nameFr?.message}
                {...form.register('nameFr')}
              />
              <FormField
                label={t('admin.nameAr')}
                lang="ar"
                dir="rtl"
                error={form.formState.errors.nameAr?.message}
                {...form.register('nameAr')}
              />
              <FormField
                label={t('admin.slug')}
                error={form.formState.errors.slug?.message}
                {...form.register('slug')}
              />
              <SelectField
                label={t('admin.productType')}
                error={form.formState.errors.productType?.message}
                {...form.register('productType')}
              >
                {productTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`admin.productTypes.${type}`)}
                  </option>
                ))}
              </SelectField>
              <FormField
                label={t('admin.flavorOptional')}
                error={form.formState.errors.flavor?.message}
                {...form.register('flavor')}
              />
              <SelectField
                label={t('admin.categoryId')}
                error={form.formState.errors.categoryId?.message}
                {...form.register('categoryId')}
              >
                <option value="">—</option>
                {categories.data?.items.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameFr} {'\u00b7'} {t(taxonomyStatusKey(category.publicationStatus))}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('admin.brandOptional')}
                error={form.formState.errors.brandId?.message}
                {...form.register('brandId')}
              >
                <option value="">—</option>
                {brands.data?.items.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name} {'\u00b7'} {t(taxonomyStatusKey(brand.publicationStatus))}
                  </option>
                ))}
              </SelectField>
              <FormField
                label={t('admin.skuOptional')}
                error={form.formState.errors.sku?.message}
                {...form.register('sku')}
              />
            </div>
          </fieldset>
          <fieldset className="admin-form-group">
            <legend>{t('admin.ui.productPricing')}</legend>
            <div className="admin-form-grid">
              <FormField
                label={t('admin.basePriceMillimes')}
                type="number"
                min={0}
                inputMode="numeric"
                error={form.formState.errors.basePriceMillimes?.message}
                {...form.register('basePriceMillimes')}
              />
              <FormField
                label={t('admin.productPromotionalPriceMillimes')}
                type="number"
                min={0}
                inputMode="numeric"
                error={form.formState.errors.promotionalPriceMillimes?.message}
                {...form.register('promotionalPriceMillimes')}
              />
            </div>
          </fieldset>
          <fieldset className="admin-form-group">
            <legend>{t('admin.ui.productContent')}</legend>
            <div className="admin-form-grid">
              <FormField
                label={t('admin.shortDescriptionFr')}
                lang="fr"
                error={form.formState.errors.shortDescriptionFr?.message}
                {...form.register('shortDescriptionFr')}
              />
              <FormField
                label={t('admin.shortDescriptionAr')}
                lang="ar"
                dir="rtl"
                error={form.formState.errors.shortDescriptionAr?.message}
                {...form.register('shortDescriptionAr')}
              />
              <TextareaField
                className="field--wide"
                label={t('admin.descriptionFr')}
                lang="fr"
                rows={7}
                maxLength={20_000}
                error={form.formState.errors.descriptionFr?.message}
                {...form.register('descriptionFr')}
              />
              <TextareaField
                className="field--wide"
                label={t('admin.descriptionAr')}
                lang="ar"
                dir="rtl"
                rows={7}
                maxLength={20_000}
                error={form.formState.errors.descriptionAr?.message}
                {...form.register('descriptionAr')}
              />
              <FormField
                label={t('admin.warningFr')}
                lang="fr"
                error={form.formState.errors.warningFr?.message}
                {...form.register('warningFr')}
              />
              <FormField
                label={t('admin.warningAr')}
                lang="ar"
                dir="rtl"
                error={form.formState.errors.warningAr?.message}
                {...form.register('warningAr')}
              />
            </div>
          </fieldset>
          <fieldset className="admin-form-group">
            <legend>{t('admin.ui.productPublication')}</legend>
            <div className="admin-form-grid">
              <FormField
                label={t('admin.minimumAge')}
                type="number"
                min={1}
                max={120}
                inputMode="numeric"
                error={form.formState.errors.minimumAge?.message}
                {...form.register('minimumAge')}
              />
              {editing ? (
                <SelectField label={t('common.status')} {...form.register('publicationStatus')}>
                  <option value="DRAFT">{t('admin.draft')}</option>
                  <option value="PUBLISHED">{t('admin.publishedStatus')}</option>
                  <option value="SUSPENDED">{t('admin.suspended')}</option>
                </SelectField>
              ) : null}
            </div>
            <CheckboxField
              label={t('admin.containsNicotine')}
              {...form.register('containsNicotine')}
            />
            <CheckboxField label={t('admin.featured')} {...form.register('featured')} />
            {editing &&
            product.data?.needsMediaReview &&
            selectedPublicationStatus === 'PUBLISHED' ? (
              <CheckboxField
                label={t('admin.mediaReviewConfirm')}
                {...form.register('mediaReviewConfirmed')}
              />
            ) : null}
          </fieldset>
        </div>
        {save.isError && !slugConflict ? <AdminMutationError error={save.error} focus /> : null}
        {saved ? (
          <p className="form-banner form-banner--success" role="status">
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.productSaved')}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="admin"
          loading={save.isPending}
          disabled={product.data?.publicationStatus === 'ARCHIVED'}
        >
          {t('admin.saveProduct')}
        </Button>
      </form>
      {editing && id && product.data?.publicationStatus !== 'ARCHIVED' ? (
        <AdminDisclosure
          title={t('admin.variantOps.title')}
          description={t('admin.variantOps.saveSeparately')}
        >
          <VariantManager productId={id} />
        </AdminDisclosure>
      ) : null}
      {editing && id && product.data && product.data.publicationStatus !== 'ARCHIVED' ? (
        <AdminDisclosure title={t('admin.media.title')} description={t('admin.media.description')}>
          <AdminProductMediaManager
            productId={id}
            productVersion={product.data.version}
            productPublicationStatus={product.data.publicationStatus}
            needsMediaReview={product.data.needsMediaReview}
          />
        </AdminDisclosure>
      ) : null}
    </div>
  );
}
