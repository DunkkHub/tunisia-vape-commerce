import { zodResolver } from '@hookform/resolvers/zod';
import { Fingerprint, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { z } from 'zod';

import { ApiError } from '../../api/http';
import type { AdminChallengeResponse } from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { BrandMark } from '../../components/brand/mark';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { LanguageSwitch } from '../../components/ui/language-switch';

type AdminLoginError = 'admin.genericError' | 'admin.invalidTotp' | 'admin.challengeExpired';

function EnrollmentQrCode({ enrollmentUri }: { enrollmentUri: string }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    void QRCode.toString(enrollmentUri, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 3,
      width: 224,
      color: { dark: '#07110e', light: '#ffffff' },
    })
      .then((svg) => {
        if (active) {
          setSource(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [enrollmentUri]);

  return (
    <figure className="admin-login__qr">
      <div className="admin-login__qr-image" aria-live="polite">
        {source ? (
          <img src={source} width={224} height={224} alt={t('admin.qrAlt')} />
        ) : (
          <span role={failed ? 'alert' : 'status'}>
            {t(failed ? 'admin.qrUnavailable' : 'admin.qrLoading')}
          </span>
        )}
      </div>
      <figcaption>{t('admin.qrCaption')}</figcaption>
    </figure>
  );
}

function adminDestination(state: unknown) {
  if (
    state &&
    typeof state === 'object' &&
    'from' in state &&
    typeof state.from === 'string' &&
    state.from.startsWith('/admin') &&
    !state.from.startsWith('//')
  )
    return state.from;
  return '/admin';
}

export function AdminLoginPage() {
  const { t } = useTranslation();
  const { user, beginLogin, verifyTotp } = useAdminAuth();
  const location = useLocation();
  const [challenge, setChallenge] = useState<AdminChallengeResponse | null>(null);
  const [serverError, setServerError] = useState<AdminLoginError | null>(null);
  const passwordSchema = z.object({
    email: z.string().email(t('validation.email')),
    password: z.string().min(1, t('validation.required')),
  });
  const totpSchema = z.object({ code: z.string().regex(/^\d{6}$/, t('validation.totp')) });
  type PasswordValues = z.infer<typeof passwordSchema>;
  type TotpValues = z.infer<typeof totpSchema>;
  const passwordForm = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });
  const totpForm = useForm<TotpValues>({ resolver: zodResolver(totpSchema) });

  if (user) return <Navigate to={adminDestination(location.state)} replace />;

  const submitPassword = passwordForm.handleSubmit(async ({ email, password }) => {
    setServerError(null);
    try {
      setChallenge(await beginLogin(email, password));
    } catch {
      setServerError('admin.genericError');
    }
  });
  const submitTotp = totpForm.handleSubmit(async ({ code }) => {
    if (!challenge) return;
    setServerError(null);
    try {
      await verifyTotp(challenge.challengeId, code);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_TOTP') {
        setServerError('admin.invalidTotp');
        totpForm.resetField('code');
        totpForm.setFocus('code');
      } else if (error instanceof ApiError && error.code === 'INVALID_AUTH_CHALLENGE') {
        setServerError('admin.challengeExpired');
      } else {
        setServerError('admin.genericError');
      }
    }
  });

  return (
    <main className="admin-login" id="main-content" tabIndex={-1}>
      <div className="admin-login__header">
        <BrandMark admin />
        <LanguageSwitch tone="admin" />
      </div>
      <div className="admin-login__grid">
        <section className="admin-login__context">
          <span className="admin-login__icon">
            <Fingerprint aria-hidden="true" />
          </span>
          <span className="eyebrow">{t('admin.loginEyebrow')}</span>
          <h1>{t('admin.loginTitle')}</h1>
          <p>{t('admin.loginBody')}</p>
          <ul>
            <li>
              <LockKeyhole aria-hidden="true" />
              {t('admin.securityNotice')}
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              {t('admin.totpBody')}
            </li>
          </ul>
        </section>
        <section className="admin-login__card" aria-live="polite">
          <div className="admin-login__step">
            <span>{t(challenge ? 'admin.totpStep' : 'admin.identityStep')}</span>
            <i>
              <b className="active" />
              <b className={challenge ? 'active' : ''} />
            </i>
          </div>
          {serverError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t(serverError)}
            </p>
          ) : null}
          {!challenge ? (
            <form onSubmit={(event) => void submitPassword(event)} noValidate>
              <FormField
                type="email"
                label={t('admin.workEmail')}
                autoComplete="username"
                leading={<KeyRound aria-hidden="true" size={18} />}
                error={passwordForm.formState.errors.email?.message}
                {...passwordForm.register('email')}
              />
              <FormField
                type="password"
                label={t('admin.password')}
                autoComplete="current-password"
                leading={<LockKeyhole aria-hidden="true" size={18} />}
                error={passwordForm.formState.errors.password?.message}
                {...passwordForm.register('password')}
              />
              <Button type="submit" variant="admin" loading={passwordForm.formState.isSubmitting}>
                {t(
                  passwordForm.formState.isSubmitting
                    ? 'admin.verifyingPassword'
                    : 'admin.continue',
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={(event) => void submitTotp(event)} noValidate>
              <div className="admin-login__challenge">
                <span>
                  <ShieldCheck aria-hidden="true" size={24} />
                </span>
                <div>
                  <h2>
                    {t(
                      challenge.state === 'ENROLLMENT_REQUIRED'
                        ? 'admin.enrollmentTitle'
                        : 'admin.totpTitle',
                    )}
                  </h2>
                  <p>
                    {t(
                      challenge.state === 'ENROLLMENT_REQUIRED'
                        ? 'admin.enrollmentBody'
                        : 'admin.totpBody',
                    )}
                  </p>
                </div>
              </div>
              {challenge.state === 'ENROLLMENT_REQUIRED' ? (
                <div className="admin-login__enrollment">
                  <EnrollmentQrCode
                    key={challenge.enrollmentUri}
                    enrollmentUri={challenge.enrollmentUri}
                  />
                  <details className="admin-login__manual-key">
                    <summary>{t('admin.manualKeyLabel')}</summary>
                    <code className="enrollment-key">{challenge.manualEntryKey}</code>
                  </details>
                </div>
              ) : null}
              <FormField
                label={t('admin.totpCode')}
                inputMode="numeric"
                enterKeyHint="done"
                autoFocus
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                leading={<Fingerprint aria-hidden="true" size={18} />}
                error={totpForm.formState.errors.code?.message}
                {...totpForm.register('code')}
              />
              <Button type="submit" variant="admin" loading={totpForm.formState.isSubmitting}>
                {t(totpForm.formState.isSubmitting ? 'admin.verifyingTotp' : 'admin.verify')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setChallenge(null);
                  setServerError(null);
                  totpForm.reset();
                }}
              >
                {t('admin.useDifferentAccount')}
              </Button>
            </form>
          )}
        </section>
      </div>
      <div className="admin-login__footer">
        <Link to="/">{t('admin.returnStore')}</Link>
        <span>{t('admin.securityNotice')}</span>
      </div>
    </main>
  );
}
