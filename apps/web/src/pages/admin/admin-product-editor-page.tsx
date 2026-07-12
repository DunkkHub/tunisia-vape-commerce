import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { adminDataClient } from '../../api/admin-data-client';
import type {
  AdminProductCreatePayload,
  AdminProductType,
  AdminProductUpdatePayload,
} from '../../api/types';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { ErrorState, LoadingState } from '../../components/ui/feedback';

const productTypes: AdminProductType[] = [
  'DEVICE',
  'E_LIQUID',
  'POD',
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

export function AdminProductEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
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
    },
  });
  const product = useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => adminDataClient.product(id ?? ''),
    enabled: editing,
  });

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
      publicationStatus: product.data.publicationStatus,
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
      </header>
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
          <FormField
            label={t('admin.categoryId')}
            error={form.formState.errors.categoryId?.message}
            {...form.register('categoryId')}
          />
          <FormField
            label={t('admin.brandOptional')}
            error={form.formState.errors.brandId?.message}
            {...form.register('brandId')}
          />
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
        {save.isError ? <ErrorState compact /> : null}
        {saved ? (
          <p className="form-banner form-banner--success" role="status">
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.productSaved')}
          </p>
        ) : null}
        <Button type="submit" variant="admin" loading={save.isPending}>
          {t('admin.saveProduct')}
        </Button>
      </form>
    </div>
  );
}
