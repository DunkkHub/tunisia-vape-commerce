import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import argon2, { argon2id } from 'argon2';
import { PrismaClient } from '@prisma/client';

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

const validatePassword = (password: string): string[] => {
  const failures: string[] = [];
  if (password.length < 14 || password.length > 128) failures.push('must be 14-128 characters');
  if (!/[a-z]/.test(password)) failures.push('must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('must contain an uppercase letter');
  if (!/[0-9]/.test(password)) failures.push('must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('must contain a symbol');
  return failures;
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
  const failures = validatePassword(password);
  if (failures.length) throw new Error(`Password ${failures.join(', ')}`);

  const passwordHash = await argon2.hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 3,
    parallelism: 1,
  });
  const superAdministrator = await prisma.role.findUnique({
    where: { key: 'super-administrator' },
    select: { id: true },
  });
  if (!superAdministrator) {
    throw new Error(
      'Structural seed is missing the Super Administrator role; run pnpm prisma:seed',
    );
  }

  await prisma.user.create({
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
