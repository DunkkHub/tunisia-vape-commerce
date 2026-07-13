import { PrismaClient } from '@prisma/client';

const maximumAgeSeconds = Number.parseInt(
  process.env.WORKER_HEALTHCHECK_MAX_AGE_SECONDS ?? '60',
  10,
);
if (
  !Number.isSafeInteger(maximumAgeSeconds) ||
  maximumAgeSeconds < 10 ||
  maximumAgeSeconds > 3_600
) {
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient();
  try {
    const heartbeat = await prisma.systemHealthRecord.findFirst({
      where: { component: 'durable-outbox-worker', status: 'HEALTHY' },
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true },
    });
    const age = heartbeat ? Date.now() - heartbeat.checkedAt.getTime() : Number.POSITIVE_INFINITY;
    process.exitCode = age >= 0 && age <= maximumAgeSeconds * 1_000 ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
