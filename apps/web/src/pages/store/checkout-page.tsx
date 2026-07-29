import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, LockKeyhole, MapPin, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';

import { storefrontClient } from '../../api/storefront-client';
import type { CheckoutPayload } from '../../api/types';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { DeliveryMetadata } from '../../components/storefront/delivery-metadata';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { Price } from '../../components/ui/price';
import { checkoutOrderErrorFeedback, checkoutQuoteErrorKey } from './checkout-error-feedback';

function optionalText() {
  return z.string().trim().optional();
}

function checkoutSchema(
  t: (key: string) => string,
  requirements: {
    age: boolean;
    terms: boolean;
    privacy: boolean;
  },
) {
  const confirmation = (required: boolean, message: string) =>
    required ? z.boolean().refine(Boolean, message) : z.boolean();
  return z.object({
    fullName: z.string().trim().min(2, t('validation.required')),
    phone: z
      .string()
      .trim()
      .regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
    email: z.union([z.literal(''), z.email(t('validation.email'))]),
    governorateId: optionalText(),
    delegationId: optionalText(),
    localityId: optionalText(),
    postalCode: z.union([z.literal(''), z.string().regex(/^\d{4}$/, t('validation.postalCode'))]),
    street: optionalText(),
    building: optionalText(),
    floor: optionalText(),
    apartment: optionalText(),
    landmark: optionalText(),
    deliveryInstructions: optionalText(),
    deliveryMethodId: z.string().min(1, t('validation.required')),
    adultConfirmation: confirmation(requirements.age, t('validation.adult')),
    termsAccepted: confirmation(requirements.terms, t('validation.terms')),
    privacyAccepted: confirmation(requirements.privacy, t('validation.terms')),
  });
}

