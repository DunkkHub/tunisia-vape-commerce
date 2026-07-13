import argon2, { argon2id } from 'argon2';

export const ADMIN_ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
} as const;

export const adminPasswordFailures = (password: string): string[] => {
  const failures: string[] = [];
  if (password.length < 14 || password.length > 128) failures.push('must be 14-128 characters');
  if (!/[a-z]/.test(password)) failures.push('must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('must contain an uppercase letter');
  if (!/[0-9]/.test(password)) failures.push('must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('must contain a symbol');
  return failures;
};

export const hashAdminPassword = (password: string): Promise<string> =>
  argon2.hash(password, ADMIN_ARGON2_OPTIONS);
