import { describe, expect, it } from 'vitest';
import {
  buildCourierWhatsAppLink,
  COURIER_WHATSAPP_RENDERED_MAX_LENGTH,
  COURIER_WHATSAPP_TEMPLATE_MAX_LENGTH,
  COURIER_WHATSAPP_TEMPLATE_TOKENS,
  renderCourierWhatsAppTemplate,
} from './courier-whatsapp';
import type { CourierWhatsAppError, CourierWhatsAppTemplateValues } from './courier-whatsapp';

const values: CourierWhatsAppTemplateValues = {
  orderNumber: 'TN-2048',
  customerName: 'Amira',
  customerPhone: '+21620111222',
  deliveryAddress: '12 rue de la République',
  governorate: 'Bizerte',
  delegation: 'Bizerte Nord',
  locality: 'La Corniche',
  amountToCollect: '89,000 TND',
  orderNotes: 'Appeler à l’arrivée',
};

const compileTimeInternalFieldExclusion: CourierWhatsAppTemplateValues = {
  ...values,
  // @ts-expect-error Internal database identifiers are not courier template values.
  internalOrderId: 'cm_internal',
};
void compileTimeInternalFieldExclusion;

describe('courier WhatsApp template boundary', () => {
  it('exposes only the approved courier-safe token allowlist', () => {
    expect(COURIER_WHATSAPP_TEMPLATE_TOKENS).toEqual([
      'orderNumber',
      'customerName',
      'customerPhone',
      'deliveryAddress',
      'governorate',
      'delegation',
      'locality',
      'amountToCollect',
      'orderNotes',
    ]);
  });

  it('renders Arabic, punctuation and normalized line breaks with exact component encoding', () => {
    const maliciousLookingText = '"><script>alert(1)</script>&next=https://evil.test/?x=1#frag';
    const result = buildCourierWhatsAppLink({
      courierPhoneE164: '+21620111222',
      template:
        'طلب {{orderNumber}}\r\nالحريف: {{customerName}}\rالعنوان: {{deliveryAddress}}\nملاحظات: {{orderNotes}}',
      values: {
        ...values,
        customerName: 'آمنة & علي? #1',
        deliveryAddress: 'نهج الحبيب بورقيبة، بنزرت',
        orderNotes: maliciousLookingText,
      },
    });
    const expected =
      'طلب TN-2048\nالحريف: آمنة & علي? #1\nالعنوان: نهج الحبيب بورقيبة، بنزرت\nملاحظات: ' +
      maliciousLookingText;

    expect(result.renderedMessage).toBe(expected);
    expect(result.url).toBe(`https://wa.me/21620111222?text=${encodeURIComponent(expected)}`);
    expect(result.url).toContain('%26');
    expect(result.url).toContain('%3F');
    expect(result.url).toContain('%23');
    expect(result.url).toContain('%0A');
    expect(result.url).not.toContain('evil.test/?x=1#frag');
  });

  it('strips control and direction-override characters while preserving normalized line breaks', () => {
    const rendered = renderCourierWhatsAppTemplate('Note\t:\r\n{{orderNotes}}', {
      ...values,
      orderNotes: 'A\u0000B\u0008C\u0085D\u2028E\u2029F\u202eG\u2066H',
    });

    expect(rendered).toBe('Note:\nABC\nD\nE\nFGH');
  });

  it('builds a wa.me link for a normalized international E.164 number', () => {
    expect(
      buildCourierWhatsAppLink({
        courierPhoneE164: '+33612345678',
        template: 'Order {{orderNumber}}',
        values,
      }),
    ).toEqual({
      renderedMessage: 'Order TN-2048',
      url: 'https://wa.me/33612345678?text=Order%20TN-2048',
    });
  });

  it.each([
    '20111222',
    '0021620111222',
    '+216 20 111 222',
    '+21610111222',
    '+01234567890',
    '+1234567',
    '+1234567890123456',
    '+21620111222?text=owned',
    '+21620111222\n',
  ])('rejects non-normalized or invalid courier phone %j', (courierPhoneE164) => {
    expect(() =>
      buildCourierWhatsAppLink({ courierPhoneE164, template: '{{orderNumber}}', values }),
    ).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_PHONE_INVALID',
      }),
    );
  });

  it('rejects unknown tokens rather than reading arbitrary object fields', () => {
    expect(() =>
      renderCourierWhatsAppTemplate('Order {{internalOrderId}}', {
        ...values,
        internalOrderId: 'cm_internal',
      } as CourierWhatsAppTemplateValues & { internalOrderId: string }),
    ).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_TEMPLATE_TOKEN_UNKNOWN',
      }),
    );
  });

  it.each([
    '{{ orderNumber }}',
    '{{orderNumber',
    '{orderNumber}',
    '{{customer.name}}',
    '{{order_Number}}',
    '{{orderNumber}}}',
  ])('rejects malformed token syntax %j', (template) => {
    expect(() => renderCourierWhatsAppTemplate(template, values)).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_TEMPLATE_TOKEN_MALFORMED',
      }),
    );
  });

  it('enforces separate template and rendered-message length limits', () => {
    expect(() =>
      renderCourierWhatsAppTemplate('x'.repeat(COURIER_WHATSAPP_TEMPLATE_MAX_LENGTH + 1), values),
    ).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_TEMPLATE_TOO_LONG',
      }),
    );

    expect(() =>
      renderCourierWhatsAppTemplate('{{orderNotes}}', {
        ...values,
        orderNotes: 'x'.repeat(COURIER_WHATSAPP_RENDERED_MAX_LENGTH + 1),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_MESSAGE_TOO_LONG',
      }),
    );
  });

  it('rejects invalid Unicode before constructing a URL', () => {
    expect(() =>
      buildCourierWhatsAppLink({
        courierPhoneE164: '+21620111222',
        template: '{{orderNotes}}',
        values: { ...values, orderNotes: '\ud800' },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CourierWhatsAppError>>({
        code: 'COURIER_WHATSAPP_MESSAGE_INVALID_UNICODE',
      }),
    );
  });
});