export function CheckoutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useStorefrontStatus();
  const [idempotency, setIdempotency] = useState({
    key: globalThis.crypto.randomUUID(),
    fingerprint: '',
  });
  const requirements = {
    age: status.checkoutAgeConfirmationRequired ?? true,
    terms: status.termsAcceptanceRequired ?? true,
    privacy: status.privacyAcceptanceRequired ?? true,
  };
  const schema = checkoutSchema(t, requirements);
  type FormValues = z.input<typeof schema>;
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      deliveryMethodId: '',
      adultConfirmation: false,
      termsAccepted: false,
      privacyAccepted: false,
      email: '',
      governorateId: '',
      delegationId: '',
      localityId: '',
      postalCode: '',
      street: '',
    },
  });
  const governorateId = useWatch({ control, name: 'governorateId' }) ?? '';
  const delegationId = useWatch({ control, name: 'delegationId' }) ?? '';
  const localityId = useWatch({ control, name: 'localityId' }) ?? '';
  const deliveryMethodId = useWatch({ control, name: 'deliveryMethodId' }) ?? '';
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
  const selectedLocality = localities.data?.find((item) => item.id === localityId);
  const cart = useQuery({ queryKey: ['cart'], queryFn: storefrontClient.cart });
  const deliveryMethods = useQuery({
    queryKey: ['delivery', 'methods', localityId],
    queryFn: () => storefrontClient.deliveryMethods(localityId || undefined),
  });
  const selectedMethod = deliveryMethods.data?.find((method) => method.id === deliveryMethodId);
  const quoteItems =
    cart.data?.items.map((item) => ({ variantId: item.variant!.id, quantity: item.quantity })) ??
    [];
  const quoteInput = selectedMethod
    ? {
        items: quoteItems,
        ...(selectedMethod.type === 'COURIER'
          ? { localityId }
          : { pickupLocationId: selectedMethod.id }),
      }
    : null;
  const quote = useQuery({
    queryKey: ['checkout', 'quote', quoteInput],
    queryFn: () => storefrontClient.checkoutQuote(quoteInput!),
    enabled:
      quoteItems.length > 0 &&
      Boolean(selectedMethod) &&
      (selectedMethod?.type !== 'COURIER' || Boolean(localityId)),
    retry: false,
  });
  const deliveryMetadata =
    quote.data?.fulfillment.type === 'COURIER' ? quote.data.fulfillment : selectedMethod;
  const checkoutMutation = useMutation({
    mutationFn: ({ payload, key }: { payload: CheckoutPayload; key: string }) =>
      storefrontClient.checkout(payload, key),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['cart', 'summary'] });
      void navigate(`/order-confirmation/${encodeURIComponent(result.orderNumber)}`, {
        replace: true,
        state: result,
      });
    },
  });
  const checkoutErrorRef = useRef<HTMLDivElement>(null);
  const orderErrorFeedback = checkoutMutation.isError
    ? checkoutOrderErrorFeedback(checkoutMutation.error)
    : null;

  useEffect(() => {
    if (checkoutMutation.isError) checkoutErrorRef.current?.focus();
  }, [checkoutMutation.isError]);

  const placeOrder = handleSubmit((values) => {
    if (!status.checkoutEnabled) return;
    if (!selectedMethod || !quote.data || quoteItems.length === 0) return;
    const parsed = schema.parse(values);
    if (selectedMethod.type === 'COURIER') {
      if (!parsed.governorateId) setError('governorateId', { message: t('validation.required') });
      if (!parsed.delegationId) setError('delegationId', { message: t('validation.required') });
      if (!parsed.localityId) setError('localityId', { message: t('validation.required') });
      if (!parsed.street || parsed.street.length < 3) {
        setError('street', { message: t('validation.required') });
      }
      if (
        !parsed.governorateId ||
        !parsed.delegationId ||
        !parsed.localityId ||
        !parsed.street ||
        parsed.street.length < 3
      ) {
        return;
      }
    }
    const payload: CheckoutPayload = {
      items: quoteItems,
      ...(selectedMethod.type === 'COURIER'
        ? { localityId: parsed.localityId }
        : { pickupLocationId: selectedMethod.id }),
      customerName: parsed.fullName,
      phone: parsed.phone,
      email: parsed.email || undefined,
      ...(selectedMethod.type === 'COURIER'
        ? {
            address: {
              street: parsed.street!,
              postalCode: parsed.postalCode || undefined,
              building: parsed.building || undefined,
              floor: parsed.floor || undefined,
              apartment: parsed.apartment || undefined,
              landmark: parsed.landmark || undefined,
              instructions: parsed.deliveryInstructions || undefined,
            },
          }
        : {}),
      consent: {
        ageConfirmed: parsed.adultConfirmation,
        termsAccepted: parsed.termsAccepted,
        privacyAccepted: parsed.privacyAccepted,
      },
    };
    const fingerprint = JSON.stringify(payload);
    let key = idempotency.key;
    if (!idempotency.fingerprint) {
      setIdempotency({ key, fingerprint });
    } else if (idempotency.fingerprint !== fingerprint) {
      key = globalThis.crypto.randomUUID();
      setIdempotency({ key, fingerprint });
    }
    checkoutMutation.mutate({ payload, key });
  });
  const allowed =
    status.checkoutEnabled &&
    quoteItems.length > 0 &&
    Boolean(selectedMethod) &&
    Boolean(quote.data);

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
                    setValue('deliveryMethodId', '');
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
                {...register('delegationId', {
                  onChange: () => {
                    setValue('localityId', '');
                    setValue('deliveryMethodId', '');
                  },
                })}
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
                {...register('localityId', {
                  onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                    const nextLocality = localities.data?.find(
                      (item) => item.id === event.target.value,
                    );
                    setValue('postalCode', nextLocality?.postalCode ?? '', {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    setValue('deliveryMethodId', '');
                  },
                })}
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
                label={t('checkout.postalCodeOptional')}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                readOnly
                hint={t(
                  selectedLocality?.postalCode
                    ? 'checkout.postalCodeConfigured'
                    : 'checkout.postalCodeNotRequired',
                )}
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
              <SelectField
                label={t('checkout.method')}
                error={errors.deliveryMethodId?.message}
                {...register('deliveryMethodId')}
              >
                <option value="">—</option>
                {deliveryMethods.data?.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label} —{' '}
                    {method.type === 'COURIER'
                      ? t('checkout.deliveryMethod')
                      : t('checkout.pickupMethod')}
                  </option>
                ))}
              </SelectField>
            </div>
            <DeliveryMetadata metadata={deliveryMetadata} />
          </fieldset>
          {requirements.age || requirements.terms || requirements.privacy ? (
            <fieldset>
              <legend>
                <ShieldCheck aria-hidden="true" size={19} />
                {t('checkout.consent')}
              </legend>
              <div className="consent-list">
                {requirements.age ? (
                  <CheckboxField
                    label={t('checkout.adult')}
                    error={errors.adultConfirmation?.message}
                    {...register('adultConfirmation')}
                  />
                ) : null}
                {requirements.terms ? (
                  <CheckboxField
                    label={t('checkout.terms')}
                    error={errors.termsAccepted?.message}
                    {...register('termsAccepted')}
                  />
                ) : null}
                {requirements.privacy ? (
                  <CheckboxField
                    label={t('checkout.privacy')}
                    error={errors.privacyAccepted?.message}
                    {...register('privacyAccepted')}
                  />
                ) : null}
                {(requirements.terms || requirements.privacy) && (
                  <p className="consent-list__links">
                    {requirements.terms ? (
                      <Link to="/legal/terms">{t('checkout.terms')}</Link>
                    ) : null}
                    {requirements.terms && requirements.privacy ? ' · ' : null}
                    {requirements.privacy ? (
                      <Link to="/legal/privacy">{t('checkout.privacy')}</Link>
                    ) : null}
                  </p>
                )}
              </div>
            </fieldset>
          ) : null}
        </div>
        <aside className="checkout-summary">
          <h2>{t('checkout.summary')}</h2>
          <p>
            <ShieldCheck aria-hidden="true" />
            {t('checkout.serverNote')}
          </p>
          {quote.data ? (
            <dl>
              <div>
                <dt>{t('cart.subtotal')}</dt>
                <dd>
                  <Price millimes={quote.data.subtotalMillimes} />
                </dd>
              </div>
              <div>
                <dt>{t('checkout.deliveryMethod')}</dt>
                <dd>
                  <Price millimes={quote.data.deliveryTotalMillimes} />
                </dd>
              </div>
              <div>
                <dt>{t('checkout.summary')}</dt>
                <dd>
                  <Price millimes={quote.data.grandTotalMillimes} />
                </dd>
              </div>
            </dl>
          ) : null}
          {quote.isError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t(checkoutQuoteErrorKey(quote.error))}
            </p>
          ) : null}
          {orderErrorFeedback ? (
            <div
              ref={checkoutErrorRef}
              className="form-banner form-banner--error checkout-order-feedback"
              role="alert"
              tabIndex={-1}
            >
              <span>{t(orderErrorFeedback.messageKey)}</span>
              {orderErrorFeedback.requestId ? (
                <small>
                  {t('checkout.requestReference', {
                    requestId: orderErrorFeedback.requestId,
                  })}
                </small>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={!allowed} loading={checkoutMutation.isPending}>
            {t(orderErrorFeedback ? 'checkout.retryOrder' : 'checkout.placeOrder')}
          </Button>
        </aside>
      </form>
    </div>
  );
}
