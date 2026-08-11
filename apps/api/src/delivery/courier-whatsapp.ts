export const COURIER_WHATSAPP_TEMPLATE_MAX_LENGTH = 2_000;
export const COURIER_WHATSAPP_RENDERED_MAX_LENGTH = 4_000;
export const DEFAULT_COURIER_WHATSAPP_TEMPLATE = `Commande {{orderNumber}}
Client : {{customerName}}
Téléphone : {{customerPhone}}
Adresse : {{deliveryAddress}}
Gouvernorat : {{governorate}}
Délégation : {{delegation}}
Localité : {{locality}}
Montant à encaisser : {{amountToCollect}}
Notes : {{orderNotes}}`;

export const COURIER_WHATSAPP_TEMPLATE_TOKENS = [
  'orderNumber',
  'customerName',
  'customerPhone',
  'deliveryAddress',
  'governorate',
  'delegation',
  'locality',
  'amountToCollect',
  'orderNotes',
] as const;

export type CourierWhatsAppTemplateToken = (typeof COURIER_WHATSAPP_TEMPLATE_TOKENS)[number];

export type CourierWhatsAppTemplateValues = Readonly<Record<CourierWhatsAppTemplateToken, string>>;

export interface CourierWhatsAppLinkInput {
  courierPhoneE164: string;
  template: string;
  values: CourierWhatsAppTemplateValues;
}

export interface CourierWhatsAppLink {
  renderedMessage: string;
  url: string;
}

export type CourierWhatsAppErrorCode =
  | 'COURIER_WHATSAPP_PHONE_INVALID'
  | 'COURIER_WHATSAPP_TEMPLATE_EMPTY'
  | 'COURIER_WHATSAPP_TEMPLATE_TOO_LONG'
  | 'COURIER_WHATSAPP_TEMPLATE_TOKEN_MALFORMED'
  | 'COURIER_WHATSAPP_TEMPLATE_TOKEN_UNKNOWN'
  | 'COURIER_WHATSAPP_VALUE_INVALID'
  | 'COURIER_WHATSAPP_MESSAGE_EMPTY'
  | 'COURIER_WHATSAPP_MESSAGE_TOO_LONG'
  | 'COURIER_WHATSAPP_MESSAGE_INVALID_UNICODE';

export class CourierWhatsAppError extends Error {
  constructor(
    readonly code: CourierWhatsAppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CourierWhatsAppError';
  }
}

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const TUNISIAN_PHONE_PATTERN = /^\+216[24579]\d{7}$/;
const TEMPLATE_TOKEN_PATTERN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
const ALLOWED_TOKEN_SET = new Set<string>(COURIER_WHATSAPP_TEMPLATE_TOKENS);

const isUnsafeFormatCharacter = (codePoint: number): boolean =>
  codePoint === 0x00ad ||
  codePoint === 0x061c ||
  codePoint === 0x200b ||
  codePoint === 0x200e ||
  codePoint === 0x200f ||
  (codePoint >= 0x202a && codePoint <= 0x202e) ||
  (codePoint >= 0x2060 && codePoint <= 0x206f) ||
  codePoint === 0xfeff;

const sanitizeMessageText = (value: string): string => {
  const normalizedLineBreaks = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\u0085', '\n')
    .replaceAll('\u2028', '\n')
    .replaceAll('\u2029', '\n');
  let sanitized = '';

  for (const character of normalizedLineBreaks) {
    const codePoint = character.codePointAt(0)!;
    if (character === '\n') {
      sanitized += character;
      continue;
    }
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      isUnsafeFormatCharacter(codePoint)
    ) {
      continue;
    }
    sanitized += character;
  }

  return sanitized;
};

const appendWithinRenderedLimit = (current: string, value: string): string => {
  if (current.length + value.length > COURIER_WHATSAPP_RENDERED_MAX_LENGTH) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_MESSAGE_TOO_LONG',
      `The rendered courier message exceeds ${COURIER_WHATSAPP_RENDERED_MAX_LENGTH} characters.`,
    );
  }
  return current + value;
};

