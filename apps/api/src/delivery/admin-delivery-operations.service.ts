import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourierStatus,
  DeliveryMethodType,
  DeliveryStatus,
  ManifestStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import {
  createOrderNotificationsWithOutbox,
  notificationEventForDeliveryStatus,
} from '../common/outbox/order-notifications';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import {
  DeliveryCsvError,
  type DeliveryStatusCsvCommand,
  parseDeliveryStatusCsv,
  serializeCsv,
  serializeDeliveryStatusCsv,
} from './delivery-csv';
import { canTransitionDelivery } from './delivery-transition-policy';
import type {
  CreateDeliveryManifestDto,
  CreateManualCourierDto,
  DeliveryManifestListQueryDto,
  DeliveryStatusExportQueryDto,
  ImportDeliveryStatusCsvDto,
  ManualCourierListQueryDto,
  TransitionDeliveryManifestDto,
  UpdateManualCourierDto,
} from './dto/admin-delivery.dto';

const COURIER_RECORD_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  contactName: true,
  phoneE164: true,
  email: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  integrations: {
    orderBy: { id: 'asc' },
    select: { type: true, name: true, active: true },
  },
  _count: { select: { deliveries: true, manifests: true } },
} as const satisfies Prisma.CourierSelect;

const MANIFEST_DETAIL_SELECT = {
  id: true,
  manifestNumber: true,
  status: true,
  manifestDate: true,
  createdBy: true,
  sealedAt: true,
  handedOverAt: true,
  closedAt: true,
  createdAt: true,
  courier: { select: { id: true, code: true, name: true, status: true } },
  items: {
    orderBy: [{ sequence: 'asc' }, { deliveryId: 'asc' }],
    select: {
      sequence: true,
      addedAt: true,
      delivery: {
        select: {
          id: true,
          status: true,
          version: true,
          trackingNumber: true,
          ageVerificationRequired: true,
          order: {
            select: {
              orderNumber: true,
              customerNameSnapshot: true,
              customerPhoneSnapshot: true,
              expectedCodMillimes: true,
              addressSnapshots: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: 1,
                select: {
                  governorateName: true,
                  delegationName: true,
                  localityName: true,
                  postalCode: true,
                  street: true,
                  building: true,
                  landmark: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.DeliveryManifestSelect;

const DELIVERY_BULK_OPERATION_SELECT = {
  id: true,
  orderId: true,
  courierId: true,
  status: true,
  version: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      customerEmailSnapshot: true,
      customerPhoneSnapshot: true,
      status: true,
      version: true,
      deliveryMethodType: true,
      customer: { select: { locale: true } },
    },
  },
  manifestItems: {
    where: {
      manifest: {
        is: {
          status: { in: [ManifestStatus.DRAFT, ManifestStatus.SEALED, ManifestStatus.HANDED_OVER] },
        },
      },
    },
    select: { manifestId: true },
  },
} as const satisfies Prisma.DeliverySelect;

type CourierRecord = Prisma.CourierGetPayload<{ select: typeof COURIER_RECORD_SELECT }>;
type ManifestDetail = Prisma.DeliveryManifestGetPayload<{ select: typeof MANIFEST_DETAIL_SELECT }>;
type BulkDelivery = Prisma.DeliveryGetPayload<{ select: typeof DELIVERY_BULK_OPERATION_SELECT }>;
type Transaction = Prisma.TransactionClient;

export interface ImportRowResult {
  row: number;
  deliveryId: string;
  currentStatus: DeliveryStatus | null;
  targetStatus: DeliveryStatus;
  valid: boolean;
  code: string | null;
  message: string | null;
}

export interface ImportResult {
  schemaVersion: 'DELIVERY_STATUS_V1';
  importKey: string;
  dryRun: boolean;
  valid: boolean;
  applied: boolean;
  rowCount: number;
  appliedCount: number;
  rows: ImportRowResult[];
}

const ACTIVE_MANIFEST_STATUSES = [
  ManifestStatus.DRAFT,
  ManifestStatus.SEALED,
  ManifestStatus.HANDED_OVER,
] as const;
const TERMINAL_DELIVERY_STATUSES = new Set<DeliveryStatus>([
  DeliveryStatus.DELIVERED,
  DeliveryStatus.RETURNED,
  DeliveryStatus.CANCELLED,
]);
const COURIER_REQUIRED_TARGETS = new Set<DeliveryStatus>([
  DeliveryStatus.ASSIGNED_TO_COURIER,
  DeliveryStatus.HANDED_TO_COURIER,
]);
const EXPLANATION_REQUIRED_TARGETS = new Set<DeliveryStatus>([
  DeliveryStatus.ON_HOLD,
  DeliveryStatus.RETURN_TO_SENDER,
]);

@Injectable()
export class AdminDeliveryOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async listCourierRecords(query: ManualCourierListQueryDto) {
    const where = query.status ? { status: query.status } : {};
    const [records, total] = await this.prisma.$transaction([
      this.prisma.courier.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: COURIER_RECORD_SELECT,
      }),
      this.prisma.courier.count({ where }),
    ]);
    return {
      data: {
        items: records.map((record) => this.serializeCourier(record)),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createManualCourier(input: CreateManualCourierDto, request: Request) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const courier = await transaction.courier.create({
          data: {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            contactName: input.contactName?.trim() ?? null,
            phoneE164: input.phoneE164 ?? null,
            email: input.email?.trim().toLowerCase() ?? null,
            notes: input.notes?.trim() ?? null,
            integrations: {
              create: {
                type: 'MANUAL',
                name: 'Manual administrator operations',
                active: true,
                configuration: { mode: 'MANUAL_ADMIN' },
              },
            },
          },
          select: COURIER_RECORD_SELECT,
        });
        await this.audit(transaction, request, {
          action: 'delivery.courier.manual_created',
          resourceType: 'Courier',
          resourceId: courier.id,
          after: { code: courier.code, name: courier.name, status: courier.status, mode: 'MANUAL' },
        });
        return { data: this.serializeCourier(courier) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict('COURIER_CODE_CONFLICT', 'The courier code is already assigned.');
      }
      throw error;
    }
  }

  async updateManualCourier(id: string, input: UpdateManualCourierDto, request: Request) {
    const changeKeys = [
      'code',
      'name',
      'contactName',
      'phoneE164',
      'email',
      'notes',
      'status',
    ] as const;
    if (!changeKeys.some((key) => input[key] !== undefined)) {
      throw this.badRequest('COURIER_UPDATE_EMPTY', 'At least one courier field must be changed.');
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM Courier WHERE id = ${id} FOR UPDATE`);
        const courier = await transaction.courier.findUnique({
          where: { id },
          select: COURIER_RECORD_SELECT,
        });
        if (!courier) throw this.courierNotFound();
        if (courier.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
          throw this.conflict(
            'COURIER_VERSION_CONFLICT',
            'The courier record changed. Refresh and try again.',
          );
        }
        if (courier.integrations.some(({ type }) => type !== 'MANUAL')) {
          throw this.conflict(
            'COURIER_EXTERNAL_CONFIGURATION_MANAGED_ELSEWHERE',
            'A courier with an external integration cannot be changed through the manual workflow.',
          );
        }
        if (input.status && input.status !== CourierStatus.ACTIVE && courier.status === 'ACTIVE') {
          const [activeDeliveries, activeManifests] = await Promise.all([
            transaction.delivery.count({
              where: {
                courierId: id,
                status: { notIn: [...TERMINAL_DELIVERY_STATUSES] },
              },
            }),
            transaction.deliveryManifest.count({
              where: { courierId: id, status: { in: [...ACTIVE_MANIFEST_STATUSES] } },
            }),
          ]);
          if (activeDeliveries > 0 || activeManifests > 0) {
            throw this.conflict(
              'COURIER_HAS_ACTIVE_CUSTODY',
              'Reassign or complete active deliveries and manifests before disabling the courier.',
            );
          }
        }
        const data: Prisma.CourierUpdateManyMutationInput = {
          ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.contactName !== undefined
            ? { contactName: input.contactName?.trim() ?? null }
            : {}),
          ...(input.phoneE164 !== undefined ? { phoneE164: input.phoneE164 } : {}),
          ...(input.email !== undefined
            ? { email: input.email?.trim().toLowerCase() ?? null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() ?? null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        };
        const changed = await transaction.courier.updateMany({
          where: { id, updatedAt: courier.updatedAt },
          data,
        });
        if (changed.count !== 1) {
          throw this.conflict(
            'COURIER_VERSION_CONFLICT',
            'The courier record changed. Refresh and try again.',
          );
        }
        await this.audit(transaction, request, {
          action: 'delivery.courier.manual_updated',
          resourceType: 'Courier',
          resourceId: id,
          before: { code: courier.code, name: courier.name, status: courier.status },
          after: {
            code: input.code?.trim().toUpperCase() ?? courier.code,
            name: input.name?.trim() ?? courier.name,
            status: input.status ?? courier.status,
            changedFields: changeKeys.filter((key) => input[key] !== undefined),
          },
        });
        const updated = await transaction.courier.findUnique({
          where: { id },
          select: COURIER_RECORD_SELECT,
        });
        if (!updated) throw this.courierNotFound();
        return { data: this.serializeCourier(updated) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict('COURIER_CODE_CONFLICT', 'The courier code is already assigned.');
      }
      throw error;
    }
  }

  async listManifests(query: DeliveryManifestListQueryDto) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.courierId ? { courierId: query.courierId } : {}),
    } satisfies Prisma.DeliveryManifestWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.deliveryManifest.findMany({
        where,
        orderBy: [{ manifestDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          manifestNumber: true,
          status: true,
          manifestDate: true,
          createdAt: true,
          courier: { select: { id: true, code: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.deliveryManifest.count({ where }),
    ]);
    return {
      data: {
        items: records.map((manifest) => ({
          id: manifest.id,
          manifestNumber: manifest.manifestNumber,
          status: manifest.status,
          manifestDate: manifest.manifestDate.toISOString().slice(0, 10),
          courier: manifest.courier,
          itemCount: manifest._count.items,
          createdAt: manifest.createdAt.toISOString(),
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getManifest(id: string, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const manifest = await transaction.deliveryManifest.findUnique({
        where: { id },
        select: MANIFEST_DETAIL_SELECT,
      });
      if (!manifest) throw this.manifestNotFound();
      await this.audit(transaction, request, {
        action: 'delivery.manifest.viewed',
        resourceType: 'DeliveryManifest',
        resourceId: id,
        after: { status: manifest.status, itemCount: manifest.items.length },
      });
      return { data: this.serializeManifest(manifest) };
    });
  }

  async createManifest(input: CreateDeliveryManifestDto, request: Request) {
    const manifestDate = new Date(`${input.manifestDate}T00:00:00.000Z`);
    if (
      Number.isNaN(manifestDate.getTime()) ||
      manifestDate.toISOString().slice(0, 10) !== input.manifestDate
    ) {
      throw this.badRequest('MANIFEST_DATE_INVALID', 'The manifest date is invalid.');
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM Courier WHERE id = ${input.courierId} FOR UPDATE`,
        );
        const courier = await transaction.courier.findFirst({
          where: { id: input.courierId, status: CourierStatus.ACTIVE },
          select: { id: true },
        });
        if (!courier) {
          throw this.conflict('COURIER_UNAVAILABLE', 'The selected courier is unavailable.');
        }
        const deliveries = await this.findBulkDeliveries(
          transaction,
          input.deliveries.map(({ deliveryId }) => deliveryId),
          true,
        );
        const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
        for (const item of input.deliveries) {
          const delivery = byId.get(item.deliveryId);
          if (!delivery) throw this.deliveryNotFound(item.deliveryId);
          if (delivery.version !== item.expectedVersion) {
            throw this.conflict(
              'VERSION_CONFLICT',
              `Delivery ${item.deliveryId} changed. Refresh and try again.`,
            );
          }
          if (
            delivery.order.deliveryMethodType !== DeliveryMethodType.COURIER ||
            delivery.courierId !== input.courierId ||
            delivery.status !== DeliveryStatus.ASSIGNED_TO_COURIER ||
            delivery.order.status !== DeliveryStatus.ASSIGNED_TO_COURIER
          ) {
            throw this.conflict(
              'MANIFEST_DELIVERY_INELIGIBLE',
              `Delivery ${item.deliveryId} is not assigned to this courier in the required state.`,
            );
          }
          if (delivery.manifestItems.length > 0) {
            throw this.conflict(
              'DELIVERY_ALREADY_ON_ACTIVE_MANIFEST',
              `Delivery ${item.deliveryId} is already on an active manifest.`,
            );
          }
        }

        const manifest = await transaction.deliveryManifest.create({
          data: {
            manifestNumber: this.newManifestNumber(manifestDate),
            courierId: input.courierId,
            manifestDate,
            createdBy: request.auth!.userId,
            items: {
              create: input.deliveries.map(({ deliveryId }, index) => ({
                deliveryId,
                sequence: index + 1,
              })),
            },
          },
          select: MANIFEST_DETAIL_SELECT,
        });
        await Promise.all([
          transaction.deliveryEvent.createMany({
            data: deliveries.map((delivery) => ({
              deliveryId: delivery.id,
              fromStatus: delivery.status,
              toStatus: delivery.status,
              actorUserId: request.auth!.userId,
              source: 'MANUAL_ADMIN',
              reasonCode: 'MANIFEST_ADDED',
              payload: { manifestId: manifest.id, manifestNumber: manifest.manifestNumber },
              requestId: request.requestId,
            })),
          }),
          this.audit(transaction, request, {
            action: 'delivery.manifest.created',
            resourceType: 'DeliveryManifest',
            resourceId: manifest.id,
            after: {
              manifestNumber: manifest.manifestNumber,
              courierId: input.courierId,
              status: ManifestStatus.DRAFT,
              itemCount: deliveries.length,
            },
          }),
        ]);
        return { data: this.serializeManifest(manifest) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict(
          'MANIFEST_CONFLICT',
          'The manifest or one of its delivery sequences conflicts with current data.',
        );
      }
      throw error;
    }
  }

  async transitionManifest(id: string, input: TransitionDeliveryManifestDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM DeliveryManifest WHERE id = ${id} FOR UPDATE`,
      );
      const manifest = await transaction.deliveryManifest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          courierId: true,
          sealedAt: true,
          handedOverAt: true,
          closedAt: true,
          courier: { select: { status: true } },
          items: { orderBy: { sequence: 'asc' }, select: { deliveryId: true } },
        },
      });
      if (!manifest) throw this.manifestNotFound();
      if (manifest.status !== input.expectedStatus) {
        throw this.conflict(
          'MANIFEST_VERSION_CONFLICT',
          'The manifest state changed. Refresh and try again.',
        );
      }
      if (!this.canTransitionManifest(manifest.status, input.targetStatus)) {
        throw this.conflict(
          'MANIFEST_TRANSITION_NOT_ALLOWED',
          'The manifest cannot perform that transition from its current state.',
        );
      }
      if (manifest.items.length === 0) {
        throw this.conflict('MANIFEST_EMPTY', 'An empty manifest cannot be transitioned.');
      }
      const deliveries = await this.findBulkDeliveries(
        transaction,
        manifest.items.map(({ deliveryId }) => deliveryId),
        true,
      );
      if (deliveries.length !== manifest.items.length) {
        throw this.conflict('MANIFEST_DELIVERY_MISSING', 'A manifest delivery is unavailable.');
      }

      if (input.targetStatus === ManifestStatus.SEALED) {
        if (manifest.courier.status !== CourierStatus.ACTIVE) {
          throw this.conflict('COURIER_UNAVAILABLE', 'The manifest courier is unavailable.');
        }
        this.assertManifestAssignedDeliveries(deliveries, manifest.courierId);
      }
      if (input.targetStatus === ManifestStatus.HANDED_OVER) {
        this.assertManifestAssignedDeliveries(deliveries, manifest.courierId);
        const now = new Date();
        for (const delivery of deliveries) {
          await this.applyDeliveryTransition(
            transaction,
            request,
            delivery,
            DeliveryStatus.HANDED_TO_COURIER,
            'MANIFEST_HANDOVER',
            null,
            'MANIFEST_HANDOFF',
            'delivery.manifest.handed_over',
            { handedToCourierAt: now },
          );
        }
      }
      if (
        input.targetStatus === ManifestStatus.CLOSED &&
        deliveries.some(({ status }) => !TERMINAL_DELIVERY_STATUSES.has(status))
      ) {
        throw this.conflict(
          'MANIFEST_DELIVERIES_NOT_TERMINAL',
          'Every manifest delivery must be delivered, returned, or cancelled before closure.',
        );
      }

      const now = new Date();
      const changed = await transaction.deliveryManifest.updateMany({
        where: { id, status: input.expectedStatus },
        data: {
          status: input.targetStatus,
          ...(input.targetStatus === ManifestStatus.SEALED ? { sealedAt: now } : {}),
          ...(input.targetStatus === ManifestStatus.HANDED_OVER ? { handedOverAt: now } : {}),
          ...(input.targetStatus === ManifestStatus.CLOSED ? { closedAt: now } : {}),
        },
      });
      if (changed.count !== 1) {
        throw this.conflict(
          'MANIFEST_VERSION_CONFLICT',
          'The manifest state changed. Refresh and try again.',
        );
      }
      await this.audit(transaction, request, {
        action: `delivery.manifest.${input.targetStatus.toLowerCase()}`,
        resourceType: 'DeliveryManifest',
        resourceId: id,
        before: { status: manifest.status },
        after: {
          status: input.targetStatus,
          reason: input.reason?.trim() ?? null,
          itemCount: deliveries.length,
        },
      });
      const detail = await transaction.deliveryManifest.findUnique({
        where: { id },
        select: MANIFEST_DETAIL_SELECT,
      });
      if (!detail) throw this.manifestNotFound();
      return { data: this.serializeManifest(detail) };
    });
  }

  async exportManifestCsv(id: string, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const manifest = await transaction.deliveryManifest.findUnique({
        where: { id },
        select: MANIFEST_DETAIL_SELECT,
      });
      if (!manifest) throw this.manifestNotFound();
      const headers = [
        'schemaVersion',
        'manifestNumber',
        'sequence',
        'deliveryId',
        'orderNumber',
        'trackingNumber',
        'recipientName',
        'recipientPhone',
        'governorate',
        'delegation',
        'locality',
        'postalCode',
        'street',
        'building',
        'landmark',
        'expectedCodMillimes',
        'ageVerificationRequired',
      ];
      const csv = serializeCsv(
        headers,
        manifest.items.map((item) => {
          const address = item.delivery.order.addressSnapshots[0];
          return [
            'DELIVERY_MANIFEST_V1',
            manifest.manifestNumber,
            item.sequence,
            item.delivery.id,
            item.delivery.order.orderNumber,
            item.delivery.trackingNumber,
            item.delivery.order.customerNameSnapshot,
            item.delivery.order.customerPhoneSnapshot,
            address?.governorateName,
            address?.delegationName,
            address?.localityName,
            address?.postalCode,
            address?.street,
            address?.building,
            address?.landmark,
            item.delivery.order.expectedCodMillimes,
            item.delivery.ageVerificationRequired,
          ];
        }),
      );
      await this.audit(transaction, request, {
        action: 'delivery.manifest.csv_exported',
        resourceType: 'DeliveryManifest',
        resourceId: id,
        after: { schemaVersion: 'DELIVERY_MANIFEST_V1', rowCount: manifest.items.length },
      });
      return { csv, filename: `${manifest.manifestNumber}.csv`, rowCount: manifest.items.length };
    });
  }

  async exportStatusCsv(query: DeliveryStatusExportQueryDto, request: Request) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw this.badRequest(
        'DELIVERY_EXPORT_RANGE_INVALID',
        'The export start must not be after its end.',
      );
    }
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.courierId ? { courierId: query.courierId } : {}),
      ...(from || to
        ? { updatedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    } satisfies Prisma.DeliveryWhereInput;
    return this.prisma.$transaction(async (transaction) => {
      const records = await transaction.delivery.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        select: {
          id: true,
          status: true,
          version: true,
          trackingNumber: true,
          ageVerificationRequired: true,
          updatedAt: true,
          courier: { select: { code: true } },
          order: { select: { orderNumber: true, expectedCodMillimes: true } },
        },
      });
      const csv = serializeDeliveryStatusCsv(
        records.map((delivery) => ({
          deliveryId: delivery.id,
          expectedVersion: delivery.version,
          currentStatus: delivery.status,
          orderNumber: delivery.order.orderNumber,
          trackingNumber: delivery.trackingNumber,
          courierCode: delivery.courier?.code ?? null,
          expectedCodMillimes: delivery.order.expectedCodMillimes,
          ageVerificationRequired: delivery.ageVerificationRequired,
          updatedAt: delivery.updatedAt,
        })),
      );
      await this.audit(transaction, request, {
        action: 'delivery.status.csv_exported',
        resourceType: 'DeliveryExport',
        resourceId: request.requestId.slice(0, 80),
        after: {
          schemaVersion: 'DELIVERY_STATUS_V1',
          rowCount: records.length,
          limit: query.limit,
          filters: {
            status: query.status ?? null,
            courierId: query.courierId ?? null,
            from: query.from ?? null,
            to: query.to ?? null,
          },
        },
      });
      return {
        csv,
        filename: `delivery-status-${new Date().toISOString().slice(0, 10)}.csv`,
        rowCount: records.length,
      };
    });
  }

  async importStatusCsv(input: ImportDeliveryStatusCsvDto, request: Request) {
    const payloadHash = createHash('sha256').update(input.csv, 'utf8').digest('hex');
    const replay = await this.prisma.deliveryStatusImport.findUnique({
      where: { importKey_dryRun: { importKey: input.importKey, dryRun: input.dryRun } },
      select: { payloadHash: true, result: true },
    });
    if (replay) return this.replayImport(replay, payloadHash);

    let commands: DeliveryStatusCsvCommand[];
    try {
      commands = parseDeliveryStatusCsv(input.csv);
    } catch (error) {
      if (error instanceof DeliveryCsvError) {
        throw new BadRequestException({ code: error.code, message: error.message, row: error.row });
      }
      throw error;
    }

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const deliveries = await this.findBulkDeliveries(
          transaction,
          commands.map(({ deliveryId }) => deliveryId),
          !input.dryRun,
        );
        const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
        const rows = commands.map((command) =>
          this.validateImportCommand(command, byId.get(command.deliveryId)),
        );
        const valid = rows.every((row) => row.valid);
        let appliedCount = 0;
        if (!input.dryRun && valid) {
          for (const command of commands) {
            const delivery = byId.get(command.deliveryId)!;
            await this.applyDeliveryTransition(
              transaction,
              request,
              delivery,
              command.targetStatus,
              command.reasonCode ?? 'CSV_STATUS_IMPORT',
              command.note,
              'MANUAL_CSV',
              'delivery.status.csv_imported',
              {},
            );
            appliedCount += 1;
          }
        }
        const importResult: ImportResult = {
          schemaVersion: 'DELIVERY_STATUS_V1',
          importKey: input.importKey,
          dryRun: input.dryRun,
          valid,
          applied: !input.dryRun && valid,
          rowCount: commands.length,
          appliedCount,
          rows,
        };
        await Promise.all([
          transaction.deliveryStatusImport.create({
            data: {
              importKey: input.importKey,
              dryRun: input.dryRun,
              payloadHash,
              rowCount: commands.length,
              appliedCount,
              result: importResult as unknown as Prisma.InputJsonValue,
              createdByUserId: request.auth!.userId,
            },
          }),
          this.audit(transaction, request, {
            action: input.dryRun
              ? 'delivery.status.csv_dry_run'
              : valid
                ? 'delivery.status.csv_applied'
                : 'delivery.status.csv_rejected',
            resourceType: 'DeliveryStatusImport',
            resourceId: input.importKey.slice(0, 80),
            after: {
              schemaVersion: 'DELIVERY_STATUS_V1',
              dryRun: input.dryRun,
              rowCount: commands.length,
              appliedCount,
              valid,
              payloadHash,
            },
          }),
        ]);
        return importResult;
      });
      return { data: { ...result, replayed: false } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.prisma.deliveryStatusImport.findUnique({
          where: { importKey_dryRun: { importKey: input.importKey, dryRun: input.dryRun } },
          select: { payloadHash: true, result: true },
        });
        if (concurrent) return this.replayImport(concurrent, payloadHash);
      }
      throw error;
    }
  }

  private validateImportCommand(
    command: DeliveryStatusCsvCommand,
    delivery: BulkDelivery | undefined,
  ): ImportRowResult {
    const invalid = (code: string, message: string): ImportRowResult => ({
      row: command.row,
      deliveryId: command.deliveryId,
      currentStatus: delivery?.status ?? null,
      targetStatus: command.targetStatus,
      valid: false,
      code,
      message,
    });
    if (!delivery) return invalid('DELIVERY_NOT_FOUND', 'The delivery was not found.');
    if (delivery.version !== command.expectedVersion) {
      return invalid('VERSION_CONFLICT', 'The delivery version does not match the CSV.');
    }
    if (delivery.status !== command.currentStatus) {
      return invalid(
        'DELIVERY_STATUS_CHANGED',
        'The current delivery status does not match the CSV.',
      );
    }
    if (delivery.order.status !== delivery.status) {
      return invalid(
        'DELIVERY_ORDER_STATUS_MISMATCH',
        'The order and delivery states are not aligned.',
      );
    }
    if (!canTransitionDelivery(delivery.status, command.targetStatus)) {
      return invalid(
        'DELIVERY_TRANSITION_NOT_ALLOWED',
        'The requested delivery transition is not allowed.',
      );
    }
    if (COURIER_REQUIRED_TARGETS.has(command.targetStatus) && !delivery.courierId) {
      return invalid('DELIVERY_COURIER_REQUIRED', 'An assigned courier is required.');
    }
    if (
      EXPLANATION_REQUIRED_TARGETS.has(command.targetStatus) &&
      (!command.note || command.note.trim().length < 4)
    ) {
      return invalid('DELIVERY_EXPLANATION_REQUIRED', 'A meaningful explanation is required.');
    }
    return {
      row: command.row,
      deliveryId: command.deliveryId,
      currentStatus: delivery.status,
      targetStatus: command.targetStatus,
      valid: true,
      code: null,
      message: null,
    };
  }

  private async applyDeliveryTransition(
    transaction: Transaction,
    request: Request,
    delivery: BulkDelivery,
    target: DeliveryStatus,
    reasonCode: string,
    note: string | null,
    source: string,
    action: string,
    deliveryData: Prisma.DeliveryUpdateManyMutationInput,
  ) {
    const [deliveryUpdated, orderUpdated] = await Promise.all([
      transaction.delivery.updateMany({
        where: { id: delivery.id, status: delivery.status, version: delivery.version },
        data: { ...deliveryData, status: target, version: { increment: 1 } },
      }),
      transaction.order.updateMany({
        where: {
          id: delivery.order.id,
          status: delivery.order.status,
          version: delivery.order.version,
        },
        data: { status: target, version: { increment: 1 } },
      }),
    ]);
    if (deliveryUpdated.count !== 1 || orderUpdated.count !== 1) {
      throw this.conflict(
        'VERSION_CONFLICT',
        `Delivery ${delivery.id} changed while the operation was being applied.`,
      );
    }
    const events: Promise<unknown>[] = [
      transaction.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status,
          toStatus: target,
          actorUserId: request.auth!.userId,
          source,
          reasonCode,
          note,
          requestId: request.requestId,
        },
      }),
      transaction.orderStatusHistory.create({
        data: {
          orderId: delivery.order.id,
          fromStatus: delivery.order.status,
          toStatus: target,
          reasonCode,
          note,
          changedByUserId: request.auth!.userId,
          requestId: request.requestId,
        },
      }),
      this.audit(transaction, request, {
        action,
        resourceType: 'Delivery',
        resourceId: delivery.id,
        before: { status: delivery.status, version: delivery.version },
        after: { status: target, version: delivery.version + 1 },
      }),
    ];
    const notificationEvent = notificationEventForDeliveryStatus(target);
    if (notificationEvent) {
      events.push(
        createOrderNotificationsWithOutbox(transaction, this.crypto, {
          order: {
            id: delivery.order.id,
            orderNumber: delivery.order.orderNumber,
            customerEmailSnapshot: delivery.order.customerEmailSnapshot,
            customerPhoneSnapshot: delivery.order.customerPhoneSnapshot,
            locale: delivery.order.customer?.locale === 'ar' ? 'ar-TN' : 'fr-TN',
          },
          event: notificationEvent,
          scheduledAt: new Date(),
          idempotencyDiscriminator: `delivery:${target.toLocaleLowerCase('en-US')}:v${delivery.order.version + 1}`,
        }),
      );
    }
    await Promise.all(events);
  }

  private async findBulkDeliveries(
    transaction: Transaction,
    ids: string[],
    lock: boolean,
  ): Promise<BulkDelivery[]> {
    const sortedIds = [...ids].sort();
    if (lock && sortedIds.length > 0) {
      const references = await transaction.delivery.findMany({
        where: { id: { in: sortedIds } },
        select: { orderId: true },
      });
      const orderIds = [...new Set(references.map(({ orderId }) => orderId))].sort();
      if (orderIds.length > 0) {
        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM \`Order\` WHERE id IN (${Prisma.join(orderIds)}) ORDER BY id FOR UPDATE`,
        );
      }
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM Delivery WHERE id IN (${Prisma.join(sortedIds)}) ORDER BY id FOR UPDATE`,
      );
    }
    return transaction.delivery.findMany({
      where: { id: { in: sortedIds } },
      orderBy: { id: 'asc' },
      select: DELIVERY_BULK_OPERATION_SELECT,
    });
  }

  private assertManifestAssignedDeliveries(deliveries: BulkDelivery[], courierId: string) {
    if (
      deliveries.some(
        (delivery) =>
          delivery.courierId !== courierId ||
          delivery.status !== DeliveryStatus.ASSIGNED_TO_COURIER ||
          delivery.order.status !== DeliveryStatus.ASSIGNED_TO_COURIER,
      )
    ) {
      throw this.conflict(
        'MANIFEST_DELIVERY_INELIGIBLE',
        'Every manifest delivery must remain assigned to its courier before handoff.',
      );
    }
  }

  private canTransitionManifest(from: ManifestStatus, to: ManifestStatus): boolean {
    const transitions: Record<ManifestStatus, readonly ManifestStatus[]> = {
      DRAFT: [ManifestStatus.SEALED, ManifestStatus.CANCELLED],
      SEALED: [ManifestStatus.HANDED_OVER, ManifestStatus.CANCELLED],
      HANDED_OVER: [ManifestStatus.CLOSED],
      CLOSED: [],
      CANCELLED: [],
    };
    return transitions[from].includes(to);
  }

  private replayImport(
    record: { payloadHash: string; result: Prisma.JsonValue },
    payloadHash: string,
  ) {
    if (record.payloadHash !== payloadHash) {
      throw this.conflict(
        'DELIVERY_IMPORT_KEY_REUSED',
        'This import key was already used with different CSV content.',
      );
    }
    return {
      data: { ...(record.result as unknown as ImportResult), replayed: true },
    };
  }

  private serializeCourier(courier: CourierRecord) {
    return {
      id: courier.id,
      code: courier.code,
      name: courier.name,
      status: courier.status,
      contactName: courier.contactName,
      phoneE164: courier.phoneE164,
      email: courier.email,
      notes: courier.notes,
      integrations: courier.integrations,
      deliveryCount: courier._count.deliveries,
      manifestCount: courier._count.manifests,
      createdAt: courier.createdAt.toISOString(),
      updatedAt: courier.updatedAt.toISOString(),
    };
  }

  private serializeManifest(manifest: ManifestDetail) {
    return {
      id: manifest.id,
      manifestNumber: manifest.manifestNumber,
      status: manifest.status,
      manifestDate: manifest.manifestDate.toISOString().slice(0, 10),
      courier: manifest.courier,
      itemCount: manifest.items.length,
      items: manifest.items.map((item) => ({
        sequence: item.sequence,
        addedAt: item.addedAt.toISOString(),
        deliveryId: item.delivery.id,
        status: item.delivery.status,
        version: item.delivery.version,
        trackingNumber: item.delivery.trackingNumber,
        ageVerificationRequired: item.delivery.ageVerificationRequired,
        orderNumber: item.delivery.order.orderNumber,
        recipientName: item.delivery.order.customerNameSnapshot,
        recipientPhone: item.delivery.order.customerPhoneSnapshot,
        expectedCodMillimes: item.delivery.order.expectedCodMillimes,
        address: item.delivery.order.addressSnapshots[0] ?? null,
      })),
      createdBy: manifest.createdBy,
      sealedAt: manifest.sealedAt?.toISOString() ?? null,
      handedOverAt: manifest.handedOverAt?.toISOString() ?? null,
      closedAt: manifest.closedAt?.toISOString() ?? null,
      createdAt: manifest.createdAt.toISOString(),
    };
  }

  private newManifestNumber(date: Date): string {
    return `MNF-${date.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private audit(
    transaction: Transaction,
    request: Request,
    input: {
      action: string;
      resourceType: string;
      resourceId: string;
      before?: Prisma.InputJsonValue;
      after?: Prisma.InputJsonValue;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: request.auth!.userId,
        actorType: 'ADMIN',
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: 'SUCCESS',
        requestId: request.requestId,
        ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
        userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
        ...(input.before !== undefined ? { beforeSummary: input.before } : {}),
        ...(input.after !== undefined ? { afterSummary: input.after } : {}),
      },
    });
  }

  private courierNotFound() {
    return new NotFoundException({
      code: 'COURIER_NOT_FOUND',
      message: 'The courier was not found.',
    });
  }

  private manifestNotFound() {
    return new NotFoundException({
      code: 'DELIVERY_MANIFEST_NOT_FOUND',
      message: 'The delivery manifest was not found.',
    });
  }

  private deliveryNotFound(id: string) {
    return new NotFoundException({
      code: 'DELIVERY_NOT_FOUND',
      message: `Delivery ${id} was not found.`,
    });
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private badRequest(code: string, message: string) {
    return new BadRequestException({ code, message });
  }
}
