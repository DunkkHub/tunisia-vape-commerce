import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign, LockKeyhole, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { customerAuthClient } from '../../api/customer-client';
import { ApiError } from '../../api/http';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField } from '../../components/ui/form-field';

function destination(state: unknown) {
  if (
    state &&
    typeof state === 'object' &&
    'from' in state &&
    typeof state.from === 'string' &&
    state.from.startsWith('/') &&
    !state.from.startsWith('//')
  )
    return state.from;
  return '/account';
}

function strongPassword(message: string) {
  return z
    .string()
    .min(12, message)
    .max(128, message)
    .regex(/[a-z]/, message)
    .regex(/[A-Z]/, message)
    .regex(/[0-9]/, message)
    .regex(/[^A-Za-z0-9]/, message);
}

function resetCompleted(state: unknown) {
  return Boolean(
    state &&
    typeof state === 'object' &&
    'passwordResetComplete' in state &&
    state.passwordResetComplete === true,
  );
}

export function CustomerLoginPage() {
  const { t } = useTranslation();
  const { user, login } = useCustomerAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(false);
  const schema = z.object({
    emailOrPhone: z.string().trim().min(3, t('validation.required')),
    password: z.string().min(1, t('validation.required')),
  });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to={destination(location.state)} replace />;
  const submit = handleSubmit(async (values) => {
    setServerError(false);
    try {
      await login(values);
      void navigate(destination(location.state), { replace: true });
    } catch {
      setServerError(true);
    }
  });

  return (
    <section className="customer-auth page-pad container">
      <div className="auth-card">
        <div className="auth-card__intro">
          <span className="eyebrow">{t('auth.customerEyebrow')}</span>
          <h1>{t('auth.loginTitle')}</h1>
          <p>{t('auth.loginBody')}</p>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          {serverError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t('auth.genericError')}
            </p>
          ) : null}
          <FormField
            label={t('auth.identifier')}
            autoComplete="username"
            leading={<UserRound aria-hidden="true" size={18} />}
            error={errors.emailOrPhone?.message}
            {...register('emailOrPhone')}
          />
          <FormField
            type="password"
            label={t('auth.password')}
            autoComplete="current-password"
            leading={<LockKeyhole aria-hidden="true" size={18} />}
            error={errors.password?.message}
            {...register('password')}
          />
          <Link className="text-link auth-card__forgot" to="/password-reset">
            {t('auth.forgot')}
          </Link>
          <Button type="submit" loading={isSubmitting}>
            {t(isSubmitting ? 'auth.loggingIn' : 'auth.login')}
          </Button>
        </form>
        <p className="auth-card__switch">
          {t('auth.noAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
        </p>
      </div>
      <div className="auth-assurance" aria-hidden="true">
        <span>18+</span>
        <i />
        <i />
      </div>
    </section>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user, register: registerCustomer } = useCustomerAuth();
  const status = useStorefrontStatus();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(false);
  const ageConfirmationRequired = status.ageGateEnabled ?? true;
  const termsAcceptanceRequired = status.termsAcceptanceRequired ?? true;
  const schema = z
    .object({
      fullName: z.string().trim().min(2, t('validation.required')),
      email: z.string().email(t('validation.email')),
      phone: z.string().regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
      password: strongPassword(t('validation.passwordPolicy')),
      confirmPassword: z.string(),
      adultConfirmed: z
        .boolean()
        .refine((value) => !ageConfirmationRequired || value, t('validation.adult')),
      termsAccepted: z
        .boolean()
        .refine((value) => !termsAcceptanceRequired || value, t('validation.terms')),
    })
    .refine((values) => values.password === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('validation.passwordMismatch'),
    });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { adultConfirmed: false, termsAccepted: false },
  });

  if (user) return <Navigate to="/account" replace />;
  const submit = handleSubmit(async (values) => {
    setServerError(false);
    try {
      await registerCustomer({
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        password: values.password,
        adultConfirmed: values.adultConfirmed,
        termsAccepted: values.termsAccepted,
        locale: i18n.resolvedLanguage === 'ar' ? 'ar' : 'fr',
      });
      void navigate('/account', { replace: true });
    } catch {
      setServerError(true);
    }
  });

  return (
    <section className="customer-auth customer-auth--register page-pad container">
      <div className="auth-card">
        <div className="auth-card__intro">
          <span className="eyebrow">{t('auth.customerEyebrow')}</span>
          <h1>{t('auth.registerTitle')}</h1>
          <p>{t('auth.registerBody')}</p>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          {serverError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t('auth.genericError')}
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
              type="email"
              label={t('auth.email')}
              autoComplete="email"
              leading={<AtSign aria-hidden="true" size={18} />}
              error={errors.email?.message}
              {...register('email')}
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
            <FormField
              type="password"
              label={t('auth.password')}
              autoComplete="new-password"
              hint={t('auth.passwordRequirements')}
              error={errors.password?.message}
              {...register('password')}
            />
            <FormField
              type="password"
              label={t('auth.confirmPassword')}
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
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
            {t(isSubmitting ? 'auth.registering' : 'auth.register')}
          </Button>
        </form>
        <p className="auth-card__switch">
          {t('auth.existingAccount')} <Link to="/login">{t('auth.login')}</Link>
        </p>
      </div>
    </section>
  );
}

