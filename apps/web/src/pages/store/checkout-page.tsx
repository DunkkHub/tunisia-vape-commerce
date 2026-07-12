import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Banknote, LockKeyhole, MapPin, ShieldCheck } from 'lucide-react';
import { useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { storefrontClient } from '../../api/storefront-client';
import type { CheckoutPayload } from '../../api/types';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';

function optionalText() {
  return z.string().trim().optional();
}

function checkoutSchema(t: (key: string) => string) {
  return z.object({
    fullName: z.string().trim().min(2, t('validation.required')),
    phone: z
      .string()
      .trim()
      .regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
    email: z.union([z.literal(''), z.email(t('validation.email'))]),
    governorateId: z.string().min(1, t('validation.required')),
    delegationId: z.string().min(1, t('validation.required')),
    localityId: z.string().min(1, t('validation.required')),
    postalCode: z.string().regex(/^\d{4}$/, t('validation.postalCode')),
    street: z.string().trim().min(3, t('validation.required')),
    building: optionalText(),
    floor: optionalText(),
    apartment: optionalText(),
    landmark: optionalText(),
    deliveryInstructions: optionalText(),
    deliveryMethod: z.enum(['DELIVERY', 'PICKUP']),
    preferredDeliveryDate: optionalText(),
    preferredDeliveryTimeWindowId: optionalText(),
    adultConfirmation: z.boolean().refine(Boolean, t('validation.adult')),
    termsAccepted: z.boolean().refine(Boolean, t('validation.terms')),
    privacyAccepted: z.boolean().refine(Boolean, t('validation.terms')),
  });
}

export function CheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useStorefrontStatus();
  const idempotencyKey = useRef(globalThis.crypto.randomUUID());
  const schema = checkoutSchema(t);
  type FormValues = z.input<typeof schema>;
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      deliveryMethod: 'DELIVERY',
      adultConfirmation: false,
      termsAccepted: false,
      privacyAccepted: false,
      email: '',
    },
  });
  const governorateId = useWatch({ control, name: 'governorateId' }) ?? '';
  const delegationId = useWatch({ control, name: 'delegationId' }) ?? '';
  const localityId = useWatch({ control, name: 'localityId' }) ?? '';
  const governorates = useQuery({
    queryKey: ['geography', 'governorates'],
    queryFn: storefrontClient.governorates,
  });
  const delegations = useQuery({
    queryKey: ['geography', 'delegations', governorateId],
    queryFn: () => storefrontClient.delegations(governorateId),
    enabled: Boolean(governorateId),
  });
  const localities = useQuery({
    queryKey: ['geography', 'localities', delegationId],
    queryFn: () => storefrontClient.localities(delegationId),
    enabled: Boolean(delegationId),
  });
  const windows = useQuery({
    queryKey: ['delivery', 'windows', localityId],
    queryFn: () => storefrontClient.deliveryWindows(localityId),
    enabled: Boolean(localityId),
  });
  const checkoutMutation = useMutation({
    mutationFn: (payload: CheckoutPayload) =>
      storefrontClient.checkout(payload, idempotencyKey.current),
    onSuccess: (result) => {
      void navigate(`/order-confirmation/${encodeURIComponent(result.orderNumber)}`, {
        replace: true,
        state: result,
      });
    },
  });

  const placeOrder = handleSubmit((values) => {
    if (!status.checkoutEnabled || !status.legalReviewCompleted) return;
    const parsed = schema.parse(values);
    const payload: CheckoutPayload = {
      ...parsed,
      email: parsed.email || undefined,
      adultConfirmation: true,
      termsAccepted: true,
      privacyAccepted: true,
    };
    checkoutMutation.mutate(payload);
  });
  const allowed = status.checkoutEnabled && status.legalReviewCompleted;

  return (
    <div className="checkout-page container page-pad">
      <header className="page-heading">
        <span className="eyebrow">{t('checkout.eyebrow')}</span>
        <h1>{t('checkout.title')}</h1>
        <p>{t('checkout.subtitle')}</p>
      </header>
      <div className="checkout-security">
        <span>
          <LockKeyhole aria-hidden="true" />
          {t('admin.securityNotice')}
        </span>
        <span>
          <Banknote aria-hidden="true" />
          {t('home.trustThreeBody')}
        </span>
      </div>
      <form className="checkout-layout" onSubmit={(event) => void placeOrder(event)} noValidate>
        <div className="checkout-form">
          <fieldset>
            <legend>{t('checkout.contact')}</legend>
            <div className="field-grid">
              <FormField
                label={t('checkout.fullName')}
                autoComplete="name"
                error={errors.fullName?.message}
                {...register('fullName')}
              />
              <FormField
                label={t('checkout.phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+21620123456"
                error={errors.phone?.message}
                {...register('phone')}
              />
              <FormField
                label={t('checkout.emailOptional')}
                type="email"
                autoComplete="email"
                error={errors.email?.message}
                {...register('email')}
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <MapPin aria-hidden="true" size={19} />
              {t('checkout.address')}
            </legend>
            <div className="field-grid">
              <SelectField
                label={t('checkout.governorate')}
                error={errors.governorateId?.message}
                {...register('governorateId', {
                  onChange: () => {
                    setValue('delegationId', '');
                    setValue('localityId', '');
                  },
                })}
              >
                <option value="">—</option>
                {governorates.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('checkout.delegation')}
                disabled={!governorateId}
                error={errors.delegationId?.message}
                {...register('delegationId', { onChange: () => setValue('localityId', '') })}
              >
                <option value="">—</option>
                {delegations.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('checkout.locality')}
                disabled={!delegationId}
                error={errors.localityId?.message}
                {...register('localityId')}
              >
                <option value="">—</option>
                {localities.data
                  ?.filter((item) => item.supported !== false)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </SelectField>
              <FormField
                label={t('checkout.postalCode')}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                error={errors.postalCode?.message}
                {...register('postalCode')}
              />
              <FormField
                className="field--wide"
                label={t('checkout.street')}
                autoComplete="street-address"
                error={errors.street?.message}
                {...register('street')}
              />
              <FormField label={t('checkout.building')} {...register('building')} />
              <FormField label={t('checkout.floor')} {...register('floor')} />
              <FormField label={t('checkout.apartment')} {...register('apartment')} />
              <FormField label={t('checkout.landmark')} {...register('landmark')} />
              <FormField
                className="field--wide"
                label={t('checkout.instructions')}
                {...register('deliveryInstructions')}
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('checkout.preferences')}</legend>
            <div className="field-grid">
              <SelectField label={t('checkout.method')} {...register('deliveryMethod')}>
                <option value="DELIVERY">{t('checkout.deliveryMethod')}</option>
                <option value="PICKUP">{t('checkout.pickupMethod')}</option>
              </SelectField>
              <FormField
                label={t('checkout.date')}
                type="date"
                {...register('preferredDeliveryDate')}
              />
              <SelectField
                label={t('checkout.timeWindow')}
                disabled={!localityId}
                {...register('preferredDeliveryTimeWindowId')}
              >
                <option value="">—</option>
                {windows.data?.map((window) => (
                  <option key={window.id} value={window.id}>
                    {window.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <ShieldCheck aria-hidden="true" size={19} />
              {t('checkout.consent')}
            </legend>
            <div className="consent-list">
              <CheckboxField
                label={t('checkout.adult')}
                error={errors.adultConfirmation?.message}
                {...register('adultConfirmation')}
              />
              <CheckboxField
                label={t('checkout.terms')}
                error={errors.termsAccepted?.message}
                {...register('termsAccepted')}
              />
              <CheckboxField
                label={t('checkout.privacy')}
                error={errors.privacyAccepted?.message}
                {...register('privacyAccepted')}
              />
            </div>
          </fieldset>
        </div>
        <aside className="checkout-summary">
          <h2>{t('checkout.summary')}</h2>
          <p>
            <ShieldCheck aria-hidden="true" />
            {t('checkout.serverNote')}
          </p>
          {checkoutMutation.isError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t('checkout.orderFailed')}
            </p>
          ) : null}
          <Button type="submit" disabled={!allowed} loading={checkoutMutation.isPending}>
            {t('checkout.placeOrder')}
          </Button>
        </aside>
      </form>
    </div>
  );
}
