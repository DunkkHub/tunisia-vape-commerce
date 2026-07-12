import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { ar } from './ar';
import { fr } from './fr';

export type Locale = 'fr' | 'ar';

function cookieLocale(): Locale | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = document.cookie
    .split('; ')
    .find((part) => part.startsWith('store_locale='))
    ?.split('=')[1];
  return value === 'ar' || value === 'fr' ? value : undefined;
}

const initialLocale = cookieLocale() ?? 'fr';

void i18n.use(initReactI18next).init({
  resources: { fr, ar },
  lng: initialLocale,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'ar'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  document.cookie = `store_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

applyDocumentLocale(initialLocale);
i18n.on('languageChanged', (language) => applyDocumentLocale(language === 'ar' ? 'ar' : 'fr'));

export async function changeLocale(locale: Locale) {
  await i18n.changeLanguage(locale);
}

export default i18n;
