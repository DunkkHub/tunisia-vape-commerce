import { Suspense, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '../components/ui/feedback';

export function RouteSuspense({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  return <Suspense fallback={<LoadingState label={t('common.loading')} />}>{children}</Suspense>;
}
