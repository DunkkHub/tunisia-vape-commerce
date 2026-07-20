import { describe, expect, it } from 'vitest';
import { renderNotificationContent } from '../src/notification-templates.js';

describe('localized notification templates', () => {
  it('renders lifecycle email in the persisted customer locale', () => {
    expect(
      renderNotificationContent({
        event: 'ORDER_DELIVERED',
        channel: 'EMAIL',
        locale: 'ar-TN',
        payload: { orderNumber: 'TN-100' },
        webUrl: 'https://store.example.test',
        encryptionKey: 'unused-for-order-template',
      }),
    ).toEqual({ subject: 'تم توصيل الطلب', body: 'تم توصيل طلبك TN-100.' });
  });

  it('renders safe French and Arabic operational alert messages', () => {
    const security = renderNotificationContent({
      event: 'SECURITY_ALERT',
      channel: 'EMAIL',
      locale: 'fr-TN',
      payload: { alertCode: 'ADMIN_LOGIN_LOCKED', occurredAt: '2026-07-20T08:00:00.000Z' },
      webUrl: 'https://store.example.test',
      encryptionKey: 'unused-for-alert-template',
    });
    const stock = renderNotificationContent({
      event: 'LOW_STOCK_ALERT',
      channel: 'EMAIL',
      locale: 'ar-TN',
      payload: {
        sku: 'SKU-1',
        nameFr: 'Menthe',
        nameAr: 'نعناع',
        remainingQuantity: 2,
        threshold: 3,
        observedAt: '2026-07-20T08:00:00.000Z',
      },
      webUrl: 'https://store.example.test',
      encryptionKey: 'unused-for-alert-template',
    });

    expect(security.subject).toBe('Alerte de sécurité de la boutique');
    expect(security.body).toContain('ADMIN_LOGIN_LOCKED');
    expect(stock.subject).toBe('تنبيه مخزون منخفض');
    expect(stock.body).toContain('SKU-1');
    expect(stock.body).toContain('2');
  });

  it('rejects operational alerts on SMS', () => {
    expect(() =>
      renderNotificationContent({
        event: 'SECURITY_ALERT',
        channel: 'SMS',
        locale: 'fr-TN',
        payload: { alertCode: 'ADMIN_LOGIN_LOCKED', occurredAt: '2026-07-20T08:00:00.000Z' },
        webUrl: 'https://store.example.test',
        encryptionKey: 'unused-for-alert-template',
      }),
    ).toThrowError('NOTIFICATION_CHANNEL_UNSUPPORTED');
  });
});
