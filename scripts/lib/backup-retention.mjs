import { lstat, readdir, rm } from 'node:fs/promises';
import { safeChildPath } from './backup-format.mjs';

const BACKUP_ARTIFACT_PATTERN =
  /^vape-store-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[a-f0-9]{8}\.sql(?:\.enc|\.gz(?:\.enc)?)(?:\.manifest\.json)?$/;

export const parseRetentionDays = (value) => {
  const normalized = value ?? '35';
  if (!/^\d+$/.test(normalized)) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer from 0 through 36500');
  }
  const days = Number(normalized);
  if (!Number.isSafeInteger(days) || days < 0 || days > 36_500) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer from 0 through 36500');
  }
  return days;
};

export const backupArtifactCreatedAt = (fileName) => {
  const match = fileName.match(BACKUP_ARTIFACT_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const pruneExpiredBackups = async ({
  directory,
  retentionDays,
  now = new Date(),
  preserveFileNames = [],
}) => {
  if (retentionDays === 0) return [];
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const preserved = new Set(preserveFileNames);
  const removed = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || preserved.has(entry.name)) continue;
    const createdAt = backupArtifactCreatedAt(entry.name);
    if (!createdAt || createdAt.getTime() >= cutoff) continue;
    const candidate = safeChildPath(directory, entry.name);
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    await rm(candidate);
    removed.push(entry.name);
  }
  return removed.sort();
};

export const backupArtifactPattern = BACKUP_ARTIFACT_PATTERN;
