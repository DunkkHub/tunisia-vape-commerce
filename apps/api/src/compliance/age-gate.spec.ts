import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { AgeGateService } from './age-gate.service';

const service = new AgeGateService(
  {} as PrismaService,
  { get: () => 'development' } as unknown as ConfigService<Environment, true>,
);

const requestWithSignedCookie = (payload: Record<string, unknown>): Request =>
  ({
    signedCookies: { vape_age_gate: JSON.stringify(payload) },
  }) as unknown as Request;

describe('signed storefront age gate', () => {
  it('accepts only a current signed-cookie payload for the configured age', () => {
    const now = Date.now();
    expect(
      service.isConfirmed(
        requestWithSignedCookie({
          subject: 'a'.repeat(43),
          minimumAge: 18,
          confirmedAt: new Date(now - 1_000).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        }),
        18,
      ),
    ).toBe(true);
  });

  it('rejects expired, mismatched and unsigned cookie data', () => {
    const now = Date.now();
    const expired = requestWithSignedCookie({
      subject: 'a'.repeat(43),
      minimumAge: 18,
      confirmedAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 60_000).toISOString(),
    });
    expect(service.isConfirmed(expired, 18)).toBe(false);
    expect(service.isConfirmed(expired, 21)).toBe(false);
    expect(
      service.isConfirmed(
        { cookies: { vape_age_gate: 'unsigned' }, signedCookies: {} } as unknown as Request,
        18,
      ),
    ).toBe(false);
  });
});
