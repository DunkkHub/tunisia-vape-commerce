import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type SettingValueType } from '@prisma/client';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import type { SettingScope, UpdateOperationalSettingDto } from './dto/admin-settings.dto';

type SettingRule = {
  valueType: SettingValueType;
  validate: (value: unknown) => boolean;
  message: string;
};

const CONFIGURATION_EXPORT_RECORD_LIMIT = 500;
const CONFIGURATION_EXPORT_BYTE_LIMIT = 1_048_576;
const SENSITIVE_SETTING_KEY =
  /(^|[._-])(secret|password|token|credential|api[._-]?key|private[._-]?key|encryption|database|redis|smtp|webhook)([._-]|$)/i;

const canonicalJsonValue = (value: Prisma.JsonValue): Prisma.JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalJsonValue(value[key]!)]),
    );
  }
  return value;
};

const boolRule: SettingRule = {
  valueType: 'BOOLEAN',
  validate: (value) => typeof value === 'boolean',
  message: 'The setting value must be a boolean.',
};

const stringRule = (maximum: number, extra?: (value: string) => boolean): SettingRule => ({
  valueType: 'STRING',
  validate: (value) =>
    typeof value === 'string' && value.length <= maximum && (extra?.(value) ?? true),
  message: 'The setting value is not valid for this operational field.',
});

