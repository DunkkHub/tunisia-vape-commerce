import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Prisma, PrismaClient } from '@prisma/client';
import { adminPasswordFailures, hashAdminPassword } from '../auth/admin-password';

const prisma = new PrismaClient();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readSecret = async (prompt: string): Promise<string> => {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('admin:create requires an interactive TTY so the password cannot be echoed');
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
};

const run = async (): Promise<void> => {
  const terminal = createInterface({ input: stdin, output: stdout });
  const email = (await terminal.question('Administrator email: '))
    .trim()
    .toLocaleLowerCase('en-US');
  const displayName = (await terminal.question('Administrator name: ')).trim();
  terminal.close();

  if (!emailPattern.test(email) || email.length > 320) throw new Error('Invalid email address');
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error('Name must be 2-200 characters');
  }

  const password = await readSecret('Password (hidden): ');
  const confirmation = await readSecret('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const failures = adminPasswordFailures(password);
  if (failures.length) throw new Error(`Password ${failures.join(', ')}`);

  const passwordHash = await hashAdminPassword(password);
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM Role WHERE \`key\` = ${'super-administrator'} FOR UPDATE`,
    );
    const superAdministrator = await transaction.role.findUnique({
      where: { key: 'super-administrator' },
      select: { id: true },
    });
    if (!superAdministrator) {
      throw new Error(
        'Structural seed is missing the Super Administrator role; run pnpm prisma:seed',
      );
    }
    const existingAdministrators = await transaction.user.count({
      where: { audience: 'ADMIN' },
    });
    if (existingAdministrators !== 0) {
      throw new Error(
        'The first administrator already exists; create subsequent administrators from the protected access-management API',
      );
    }

    const created = await transaction.user.create({
      data: {
        audience: 'ADMIN',
        email,
        emailNormalized: email,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordChangedAt: new Date(),
        adminProfile: {
          create: {
            displayName,
            mustEnrollTwoFactor: true,
            invitationAcceptedAt: new Date(),
          },
        },
        roles: {
          create: { roleId: superAdministrator.id },
        },
      },
      select: { id: true },
    });
    await transaction.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'admin.bootstrap.created',
        resourceType: 'User',
        resourceId: created.id,
        outcome: 'SUCCESS',
        requestId: `admin-create:${randomUUID()}`,
      },
    });
  });

  stdout.write('Administrator created. TOTP enrollment is required at first login.\n');
};

void run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Administrator creation failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
