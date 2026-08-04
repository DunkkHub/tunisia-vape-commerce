import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderNotificationContent } from '../src/notification-templates.js';

const encryptionKey = 'template-test-encryption-key-material';

const encryptField = (value: string): string => {
  const key = createHash('sha256').update(encryptionKey, 'utf8').digest();
  const initializationVector = Buffer.alloc(12, 9);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  key.fill(0);
  return [
    initializationVector.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

describe('localized notification templates', () => {
  it('keeps legacy reset payloads and renders escaped branded HTML beside plain text', () => {
    const token = 'legacy-reset-token-that-is-more-than-thirty-two-characters';
    const content = renderNotificationContent({
      event: 'PASSWORD_RESET',
      channel: 'EMAIL',
      locale: 'fr-TN',
      payload: {
        encryptedResetToken: encryptField(token),
        expiresInMinutes: 30,
      },
      webUrl: 'https://store.example.test',
      encryptionKey,
      brandName: '<Jet & "Commerce">',
    });

    const actionUrl = `https://store.example.test/password-reset/confirm#token=${token}`;
    expect(content.body).toContain(actionUrl);
    expect(content.body).not.toContain('?token=');
    expect(content.html).toContain('<!doctype html>');
    expect(content.html).toContain('Réinitialiser mon mot de passe');
    expect(content.html).toContain(`href="${actionUrl}"`);
    expect(content.html).not.toContain('?token=');
    expect(content.html).toContain('&lt;Jet &amp; &quot;Commerce&quot;&gt;');
    expect(content.html).not.toContain('<Jet & "Commerce">');
  });

  it('accepts the versioned reset payload and renders right-to-left HTML', () => {
    const token = 'versioned-reset-token-that-is-more-than-thirty-two-characters';
    const content = renderNotificationContent({
      event: 'PASSWORD_RESET',
      channel: 'EMAIL',
      locale: 'ar-TN',
      payload: {
        kind: 'PASSWORD_RESET',
        encryptedResetToken: encryptField(token),
        expiresInMinutes: 15,
      },
      webUrl: 'https://store.example.test',
      encryptionKey,
      brandName: 'Tunisia Vape Commerce',
    });

    expect(content.body).toContain('15');
    expect(content.body).toContain(
      `https://store.example.test/password-reset/confirm#token=${token}`,
    );
    expect(content.body).not.toContain('?token=');
    expect(content.html).toContain('<html lang="ar" dir="rtl">');
    expect(content.html).toContain('إعادة تعيين كلمة المرور');
    expect(content.html).toContain(
      `href="https://store.example.test/password-reset/confirm#token=${token}"`,
    );
    expect(content.html).not.toContain('?token=');
  });

  it('renders provider-only Google sign-in guidance without reset material', () => {
    const content = renderNotificationContent({
      event: 'PASSWORD_RESET',
      channel: 'EMAIL',
      locale: 'fr-TN',
      payload: { kind: 'PROVIDER_SIGN_IN', provider: 'GOOGLE' },
      webUrl: 'https://store.example.test',
      encryptionKey,
      brandName: 'Tunisia Vape Commerce',
    });

    expect(content.subject).toBe('Connectez-vous avec Google');
    expect(content.body).toContain('https://store.example.test/login');
    expect(content.body).not.toContain('token=');
    expect(content.html).toContain('Ouvrir la page de connexion');
    expect(content.html).not.toContain('token=');
  });

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
