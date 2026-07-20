import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import type { ConfirmAgeGateDto } from './dto/age-gate.dto';

const AGE_CONFIRMATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

interface AgeGateCookiePayload {
  subject: string;
  minimumAge: number;
  confirmedAt: string;
  expiresAt: string;
}

export const requestLocale = (request: Request): 'fr' | 'ar' =>
  request.get('accept-language')?.trim().toLowerCase().startsWith('ar') ? 'ar' : 'fr';

const settingInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

interface AgeGatePolicy {
  enabled: boolean;
  minimumAge: number | null;
}

@Injectable()
export class AgeGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async confirm(input: ConfirmAgeGateDto, request: Request, response: Response): Promise<void> {
    const allowedOrigin = new URL(this.config.get('WEB_URL', { infer: true })).origin;
    if (
      request.get('origin') !== allowedOrigin ||
      request.get('x-client-context') !== 'storefront'
    ) {
      throw new ForbiddenException({
        code: 'AGE_GATE_REQUEST_REJECTED',
        message: 'The age confirmation request could not be verified.',
      });
    }
    const policy = await this.policy();
    if (!policy.enabled) return;
    const minimumAge = policy.minimumAge;
    if (minimumAge === null || minimumAge < 1 || input.minimumAge !== minimumAge) {
      throw new BadRequestException({
        code: 'AGE_POLICY_CHANGED',
        message: 'The minimum-age policy changed. Refresh and confirm the current value.',
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + AGE_CONFIRMATION_MAX_AGE_MS);
    const subject = randomBytes(32).toString('base64url');
    const subjectHash = createHash('sha256').update(subject).digest('hex');
    const userAgent = request.get('user-agent');
    const ipAddress = request.ip?.slice(0, 45);
    await this.prisma.$transaction([
      this.prisma.consentRecord.create({
        data: {
          anonymousSubjectHash: subjectHash,
          type: 'AGE_GATE',
          granted: true,
          consentedAt: now,
          locale: requestLocale(request),
          source: 'storefront_age_gate',
          ...(ipAddress ? { ipAddress } : {}),
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
        },
      }),
      this.prisma.ageVerificationEvent.create({
        data: {
          phase: 'STORE_ENTRY',
          result: 'PENDING',
          minimumAge,
          method: 'self_attestation',
          reasonCode: 'SELF_ATTESTED_NOT_IDENTITY_VERIFIED',
          occurredAt: now,
          ...(ipAddress ? { ipAddress } : {}),
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          metadata: { confirmed: true, anonymousSubjectHash: subjectHash },
        },
      }),
    ]);

    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const payload: AgeGateCookiePayload = {
      subject,
      minimumAge,
      confirmedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    response.cookie(this.cookieName(production), JSON.stringify(payload), {
      signed: true,
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
      maxAge: AGE_CONFIRMATION_MAX_AGE_MS,
    });
  }

  async assertConfirmed(request: Request): Promise<void> {
    const policy = await this.policy();
    if (!policy.enabled) return;
    const minimumAge = policy.minimumAge;
    if (minimumAge === null || !this.isConfirmed(request, minimumAge)) {
      throw new ForbiddenException({
        code: 'AGE_CONFIRMATION_REQUIRED',
        message: 'Confirm the configured minimum age before accessing the catalog.',
      });
    }
  }

  isConfirmed(request: Request, minimumAge: number): boolean {
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const signedCookies = request.signedCookies as Record<string, unknown> | undefined;
    const value = signedCookies?.[this.cookieName(production)];
    if (typeof value !== 'string' || value.length > 1_024) return false;
    try {
      const parsed = JSON.parse(value) as Partial<AgeGateCookiePayload>;
      const confirmedAt = Date.parse(parsed.confirmedAt ?? '');
      const expiresAt = Date.parse(parsed.expiresAt ?? '');
      const now = Date.now();
      return (
        typeof parsed.subject === 'string' &&
        parsed.subject.length >= 32 &&
        parsed.minimumAge === minimumAge &&
        Number.isFinite(confirmedAt) &&
        confirmedAt <= now &&
        Number.isFinite(expiresAt) &&
        expiresAt > now &&
        expiresAt - confirmedAt <= AGE_CONFIRMATION_MAX_AGE_MS
      );
    } catch {
      return false;
    }
  }

  async minimumAge(): Promise<number | null> {
    return (await this.policy()).minimumAge;
  }

  async policy(): Promise<AgeGatePolicy> {
    const settings = await this.prisma.complianceSetting.findMany({
      where: { key: { in: ['minimum_purchase_age', 'age_gate.entry.enabled'] } },
      select: { key: true, value: true },
    });
    const values = new Map(settings.map((setting) => [setting.key, setting.value]));
    return {
      enabled:
        !values.has('age_gate.entry.enabled') || values.get('age_gate.entry.enabled') === true,
      minimumAge: settingInteger(values.get('minimum_purchase_age')),
    };
  }

  private cookieName(production: boolean): string {
    return production ? '__Host-vape_age_gate' : 'vape_age_gate';
  }
}
