import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, LockKeyhole, Phone, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';

import {
  customerAuthClient,
  type GoogleOAuthCompleteInput,
  type GoogleOAuthIntent,
  type GoogleOnboardingResponse,
} from '../../api/customer-client';
import { ApiError } from '../../api/http';
import { CUSTOMER_SESSION_QUERY_KEY } from '../../auth/customer-auth-context';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField } from '../../components/ui/form-field';
import { beginGoogleCustomerAuthentication } from './customer-google-auth-utils';

const GOOGLE_ONBOARDING_QUERY_KEY = ['customer-auth', 'google-onboarding'] as const;

function activeLocale(language: string | undefined): 'fr' | 'ar' {
  return language === 'ar' ? 'ar' : 'fr';
}

function GoogleMark() {
  return (
    <svg className="auth-google__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285f4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.32 2.98-7.39Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.7 0 4.98-.9 6.64-2.38l-3.25-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.39 13.92A6 6 0 0 1 6.07 12c0-.67.12-1.32.32-1.92V7.47H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.53l3.35-2.61Z"
      />
      <path
        fill="#ea4335"
        d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.61C7.18 7.71 9.39 5.95 12 5.95Z"
      />
    </svg>
  );
}

interface GoogleAuthControlProps {
  intent: GoogleOAuthIntent;
  returnTo?: string;
}

export function GoogleAuthControl({ intent, returnTo = '/account' }: GoogleAuthControlProps) {
  const { t, i18n } = useTranslation();
  const status = useStorefrontStatus();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!status.googleLoginEnabled) return null;

  const start = async () => {
    setPending(true);
    setFailed(false);
    try {
      await beginGoogleCustomerAuthentication({
        intent,
        returnTo,
        locale: activeLocale(i18n.resolvedLanguage),
      });
    } catch {
      setPending(false);
      setFailed(true);
    }
  };

  return (
    <div className="auth-google">
      {failed ? (
        <p className="form-banner form-banner--error" role="alert">
          {t('auth.googleStartError')}
        </p>
      ) : null}
      <Button
        className="auth-google__button"
        type="button"
        variant="secondary"
        loading={pending}
        onClick={() => void start()}
      >
        <GoogleMark />
        {t(pending ? 'auth.googleStarting' : 'auth.googleContinue')}
      </Button>
      <div className="auth-google__divider" aria-hidden="true">
        <span />
        <small>{t('auth.googleDivider')}</small>
        <span />
      </div>
    </div>
  );
}

function completionErrorMessageKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'auth.googleOnboardingServiceError';
  if (error.code === 'GOOGLE_LINK_CREDENTIALS_INVALID') return 'auth.googleLinkInvalid';
  if (error.code === 'GOOGLE_ACCOUNT_STATE_CHANGED') return 'auth.googleOnboardingRestart';
  if (error.code === 'GOOGLE_AUTH_NOT_CONFIGURED') return 'auth.googleErrorUnavailable';
  if (error.code === 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE' || error.status >= 500) {
    return 'auth.googleOnboardingServiceError';
  }
  if ([400, 404, 409, 410].includes(error.status)) return 'auth.googleOnboardingRestart';
  return 'auth.googleOnboardingServiceError';
}

function onboardingLoadErrorMessageKey(error: unknown): string {
  if (
    error instanceof ApiError &&
    (error.code === 'GOOGLE_AUTH_NOT_CONFIGURED' ||
      error.code === 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE' ||
      error.status >= 500)
  ) {
    return 'auth.googleOnboardingServiceError';
  }
  return 'auth.googleOnboardingExpired';
}

function GoogleIdentity({ email }: { email: string }) {
  const { t } = useTranslation();
  return (
    <div className="auth-google__identity">
      <AtSign aria-hidden="true" size={18} />
      <span>{t('auth.googleVerifiedEmail')}</span>
      <strong dir="ltr">{email}</strong>
    </div>
  );
}