export const renderCourierWhatsAppTemplate = (
  template: string,
  values: CourierWhatsAppTemplateValues,
): string => {
  if (typeof template !== 'string' || template.length === 0) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_TEMPLATE_EMPTY',
      'The courier message template is empty.',
    );
  }
  if (template.length > COURIER_WHATSAPP_TEMPLATE_MAX_LENGTH) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_TEMPLATE_TOO_LONG',
      `The courier message template exceeds ${COURIER_WHATSAPP_TEMPLATE_MAX_LENGTH} characters.`,
    );
  }

  TEMPLATE_TOKEN_PATTERN.lastIndex = 0;
  let cursor = 0;
  let renderedMessage = '';

  for (const match of template.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const matchIndex = match.index;
    const literal = template.slice(cursor, matchIndex);
    if (literal.includes('{') || literal.includes('}')) {
      throw new CourierWhatsAppError(
        'COURIER_WHATSAPP_TEMPLATE_TOKEN_MALFORMED',
        'The courier message template contains malformed token syntax.',
      );
    }

    const token = match[1]!;
    if (!ALLOWED_TOKEN_SET.has(token)) {
      throw new CourierWhatsAppError(
        'COURIER_WHATSAPP_TEMPLATE_TOKEN_UNKNOWN',
        'The courier message template contains an unsupported token.',
      );
    }

    const value = values[token as CourierWhatsAppTemplateToken];
    if (typeof value !== 'string') {
      throw new CourierWhatsAppError(
        'COURIER_WHATSAPP_VALUE_INVALID',
        'A courier message template value is invalid.',
      );
    }
    if (value.length > COURIER_WHATSAPP_RENDERED_MAX_LENGTH) {
      throw new CourierWhatsAppError(
        'COURIER_WHATSAPP_MESSAGE_TOO_LONG',
        `The rendered courier message exceeds ${COURIER_WHATSAPP_RENDERED_MAX_LENGTH} characters.`,
      );
    }

    renderedMessage = appendWithinRenderedLimit(renderedMessage, sanitizeMessageText(literal));
    renderedMessage = appendWithinRenderedLimit(renderedMessage, sanitizeMessageText(value));
    cursor = matchIndex + match[0].length;
  }

  const tail = template.slice(cursor);
  if (tail.includes('{') || tail.includes('}')) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_TEMPLATE_TOKEN_MALFORMED',
      'The courier message template contains malformed token syntax.',
    );
  }
  renderedMessage = appendWithinRenderedLimit(renderedMessage, sanitizeMessageText(tail));

  if (renderedMessage.trim().length === 0) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_MESSAGE_EMPTY',
      'The rendered courier message is empty.',
    );
  }

  return renderedMessage;
};

const validateCourierPhoneE164 = (courierPhoneE164: string): void => {
  if (
    typeof courierPhoneE164 !== 'string' ||
    !E164_PHONE_PATTERN.test(courierPhoneE164) ||
    (courierPhoneE164.startsWith('+216') && !TUNISIAN_PHONE_PATTERN.test(courierPhoneE164))
  ) {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_PHONE_INVALID',
      'The courier phone number must be a normalized E.164 number.',
    );
  }
};

export const buildCourierWhatsAppLink = (input: CourierWhatsAppLinkInput): CourierWhatsAppLink => {
  validateCourierPhoneE164(input.courierPhoneE164);
  const renderedMessage = renderCourierWhatsAppTemplate(input.template, input.values);
  let encodedMessage: string;

  try {
    encodedMessage = encodeURIComponent(renderedMessage);
  } catch {
    throw new CourierWhatsAppError(
      'COURIER_WHATSAPP_MESSAGE_INVALID_UNICODE',
      'The rendered courier message contains invalid Unicode.',
    );
  }

  return {
    renderedMessage,
    url: `https://wa.me/${input.courierPhoneE164.slice(1)}?text=${encodedMessage}`,
  };
};
