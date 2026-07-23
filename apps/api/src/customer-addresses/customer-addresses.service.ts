import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StorefrontLocale } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto';

const MAX_CUSTOMER_ADDRESSES = 20;

const addressSelect = {
  id: true,
  type: true,
  label: true,
  fullName: true,
  phoneE164: true,
  governorateId: true,
  delegationId: true,
  localityId: true,
  postalCode: true,
  street: true,
  building: true,
  floor: true,
  apartment: true,
  landmark: true,
  deliveryInstructions: true,
  isDefault: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  governorate: { select: { nameFr: true, nameAr: true } },
  delegation: { select: { nameFr: true, nameAr: true } },
  locality: { select: { nameFr: true, nameAr: true } },
} satisfies Prisma.AddressSelect;

type AddressRecord = Prisma.AddressGetPayload<{ select: typeof addressSelect }>;

interface GeographySelection {
  governorateId: string;
  delegationId: string;
  localityId: string | null;
  postalCode: string | null;
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const optionalText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

@Injectable()
export class CustomerAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, locale: StorefrontLocale) {
    const customerId = await this.requireCustomer(this.prisma, userId);
    const records = await this.prisma.address.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      take: MAX_CUSTOMER_ADDRESSES,
      select: addressSelect,
    });
    return { data: records.map((record) => serializeAddress(record, locale)) };
  }

  async create(userId: string, input: CreateCustomerAddressDto, locale: StorefrontLocale) {
    const record = await this.prisma.$transaction(async (transaction) => {
      const customerId = await this.lockCustomer(transaction, userId);
      const count = await transaction.address.count({
        where: { customerId, deletedAt: null },
      });
      if (count >= MAX_CUSTOMER_ADDRESSES) {
        throw new ConflictException({
          code: 'ADDRESS_LIMIT_REACHED',
          message: `A customer can save at most ${MAX_CUSTOMER_ADDRESSES} addresses.`,
        });
      }

      const geography: GeographySelection = {
        governorateId: input.governorateId,
        delegationId: input.delegationId,
        localityId: input.localityId ?? null,
        postalCode: optionalText(input.postalCode),
      };
      await this.validateGeography(transaction, geography);

      const isDefault = input.isDefault === true || count === 0;
      if (isDefault) {
        await transaction.address.updateMany({
          where: { customerId, deletedAt: null, isDefault: true },
          data: { isDefault: false, version: { increment: 1 } },
        });
      }
      return transaction.address.create({
        data: {
          customerId,
          type: input.type ?? 'HOME',
          label: optionalText(input.label),
          fullName: input.fullName,
          phoneE164: input.phone,
          ...geography,
          street: input.street,
          building: optionalText(input.building),
          floor: optionalText(input.floor),
          apartment: optionalText(input.apartment),
          landmark: optionalText(input.landmark),
          deliveryInstructions: optionalText(input.deliveryInstructions),
          isDefault,
        },
        select: addressSelect,
      });
    });
    return { data: serializeAddress(record, locale) };
  }

  async update(
    userId: string,
    addressId: string,
    input: UpdateCustomerAddressDto,
    locale: StorefrontLocale,
  ) {
    if (Object.keys(input).every((key) => key === 'expectedVersion')) {
      throw new BadRequestException({
        code: 'ADDRESS_UPDATE_EMPTY',
        message: 'At least one address field must be supplied.',
      });
    }

    const record = await this.prisma.$transaction(async (transaction) => {
      const customerId = await this.lockCustomer(transaction, userId);
      const current = await transaction.address.findFirst({
        where: { id: addressId, customerId, deletedAt: null },
        select: addressSelect,
      });
      if (!current) throw this.addressNotFound();
      if (current.version !== input.expectedVersion) throw this.versionConflict();

      const geography: GeographySelection = {
        governorateId: input.governorateId ?? current.governorateId,
        delegationId: input.delegationId ?? current.delegationId,
        localityId: hasOwn(input, 'localityId') ? (input.localityId ?? null) : current.localityId,
        postalCode: hasOwn(input, 'postalCode')
          ? optionalText(input.postalCode)
          : current.postalCode,
      };
      if (
        hasOwn(input, 'governorateId') ||
        hasOwn(input, 'delegationId') ||
        hasOwn(input, 'localityId') ||
        hasOwn(input, 'postalCode')
      ) {
        await this.validateGeography(transaction, geography);
      }

      let replacementDefaultId: string | null = null;
      if (current.isDefault && input.isDefault === false) {
        const replacement = await transaction.address.findFirst({
          where: { customerId, deletedAt: null, id: { not: current.id } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (!replacement) {
          throw new BadRequestException({
            code: 'DEFAULT_ADDRESS_REQUIRED',
            message: 'The only saved address must remain the default address.',
          });
        }
        replacementDefaultId = replacement.id;
      }

      if (input.isDefault === true) {
        await transaction.address.updateMany({
          where: {
            customerId,
            deletedAt: null,
            isDefault: true,
            id: { not: current.id },
          },
          data: { isDefault: false, version: { increment: 1 } },
        });
      }

      const data = this.updateData(input, geography);
      const updated = await transaction.address.updateMany({
        where: {
          id: current.id,
          customerId,
          deletedAt: null,
          version: input.expectedVersion,
        },
        data,
      });
      if (updated.count !== 1) throw this.versionConflict();

      if (replacementDefaultId) {
        await transaction.address.updateMany({
          where: { id: replacementDefaultId, customerId, deletedAt: null },
          data: { isDefault: true, version: { increment: 1 } },
        });
      }

      const result = await transaction.address.findFirst({
        where: { id: current.id, customerId, deletedAt: null },
        select: addressSelect,
      });
      if (!result) throw this.addressNotFound();
      return result;
    });
    return { data: serializeAddress(record, locale) };
  }

  async remove(userId: string, addressId: string, expectedVersion: number) {
    await this.prisma.$transaction(async (transaction) => {
      const customerId = await this.lockCustomer(transaction, userId);
      const current = await transaction.address.findFirst({
        where: { id: addressId, customerId, deletedAt: null },
        select: { id: true, isDefault: true, version: true },
      });
      if (!current) throw this.addressNotFound();
      if (current.version !== expectedVersion) throw this.versionConflict();

      const deleted = await transaction.address.updateMany({
        where: { id: current.id, customerId, deletedAt: null, version: expectedVersion },
        data: {
          deletedAt: new Date(),
          isDefault: false,
          version: { increment: 1 },
        },
      });
      if (deleted.count !== 1) throw this.versionConflict();

      if (current.isDefault) {
        const replacement = await transaction.address.findFirst({
          where: { customerId, deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement) {
          await transaction.address.updateMany({
            where: { id: replacement.id, customerId, deletedAt: null },
            data: { isDefault: true, version: { increment: 1 } },
          });
        }
      }
    });
    return { data: { id: addressId, deleted: true as const } };
  }

  private updateData(
    input: UpdateCustomerAddressDto,
    geography: GeographySelection,
  ): Prisma.AddressUncheckedUpdateManyInput {
    const data: Prisma.AddressUncheckedUpdateManyInput = { version: { increment: 1 } };
    if (input.type !== undefined) data.type = input.type;
    if (hasOwn(input, 'label')) data.label = optionalText(input.label);
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phone !== undefined) data.phoneE164 = input.phone;
    if (input.governorateId !== undefined) data.governorateId = geography.governorateId;
    if (input.delegationId !== undefined) data.delegationId = geography.delegationId;
    if (hasOwn(input, 'localityId')) data.localityId = geography.localityId;
    if (hasOwn(input, 'postalCode')) data.postalCode = geography.postalCode;
    if (input.street !== undefined) data.street = input.street;
    if (hasOwn(input, 'building')) data.building = optionalText(input.building);
    if (hasOwn(input, 'floor')) data.floor = optionalText(input.floor);
    if (hasOwn(input, 'apartment')) data.apartment = optionalText(input.apartment);
    if (hasOwn(input, 'landmark')) data.landmark = optionalText(input.landmark);
    if (hasOwn(input, 'deliveryInstructions')) {
      data.deliveryInstructions = optionalText(input.deliveryInstructions);
    }
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    return data;
  }

  private async validateGeography(
    transaction: Prisma.TransactionClient,
    selection: GeographySelection,
  ): Promise<void> {
    const delegation = await transaction.delegation.findFirst({
      where: {
        id: selection.delegationId,
        governorateId: selection.governorateId,
        active: true,
        governorate: { is: { active: true } },
      },
      select: { id: true },
    });
    if (!delegation || (!selection.localityId && selection.postalCode)) {
      throw this.invalidGeography();
    }
    if (!selection.localityId) return;

    const locality = await transaction.locality.findFirst({
      where: {
        id: selection.localityId,
        delegationId: selection.delegationId,
        active: true,
        ...(selection.postalCode
          ? { postalCodes: { some: { code: selection.postalCode, active: true } } }
          : {}),
      },
      select: { id: true },
    });
    if (!locality) throw this.invalidGeography();
  }

  private async lockCustomer(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const customerId = await this.requireCustomer(transaction, userId);
    // Prisma has no row-lock API. This scoped, parameterized lock serializes the per-customer
    // address limit and single-default invariant without exposing a raw client identifier.
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM CustomerProfile WHERE id = ${customerId} FOR UPDATE
    `);
    return this.requireCustomer(transaction, userId);
  }

  private async requireCustomer(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const customer = await client.customerProfile.findFirst({
      where: {
        userId,
        suspendedAt: null,
        anonymizedAt: null,
        user: { is: { audience: 'CUSTOMER', status: 'ACTIVE', deletedAt: null } },
      },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot manage saved addresses.',
      });
    }
    return customer.id;
  }

  private invalidGeography(): BadRequestException {
    return new BadRequestException({
      code: 'ADDRESS_GEOGRAPHY_INVALID',
      message: 'The selected address geography or postal code is invalid.',
    });
  }

  private addressNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'ADDRESS_NOT_FOUND',
      message: 'The requested saved address was not found.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'ADDRESS_VERSION_CONFLICT',
      message: 'The saved address changed since it was loaded. Reload it and retry.',
    });
  }
}

const serializeAddress = (record: AddressRecord, locale: StorefrontLocale) => ({
  id: record.id,
  type: record.type,
  label: record.label ?? record.type,
  fullName: record.fullName,
  phone: record.phoneE164,
  governorateId: record.governorateId,
  governorate: locale === 'ar' ? record.governorate.nameAr : record.governorate.nameFr,
  delegationId: record.delegationId,
  delegation: locale === 'ar' ? record.delegation.nameAr : record.delegation.nameFr,
  localityId: record.localityId,
  locality: record.locality
    ? locale === 'ar'
      ? record.locality.nameAr
      : record.locality.nameFr
    : '',
  postalCode: record.postalCode ?? '',
  street: record.street,
  building: record.building,
  floor: record.floor,
  apartment: record.apartment,
  landmark: record.landmark,
  deliveryInstructions: record.deliveryInstructions,
  isDefault: record.isDefault,
  version: record.version,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});