const storeRules: Readonly<Record<string, SettingRule>> = {
  'checkout.enabled': boolRule,
  'maintenance.mode': boolRule,
  'prelaunch.mode': boolRule,
  'store.name': stringRule(200),
  'store.phone': stringRule(16, (value) => value === '' || /^\+216[24579]\d{7}$/.test(value)),
  'store.email': stringRule(
    320,
    (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  ),
  'store.address': stringRule(500),
  'store.currency': stringRule(3, (value) => value === 'TND'),
  'store.timezone': stringRule(40, (value) => value === 'Africa/Tunis'),
  'store.default_locale': stringRule(2, (value) => value === 'fr' || value === 'ar'),
  'notifications.admin_order_created.enabled': boolRule,
  'notifications.customer_order_created.enabled': boolRule,
  'notifications.customer_order_sms.enabled': boolRule,
  'notifications.security_alert_email': stringRule(
    320,
    (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  ),
  'notifications.order_alert_email': stringRule(
    320,
    (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  ),
  'notifications.low_stock_alert_email': stringRule(
    320,
    (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  ),
  'notifications.operational_alert_locale': stringRule(
    2,
    (value) => value === 'fr' || value === 'ar',
  ),
};

const complianceRules: Readonly<Record<string, SettingRule>> = {
  minimum_purchase_age: {
    valueType: 'INTEGER',
    validate: (value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 120,
    message: 'The minimum purchase age must be an integer between 1 and 120.',
  },
  'age_gate.entry.enabled': boolRule,
  'age_gate.checkout.enabled': boolRule,
  'consent.terms.required': boolRule,
  'consent.privacy.required': boolRule,
  'consent.recording.enabled': boolRule,
  'delivery.age_verification_required': boolRule,
};

const metadata = (request: Request) => {
  const userAgent = request.get('user-agent');
  return {
    actorUserId: request.auth!.userId,
    actorType: 'ADMIN' as const,
    outcome: 'SUCCESS' as const,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async exportConfiguration(request: Request) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const [storeRows, complianceRows] = await Promise.all([
        transaction.storeSetting.findMany({
          orderBy: [{ key: 'asc' }, { id: 'asc' }],
          take: CONFIGURATION_EXPORT_RECORD_LIMIT + 1,
          select: { id: true, key: true, valueType: true, value: true, secret: true },
        }),
        transaction.complianceSetting.findMany({
          where: { key: { not: 'legal_review.completed' } },
          orderBy: [{ key: 'asc' }, { id: 'asc' }],
          take: CONFIGURATION_EXPORT_RECORD_LIMIT + 1,
          select: { id: true, key: true, valueType: true, value: true },
        }),
      ]);

      if (
        storeRows.length > CONFIGURATION_EXPORT_RECORD_LIMIT ||
        complianceRows.length > CONFIGURATION_EXPORT_RECORD_LIMIT
      ) {
        throw new ServiceUnavailableException({
          code: 'SETTINGS_EXPORT_TOO_LARGE',
          message: 'The configuration contains too many records to export safely.',
        });
      }

      const excludedStore = storeRows.filter(
        (setting) => setting.secret || SENSITIVE_SETTING_KEY.test(setting.key),
      );
      const excludedCompliance = complianceRows.filter((setting) =>
        SENSITIVE_SETTING_KEY.test(setting.key),
      );
      const safeRecord = (setting: {
        key: string;
        valueType: SettingValueType;
        value: Prisma.JsonValue;
      }) => ({
        key: setting.key,
        valueType: setting.valueType,
        value: canonicalJsonValue(setting.value),
      });
      const document = {
        format: 'tunisia-vape-store-configuration' as const,
        schemaVersion: 1 as const,
        store: storeRows
          .filter((setting) => !setting.secret && !SENSITIVE_SETTING_KEY.test(setting.key))
          .map(safeRecord),
        compliance: complianceRows
          .filter((setting) => !SENSITIVE_SETTING_KEY.test(setting.key))
          .map(safeRecord),
        excludedSecretCount: excludedStore.length + excludedCompliance.length,
      };
      const canonical = JSON.stringify(document);
      if (Buffer.byteLength(canonical, 'utf8') > CONFIGURATION_EXPORT_BYTE_LIMIT) {
        throw new ServiceUnavailableException({
          code: 'SETTINGS_EXPORT_TOO_LARGE',
          message: 'The configuration export exceeds the supported response size.',
        });
      }
      const checksumSha256 = createHash('sha256').update(canonical).digest('hex');

      await transaction.auditLog.create({
        data: {
          ...metadata(request),
          action: 'store.configuration.export',
          resourceType: 'StoreConfiguration',
          resourceId: 'safe-settings-v1',
          afterSummary: {
            format: document.format,
            schemaVersion: document.schemaVersion,
            storeSettingCount: document.store.length,
            complianceSettingCount: document.compliance.length,
            excludedSecretCount: document.excludedSecretCount,
            checksumSha256,
          },
        },
      });

      return { ...document, checksumSha256 };
    });

    return { data: result };
  }

  async update(
    scope: SettingScope,
    key: string,
    input: UpdateOperationalSettingDto,
    request: Request,
  ) {
    const rule = (scope === 'store' ? storeRules : complianceRules)[key];
    if (!rule) {
      throw new NotFoundException({
        code: 'SETTING_NOT_MANAGEABLE',
        message: 'The requested operational setting is not available through this API.',
      });
    }
    if (!input.reason.trim()) {
      throw new BadRequestException({
        code: 'SETTING_CHANGE_REASON_REQUIRED',
        message: 'A reason is required for an operational setting change.',
      });
    }
    if (!rule.validate(input.value)) {
      throw new BadRequestException({ code: 'INVALID_SETTING_VALUE', message: rule.message });
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const current =
        scope === 'store'
          ? await transaction.storeSetting.findUnique({ where: { key } })
          : await transaction.complianceSetting.findUnique({ where: { key } });
      if (!current) {
        throw new NotFoundException({
          code: 'SETTING_NOT_FOUND',
          message: 'The requested operational setting has not been seeded.',
        });
      }
      if (current.version !== input.expectedVersion) throw this.versionConflict();
      if (current.valueType !== rule.valueType) {
        throw new ConflictException({
          code: 'SETTING_TYPE_MISMATCH',
          message: 'The stored setting type does not match its managed contract.',
        });
      }
      if (JSON.stringify(current.value) === JSON.stringify(input.value)) {
        throw new BadRequestException({
          code: 'SETTING_VALUE_UNCHANGED',
          message: 'The requested operational setting value is already active.',
        });
      }

      const nextValue = input.value as Prisma.InputJsonValue;
      const updated =
        scope === 'store'
          ? await transaction.storeSetting.updateMany({
              where: { key, version: input.expectedVersion },
              data: {
                value: nextValue,
                updatedBy: request.auth!.userId,
                version: { increment: 1 },
              },
            })
          : await transaction.complianceSetting.updateMany({
              where: { key, version: input.expectedVersion },
              data: {
                value: nextValue,
                version: { increment: 1 },
              },
            });
      if (updated.count !== 1) throw this.versionConflict();

      await transaction.auditLog.create({
        data: {
          ...metadata(request),
          action: `${scope}.setting.update`,
          resourceType: scope === 'store' ? 'StoreSetting' : 'ComplianceSetting',
          resourceId: current.id,
          beforeSummary: { key, value: current.value, version: current.version },
          afterSummary: {
            key,
            value: input.value as Prisma.InputJsonValue,
            version: current.version + 1,
            reason: input.reason.trim(),
          },
        },
      });
      return {
        id: current.id,
        scope: scope.toUpperCase(),
        key,
        valueType: current.valueType,
        value: input.value,
        version: current.version + 1,
        legallyReviewed: 'legallyReviewed' in current ? current.legallyReviewed : null,
        reviewedAt: 'reviewedAt' in current ? current.reviewedAt?.toISOString() : null,
        effectiveMayBeStricterByEnvironment: [
          'checkout.enabled',
          'maintenance.mode',
          'prelaunch.mode',
        ].includes(key),
      };
    });
    return { data: result };
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'The setting changed since it was loaded. Reload it and retry.',
    });
  }
}
