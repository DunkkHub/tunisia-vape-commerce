import { useTranslation } from 'react-i18next';

export function Price({ millimes, className = '' }: { millimes: number; className?: string }) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'ar' ? 'ar-TN' : 'fr-TN';
  const value = Number.isSafeInteger(millimes) ? millimes / 1000 : 0;
  return (
    <data className={`price ${className}`} value={millimes}>
      {new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'TND',
        minimumFractionDigits: 3,
      }).format(value)}
    </data>
  );
}

export function LocalDate({ value }: { value: string }) {
  const { i18n } = useTranslation();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(i18n.resolvedLanguage === 'ar' ? 'ar-TN' : 'fr-TN', {
        dateStyle: 'medium',
        timeZone: 'Africa/Tunis',
      }).format(date)}
    </time>
  );
}