function GoogleOnboardingFrame({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="customer-auth customer-auth--onboarding page-pad container">
      <div className="auth-card">
        <div className="auth-card__intro">
          <span className="eyebrow">{t('auth.googleOnboardingEyebrow')}</span>
          <h1>{title}</h1>
          <p>{body}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function useGoogleCompletion() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const complete = async (input: GoogleOAuthCompleteInput) => {
    setErrorKey(null);
    try {
      const session = await customerAuthClient.completeGoogle(input);
      queryClient.setQueryData(CUSTOMER_SESSION_QUERY_KEY, session);
      queryClient.removeQueries({ queryKey: GOOGLE_ONBOARDING_QUERY_KEY });
      void navigate('/account', { replace: true });
    } catch (error) {
      setErrorKey(completionErrorMessageKey(error));
    }
  };

  return { complete, errorKey };
}

function GoogleCreateOnboardingForm({ onboarding }: { onboarding: GoogleOnboardingResponse }) {
  const { t, i18n } = useTranslation();
  const status = useStorefrontStatus();
  const ageConfirmationRequired = status.ageGateEnabled ?? true;
  const termsAcceptanceRequired = status.termsAcceptanceRequired ?? true;
  const { complete, errorKey } = useGoogleCompletion();
  const schema = z.object({
    fullName: z.string().trim().min(2, t('validation.required')).max(120),
    phone: z.string().regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
    adultConfirmed: z
      .boolean()
      .refine((value) => !ageConfirmationRequired || value, t('validation.adult')),
    termsAccepted: z
      .boolean()
      .refine((value) => !termsAcceptanceRequired || value, t('validation.terms')),
  });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: onboarding.fullName,
      phone: '',
      adultConfirmed: false,
      termsAccepted: false,
    },
  });
  const submit = handleSubmit(async (values) => {
    await complete({
      fullName: values.fullName.trim(),
      phone: values.phone,
      adultConfirmed: values.adultConfirmed,
      termsAccepted: values.termsAccepted,
      locale: activeLocale(i18n.resolvedLanguage),
    });
  });

  return (
    <>
      <GoogleIdentity email={onboarding.email} />
      <form onSubmit={(event) => void submit(event)} noValidate>
        {errorKey ? (
          <p className="form-banner form-banner--error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <div className="field-grid">
          <FormField
            label={t('auth.fullName')}
            autoComplete="name"
            leading={<UserRound aria-hidden="true" size={18} />}
            error={errors.fullName?.message}
            {...register('fullName')}
          />
          <FormField
            type="tel"
            label={t('auth.phone')}
            autoComplete="tel"
            placeholder="+21620123456"
            leading={<Phone aria-hidden="true" size={18} />}
            error={errors.phone?.message}
            {...register('phone')}
          />
        </div>
        {ageConfirmationRequired ? (
          <CheckboxField
            label={t('auth.adultConfirm')}
            error={errors.adultConfirmed?.message}
            {...register('adultConfirmed')}
          />
        ) : null}
        {termsAcceptanceRequired ? (
          <CheckboxField
            label={t('auth.acceptTerms')}
            error={errors.termsAccepted?.message}
            {...register('termsAccepted')}
          />
        ) : null}
        <Button type="submit" loading={isSubmitting}>
          {t(isSubmitting ? 'auth.googleCompleting' : 'auth.googleCreateComplete')}
        </Button>
      </form>
    </>
  );
}

function GoogleLinkOnboardingForm({ onboarding }: { onboarding: GoogleOnboardingResponse }) {
  const { t } = useTranslation();
  const { complete, errorKey } = useGoogleCompletion();
  const schema = z.object({
    currentPassword: z.string().min(8, t('validation.required')).max(128),
  });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async ({ currentPassword }) => {
    await complete({ currentPassword });
  });

  return (
    <>
      <GoogleIdentity email={onboarding.email} />
      <form onSubmit={(event) => void submit(event)} noValidate>
        {errorKey ? (
          <p className="form-banner form-banner--error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <FormField
          type="password"
          label={t('auth.googleCurrentPassword')}
          autoComplete="current-password"
          leading={<LockKeyhole aria-hidden="true" size={18} />}
          hint={t('auth.googleLinkPasswordHint')}
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <Button type="submit" loading={isSubmitting}>
          {t(isSubmitting ? 'auth.googleCompleting' : 'auth.googleLinkComplete')}
        </Button>
      </form>
    </>
  );
}

export function GoogleOnboardingPage() {
  const { t } = useTranslation();
  const status = useStorefrontStatus();
  const { user, isLoading } = useCustomerAuth();
  const onboardingQuery = useQuery({
    queryKey: GOOGLE_ONBOARDING_QUERY_KEY,
    queryFn: () => customerAuthClient.googleOnboarding(),
    enabled: status.googleLoginEnabled && !isLoading && !user,
    retry: false,
  });

  if (user) return <Navigate to="/account" replace />;
  if (!status.googleLoginEnabled) {
    return (
      <GoogleOnboardingFrame
        title={t('auth.googleUnavailableTitle')}
        body={t('auth.googleUnavailableBody')}
      >
        <Button asChild variant="secondary">
          <Link to="/login">{t('auth.login')}</Link>
        </Button>
      </GoogleOnboardingFrame>
    );
  }
  if (isLoading || onboardingQuery.isPending) {
    return (
      <GoogleOnboardingFrame
        title={t('auth.googleOnboardingLoadingTitle')}
        body={t('auth.googleOnboardingLoadingBody')}
      >
        <p className="auth-google__loading" role="status" aria-live="polite">
          {t('common.loading')}
        </p>
      </GoogleOnboardingFrame>
    );
  }
  if (onboardingQuery.isError || !onboardingQuery.data) {
    return (
      <GoogleOnboardingFrame
        title={t('auth.googleOnboardingErrorTitle')}
        body={t(onboardingLoadErrorMessageKey(onboardingQuery.error))}
      >
        <Button asChild variant="secondary">
          <Link to="/login">{t('auth.googleRestart')}</Link>
        </Button>
      </GoogleOnboardingFrame>
    );
  }

  const onboarding = onboardingQuery.data;
  return (
    <GoogleOnboardingFrame
      title={t(onboarding.mode === 'CREATE' ? 'auth.googleCreateTitle' : 'auth.googleLinkTitle')}
      body={t(onboarding.mode === 'CREATE' ? 'auth.googleCreateBody' : 'auth.googleLinkBody')}
    >
      {onboarding.mode === 'CREATE' ? (
        <GoogleCreateOnboardingForm onboarding={onboarding} />
      ) : (
        <GoogleLinkOnboardingForm onboarding={onboarding} />
      )}
    </GoogleOnboardingFrame>
  );
}
