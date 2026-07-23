import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { adminDataClient } from '../../api/admin-data-client';
import type {
  AdminProductCreatePayload,
  AdminProductType,
  AdminProductUpdatePayload,
} from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
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

function VariantManager({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const variants = useQuery({
    queryKey: ['admin', 'product', productId, 'variants'],
    queryFn: () => adminDataClient.productVariants(productId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'product', productId, 'variants'] });
  const create = useMutation({
    mutationFn: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const promotional = formText(form, 'promotionalPriceMillimes');
      return adminDataClient.createProductVariant(productId, {
        nameFr: formText(form, 'nameFr'),
        nameAr: formText(form, 'nameAr'),
        sku: formText(form, 'sku'),
        costMillimes: Number(formText(form, 'costMillimes')),
        priceMillimes: Number(formText(form, 'priceMillimes')),
        promotionalPriceMillimes: promotional ? Number(promotional) : null,
        lowStockThreshold: Number(formText(form, 'lowStockThreshold') || '0'),
      });
    },
    onSuccess: () => void refresh(),
  });
  const update = useMutation({
    mutationFn: ({
      variantId,
      event,
    }: {
      variantId: string;
      event: FormEvent<HTMLFormElement>;
    }) => {
      event.preventDefault();
      const variant = variants.data!.items.find((item) => item.id === variantId)!;
      const form = new FormData(event.currentTarget);
      const promotional = formText(form, 'promotionalPriceMillimes');
      const status = formText(form, 'publicationStatus') as 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
      return adminDataClient.updateProductVariant(productId, variantId, {
        version: variant.version,
        priceMillimes: Number(formText(form, 'priceMillimes')),
        promotionalPriceMillimes: promotional ? Number(promotional) : null,
        lowStockThreshold: Number(formText(form, 'lowStockThreshold') || '0'),
        publicationStatus: status,
      });
    },
    onSuccess: () => void refresh(),
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
    onSuccess: () => void refresh(),
  });

  return (
    <section className="admin-panel">
      <h2>{t('admin.variantOps.title')}</h2>
      {variants.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {variants.data?.items.map((variant) => (
        <form
          className="admin-panel"
          key={variant.id}
          onSubmit={(event) => update.mutate({ variantId: variant.id, event })}
        >
          <strong>
            {variant.nameFr} · {variant.sku}
          </strong>
          <div className="admin-form-grid">
            <FormField
              name="priceMillimes"
              label={t('admin.variantOps.priceMillimes')}
              type="number"
              min={0}
              defaultValue={variant.priceMillimes}
            />
            <FormField
              name="promotionalPriceMillimes"
              label={t('admin.variantOps.promotionalPriceMillimes')}
              type="number"
              min={0}
              defaultValue={variant.promotionalPriceMillimes ?? ''}
            />
            <FormField
              name="lowStockThreshold"
              label={t('admin.variantOps.lowStockThreshold')}
              type="number"
              min={0}
              defaultValue={variant.lowStockThreshold}
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
              loading={update.isPending}
              disabled={Boolean(variant.archivedAt)}
            >
              {t('admin.variantOps.update')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={archive.isPending}
              onClick={() =>
                archive.mutate({
                  variantId: variant.id,
                  action: variant.archivedAt ? 'restore' : 'archive',
                })
              }
            >
              {variant.archivedAt ? t('admin.variantOps.restore') : t('admin.variantOps.archive')}
            </Button>
          </div>
        </form>
      ))}
      <form className="admin-panel" onSubmit={(event) => create.mutate(event)}>
        <h3>{t('admin.variantOps.newDraft')}</h3>
        <div className="admin-form-grid">
          <FormField name="nameFr" label={t('admin.nameFr')} required />
          <FormField name="nameAr" label={t('admin.nameAr')} dir="rtl" required />
          <FormField name="sku" label={t('admin.columns.sku')} required />
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
      </form>
      {variants.isError || create.isError || update.isError || archive.isError ? (
        <ErrorState compact />
      ) : null}
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
    basePriceMillimes: integerOrBlank,
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
      basePriceMillimes: '',
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
      basePriceMillimes:
        product.data.basePriceMillimes === null ? '' : String(product.data.basePriceMillimes),
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
        containsNicotine: values.containsNicotine,
        basePriceMillimes: nullableInteger(values.basePriceMillimes),
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
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => {
        void navigate('/admin/catalog');
      }, 600);
    },
  });
  const lifecycle = useMutation({
    mutationFn: () => {
      if (!id || !product.data) throw new Error('Product version is unavailable.');
      return product.data.publicationStatus === 'ARCHIVED'
        ? adminDataClient.restoreProduct(id, product.data.version)
        : adminDataClient.archiveProduct(id, product.data.version);
    },
    onSuccess: () => void navigate('/admin/catalog', { replace: true }),
  });
  const submit = form.handleSubmit((values) => save.mutate(values));

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
      {!editing && (canManageCategories || canManageBrands) ? (
        <section className="admin-panel" aria-labelledby="catalog-foundation-title">
          <h2 id="catalog-foundation-title">{t('admin.taxonomy.title')}</h2>
          <p>{t('admin.taxonomy.hint')}</p>
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
      ) : null}
      <form onSubmit={(event) => void submit(event)} noValidate>
        {!editing ? <p className="form-banner">{t('admin.createDraftNote')}</p> : null}
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
                {category.nameFr}
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
                {brand.name}
              </option>
            ))}
          </SelectField>
          <FormField
            label={t('admin.skuOptional')}
            error={form.formState.errors.sku?.message}
            {...form.register('sku')}
          />
          <FormField
            label={t('admin.basePriceMillimes')}
            type="number"
            min={0}
            inputMode="numeric"
            error={form.formState.errors.basePriceMillimes?.message}
            {...form.register('basePriceMillimes')}
          />
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
        <CheckboxField label={t('admin.containsNicotine')} {...form.register('containsNicotine')} />
        <CheckboxField label={t('admin.featured')} {...form.register('featured')} />
        {editing && product.data?.needsMediaReview && selectedPublicationStatus === 'PUBLISHED' ? (
          <CheckboxField
            label={t('admin.mediaReviewConfirm')}
            {...form.register('mediaReviewConfirmed')}
          />
        ) : null}
        {save.isError ? <ErrorState compact /> : null}
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
        <VariantManager productId={id} />
      ) : null}
      {editing && id && product.data && product.data.publicationStatus !== 'ARCHIVED' ? (
        <AdminProductMediaManager
          productId={id}
          productVersion={product.data.version}
          productPublicationStatus={product.data.publicationStatus}
          needsMediaReview={product.data.needsMediaReview}
        />
      ) : null}
    </div>
  );
}
