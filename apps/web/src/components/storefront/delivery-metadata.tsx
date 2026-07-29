import { useTranslation } from 'react-i18next';

import { readDisplayableDeliveryMetadata } from './safe-delivery-metadata';

function validRange(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): minimum is number {
  return (
    typeof minimum === 'number' &&
    typeof maximum === 'number' &&
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    minimum >= 0 &&
    maximum >= minimum
  );
}

export function DeliveryMetadata({ metadata }: { metadata: unknown }) {
  const { t } = useTranslation();
  const safeMetadata = readDisplayableDeliveryMetadata(metadata);
  const minuteEstimate = validRange(
    safeMetadata?.estimatedMinMinutes,
    safeMetadata?.estimatedMaxMinutes,
  );
  const dayEstimate = validRange(safeMetadata?.estimatedMinDays, safeMetadata?.estimatedMaxDays);
  const hasEstimate = minuteEstimate || dayEstimate;
  const cashOnDelivery = safeMetadata?.paymentMethod === 'CASH_ON_DELIVERY';
  const hasPhoneStatus = typeof safeMetadata?.phoneConfirmationRequired === 'boolean';

  if (!hasEstimate && !cashOnDelivery && !hasPhoneStatus) return null;

  return (
    <dl className="delivery-facts" aria-label={t('checkout.deliveryDetails')}>
      {hasEstimate ? (
        <div>
          <dt>{t('checkout.estimatedDelivery')}</dt>
          <dd>
            {minuteEstimate
              ? t('checkout.estimateMinutes', {
                  min: safeMetadata.estimatedMinMinutes,
                  max: safeMetadata.estimatedMaxMinutes,
                })
              : t('checkout.estimateDays', {
                  min: safeMetadata.estimatedMinDays,
                  max: safeMetadata.estimatedMaxDays,
                })}
          </dd>
        </div>
      ) : null}
      {cashOnDelivery ? (
        <div>
          <dt>{t('checkout.paymentMethodLabel')}</dt>
          <dd>{t('checkout.cashOnDelivery')}</dd>
        </div>
      ) : null}
      {hasPhoneStatus ? (
        <div>
          <dt>{t('checkout.phoneConfirmation')}</dt>
          <dd>{t(safeMetadata.phoneConfirmationRequired ? 'common.yes' : 'common.no')}</dd>
        </div>
      ) : null}
    </dl>
  );
}
