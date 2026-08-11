import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service';

const databaseName = process.env.INTEGRATION_DATABASE_NAME;
if (!databaseName || !/^vape_it_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Integration tests require the disposable database runner');
}

const fixture = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;

describe.sequential('customer Google identity database boundary', () => {
  const prisma = new PrismaService();

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('keeps a local password mandatory for every administrator', async () => {
    const value = fixture();

    await expect(
      prisma.user.create({
        data: {
          audience: 'ADMIN',
          email: `admin-${value}@example.test`,
          emailNormalized: `admin-${value}@example.test`,
          passwordHash: null,
          status: 'ACTIVE',
        },
      }),
    ).rejects.toBeDefined();
  });

  it('persists one token-free provider identity below a customer profile', async () => {
    const value = fixture();
    const providerSubjectHash = randomBytes(32).toString('hex');
    const phoneE164 = `+2162${randomBytes(4).readUInt32BE().toString().padStart(10, '0').slice(0, 7)}`;
    const customer = await prisma.user.create({
      data: {
        audience: 'CUSTOMER',
        email: `customer-${value}@example.test`,
        emailNormalized: `customer-${value}@example.test`,
        passwordHash: null,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        customerProfile: {
          create: {
            firstName: 'Google',
            lastName: 'Customer',
            phoneE164,
            phoneSearch: phoneE164.replace(/\D/g, ''),
            locale: 'fr',
            externalIdentities: {
              create: {
                provider: 'GOOGLE',
                providerSubjectHash,
                emailNormalized: `customer-${value}@example.test`,
              },
            },
          },
        },
      },
      include: { customerProfile: { include: { externalIdentities: true } } },
    });

    expect(customer.passwordHash).toBeNull();
    expect(customer.customerProfile?.externalIdentities).toEqual([
      expect.objectContaining({
        provider: 'GOOGLE',
        providerSubjectHash,
        customerId: customer.customerProfile?.id,
      }),
    ]);
    expect(Object.keys(customer.customerProfile?.externalIdentities[0] ?? {})).not.toContain(
      'accessToken',
    );
    expect(Object.keys(customer.customerProfile?.externalIdentities[0] ?? {})).not.toContain(
      'refreshToken',
    );
    const customerProfileId = customer.customerProfile?.id;
    if (!customerProfileId) throw new Error('Customer profile was not created');

    await expect(
      prisma.customerExternalIdentity.create({
        data: {
          customerId: customerProfileId,
          provider: 'GOOGLE',
          providerSubjectHash: randomBytes(32).toString('hex'),
          emailNormalized: `customer-${value}@example.test`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
