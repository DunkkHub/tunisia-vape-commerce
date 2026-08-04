import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, RadioTower } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';

import { storefrontClient } from '../../api/storefront-client';
import { ServiceModePage } from '../../components/compliance/compliance-boundary';
import { DeliveryMetadata } from '../../components/storefront/delivery-metadata';
import { readDisplayableDeliveryMetadata } from '../../components/storefront/safe-delivery-metadata';
import { Button } from '../../components/ui/button';
import { EmptyState, LoadingState } from '../../components/ui/feedback';

const infoKeys = {
  faq: ['info.faqTitle', 'info.faqBody'],
  delivery: ['info.deliveryTitle', 'info.deliveryBody'],
  contact: ['info.contactTitle', 'info.contactBody'],
} as const;

export function InfoPage({ slug }: { slug: keyof typeof infoKeys }) {
  const { t } = useTranslation();
  const content = useQuery({
    queryKey: ['storefront', 'content', slug],
    queryFn: () => storefrontClient.content(slug),
    retry: false,
  });
  const [titleKey, bodyKey] = infoKeys[slug];
  return (
    <div className="content-page container page-pad">
      <header className="page-heading">
        <span className="eyebrow">{t('brand.signature')}</span>
        <h1>{t(titleKey)}</h1>
        <p>{t(bodyKey)}</p>
      </header>
      {content.isPending ? <LoadingState label={t('common.loading')} /> : null}
      {content.isError ? <EmptyState title={t('info.noContent')} /> : null}
      {content.data ? (
        <article className="prose-card">
          <h2>{content.data.title}</h2>
          <p>{content.data.content}</p>
        </article>
      ) : null}
    </div>
  );
}

const legalTitles: Record<string, string> = {
  terms: 'legal.termsTitle',
  privacy: 'legal.privacyTitle',
  returns: 'legal.returnsTitle',
  warnings: 'legal.warningsTitle',
};
export function LegalPage() {
  const { slug = 'terms' } = useParams();
  const { t } = useTranslation();
  const legal = useQuery({
    queryKey: ['legal', slug],
    queryFn: () => storefrontClient.legal(slug),
    retry: false,
  });
  return (
    <div className="legal-page container page-pad">
      <header className="page-heading">
        <span className="eyebrow">
          <FileText aria-hidden="true" size={17} />
          {t('footer.compliance')}
        </span>
        <h1>{t(legalTitles[slug] ?? 'legal.termsTitle')}</h1>
      </header>
      {legal.isPending ? <LoadingState label={t('common.loading')} /> : null}
      {legal.isError ? <EmptyState title={t('legal.unavailable')} /> : null}
      {legal.data ? (
        <article className="legal-document">
          <div className="legal-document__meta">
            {t('legal.version', {
              version: legal.data.version,
              date: new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeZone: 'Africa/Tunis',
              }).format(new Date(legal.data.publishedAt)),
            })}
          </div>
          <h2>{legal.data.title}</h2>
          <p>{legal.data.content}</p>
        </article>
      ) : null}
    </div>
  );
}

export function OrderConfirmationPage() {
  const { orderNumber = '' } = useParams();
  const location = useLocation();
  const { t } = useTranslation();
  const state =
    location.state && typeof location.state === 'object'
      ? (location.state as Record<string, unknown>)
      : undefined;
  const fulfillment =
    state?.orderNumber === orderNumber
      ? readDisplayableDeliveryMetadata(state.fulfillment)
      : undefined;
  return (
    <section className="confirmation-page container page-pad">
      <div className="confirmation-icon">
        <CheckCircle2 aria-hidden="true" />
      </div>
      <span className="eyebrow">{t('order.confirmedEyebrow')}</span>
      <h1>{t('order.confirmedTitle')}</h1>
      <p>{t('order.confirmedBody')}</p>
      <dl>
        <dt>{t('order.number')}</dt>
        <dd>{orderNumber}</dd>
      </dl>
      <DeliveryMetadata metadata={fulfillment} />
      <Button asChild>
        <Link to="/catalog">{t('order.continue')}</Link>
      </Button>
    </section>
  );
}

export function ExplicitServiceModePage({ mode }: { mode: 'maintenance' | 'prelaunch' }) {
  return <ServiceModePage mode={mode} />;
}

export function NotFoundPage() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <section className="not-found container page-pad">
      <RadioTower aria-hidden="true" />
      <span>404</span>
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <code>{location.pathname}</code>
      <Button asChild>
        <Link to="/">{t('notFound.home')}</Link>
      </Button>
    </section>
  );
}
