import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign, LockKeyhole, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { customerAuthClient } from '../../api/customer-client';
import { useCustomerAuth } from '../../auth/customer-auth-context';
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
  const { t } = useTranslation();
  const { user, register: registerCustomer } = useCustomerAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(false);
  const schema = z
    .object({
      fullName: z.string().trim().min(2, t('validation.required')),
      email: z.string().email(t('validation.email')),
      phone: z.string().regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
      password: z.string().min(12, t('validation.password')),
      confirmPassword: z.string(),
      adultConfirmed: z.boolean().refine(Boolean, t('validation.adult')),
      termsAccepted: z.boolean().refine(Boolean, t('validation.terms')),
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
          <CheckboxField
            label={t('auth.adultConfirm')}
            error={errors.adultConfirmed?.message}
            {...register('adultConfirmed')}
          />
          <CheckboxField
            label={t('auth.acceptTerms')}
            error={errors.termsAccepted?.message}
            {...register('termsAccepted')}
          />
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
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState(false);
  const schema = z.object({ email: z.string().email(t('validation.email')) });
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async ({ email }) => {
    setServerError(false);
    try {
      await customerAuthClient.requestPasswordReset(email);
      setSent(true);
    } catch {
      setServerError(true);
    }
  });

  return (
    <section className="customer-auth page-pad container">
      <div className="auth-card">
        <div className="auth-card__intro">
          <span className="eyebrow">{t('auth.customerEyebrow')}</span>
          <h1>{t('auth.resetTitle')}</h1>
          <p>{t('auth.resetBody')}</p>
        </div>
        {sent ? (
          <p className="form-banner form-banner--success" role="status">
            {t('auth.resetSent')}
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate>
            {serverError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t('auth.genericError')}
              </p>
            ) : null}
            <FormField
              type="email"
              label={t('auth.email')}
              autoComplete="email"
              leading={<AtSign aria-hidden="true" size={18} />}
              error={errors.email?.message}
              {...register('email')}
            />
            <Button type="submit" loading={isSubmitting}>
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