export function PasswordResetPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sent, setSent] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [completionError, setCompletionError] = useState<'invalid' | 'service' | null>(null);
  const requestSchema = z.object({ email: z.string().email(t('validation.email')) });
  const completionSchema = z
    .object({
      newPassword: strongPassword(t('validation.passwordPolicy')),
      confirmPassword: z.string().min(1, t('validation.required')),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('validation.passwordMismatch'),
    });
  type RequestValues = z.infer<typeof requestSchema>;
  type CompletionValues = z.infer<typeof completionSchema>;
  const {
    register: registerRequest,
    handleSubmit: handleRequestSubmit,
    formState: { errors: requestErrors, isSubmitting: requestPending },
  } = useForm<RequestValues>({ resolver: zodResolver(requestSchema) });
  const {
    register: registerCompletion,
    handleSubmit: handleCompletionSubmit,
    formState: { errors: completionErrors, isSubmitting: completionPending },
  } = useForm<CompletionValues>({ resolver: zodResolver(completionSchema) });
  const token = searchParams.get('token')?.trim() ?? '';
  const confirmationRequested = location.pathname.endsWith('/confirm') || searchParams.has('token');
  const validToken = token.length >= 32 && token.length <= 256;
  const completed = resetCompleted(location.state);
  const requestSubmit = handleRequestSubmit(async ({ email }) => {
    setRequestError(false);
    try {
      await customerAuthClient.requestPasswordReset(email);
      setSent(true);
    } catch {
      setRequestError(true);
    }
  });
  const completionSubmit = handleCompletionSubmit(async ({ newPassword }) => {
    setCompletionError(null);
    try {
      await customerAuthClient.confirmPasswordReset(token, newPassword);
      void navigate('/password-reset', {
        replace: true,
        state: { passwordResetComplete: true },
      });
    } catch (error) {
      setCompletionError(
        error instanceof ApiError && [400, 404, 410, 422].includes(error.status)
          ? 'invalid'
          : 'service',
      );
    }
  });

  const title = completed
    ? t('auth.resetCompleteSuccessTitle')
    : validToken
      ? t('auth.resetCompleteTitle')
      : t('auth.resetTitle');
  const body = completed
    ? t('auth.resetCompleteSuccess')
    : validToken
      ? t('auth.resetCompleteBody')
      : t('auth.resetBody');

  return (
    <section className="customer-auth page-pad container">
      <div className="auth-card">
        <div className="auth-card__intro">
          <span className="eyebrow">{t('auth.customerEyebrow')}</span>
          <h1>{title}</h1>
          <p>{body}</p>
        </div>
        {completed ? (
          <Button asChild>
            <Link to="/login">{t('auth.login')}</Link>
          </Button>
        ) : confirmationRequested && !validToken ? (
          <div className="auth-reset-invalid">
            <p className="form-banner form-banner--error" role="alert">
              {t('auth.resetInvalidToken')}
            </p>
            <Button asChild variant="secondary">
              <Link to="/password-reset">{t('auth.resetRequestAnother')}</Link>
            </Button>
          </div>
        ) : validToken ? (
          <form onSubmit={(event) => void completionSubmit(event)} noValidate>
            {completionError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t(
                  completionError === 'invalid'
                    ? 'auth.resetInvalidToken'
                    : 'auth.resetServiceError',
                )}
              </p>
            ) : null}
            <FormField
              type="password"
              label={t('auth.resetNewPassword')}
              autoComplete="new-password"
              hint={t('auth.passwordRequirements')}
              error={completionErrors.newPassword?.message}
              {...registerCompletion('newPassword')}
            />
            <FormField
              type="password"
              label={t('auth.resetConfirmPassword')}
              autoComplete="new-password"
              error={completionErrors.confirmPassword?.message}
              {...registerCompletion('confirmPassword')}
            />
            <Button type="submit" loading={completionPending}>
              {t(completionPending ? 'auth.resetCompleting' : 'auth.resetCompleteSubmit')}
            </Button>
          </form>
        ) : sent ? (
          <p className="form-banner form-banner--success" role="status">
            {t('auth.resetSent')}
          </p>
        ) : (
          <form onSubmit={(event) => void requestSubmit(event)} noValidate>
            {requestError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t('auth.resetServiceError')}
              </p>
            ) : null}
            <FormField
              type="email"
              label={t('auth.email')}
              autoComplete="email"
              leading={<AtSign aria-hidden="true" size={18} />}
              error={requestErrors.email?.message}
              {...registerRequest('email')}
            />
            <Button type="submit" loading={requestPending}>
              {t('auth.resetSubmit')}
            </Button>
          </form>
        )}
        <p className="auth-card__switch">
          <Link to="/login">{t('common.back')}</Link>
        </p>
      </div>
    </section>
  );
}
