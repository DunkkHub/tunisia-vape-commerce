import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { changeLocale, type Locale } from '../../i18n';

export function LanguageSwitch({ tone = 'store' }: { tone?: 'store' | 'admin' }) {
  const { i18n, t } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === 'ar' ? 'ar' : 'fr';

  return (
    <div className={`language-switch language-switch--${tone}`} aria-label={t('common.language')}>
      <Languages aria-hidden="true" size={16} />
      <button type="button" aria-pressed={locale === 'fr'} onClick={() => void changeLocale('fr')}>
        {t('common.french')}
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={locale === 'ar'} onClick={() => void changeLocale('ar')}>
        {t('common.arabic')}
      </button>
    </div>
  );
}
