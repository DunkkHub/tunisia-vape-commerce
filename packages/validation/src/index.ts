import { z } from 'zod';

export const emailSchema = z.email().trim().toLowerCase().max(254);

export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a symbol');

export const tunisianPhoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s().-]/g, ''))
  .transform((value) => (value.startsWith('+216') ? value : `+216${value.replace(/^00216/, '')}`))
  .pipe(z.string().regex(/^\+216[24579]\d{7}$/, 'Invalid Tunisian phone number'));

export const localeSchema = z.enum(['fr', 'ar']);
