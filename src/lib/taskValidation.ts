// Pure validation / path-construction helpers used by
// src/app/dashboard/provider/taskActions.ts, split out so the
// security-relevant parts (tenancy path checks, input validation) can be unit
// tested without mocking Firebase Admin or next/headers. No Firestore,
// firebase-admin, or Next.js imports — runs under plain node.
import type { TaskKey } from './tasks';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function assertTaskInSnapshot(tasksSnapshot: TaskKey[], taskKey: TaskKey): void {
  if (!tasksSnapshot.includes(taskKey)) {
    throw new Error(`Task ${taskKey} is not in this reservation's task list`);
  }
}

export function validateLogOutcome(outcome: 'DONE' | 'NOT_APPLICABLE', reason?: string): void {
  if (outcome === 'NOT_APPLICABLE' && !reason?.trim()) {
    throw new Error('reason is required when outcome is NOT_APPLICABLE');
  }
}

export function validateIssueReason(reason: string): void {
  if (!reason.trim()) throw new Error('reason is required');
}

export function assertPhotoSizeOk(sizeBytes: number): void {
  if (sizeBytes > MAX_PHOTO_BYTES) {
    throw new Error('Photo must be 8 MB or smaller');
  }
}

/** Lowercased file extension, or 'bin' if the filename has none — never
 * normalizes to a fixed type (e.g. .jpg), since iOS produces .heic and
 * transcoding would be required to normalize safely. */
export function extractFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  // No dot at all, or the filename ends in a bare dot: nothing to extract.
  if (dotIndex === -1 || dotIndex === filename.length - 1) return 'bin';
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function buildTaskProofPath(args: {
  providerId: string;
  reservationId: string;
  taskKey: TaskKey;
  uploadId: string;
  ext: string;
}): string {
  return `proof/${args.providerId}/${args.reservationId}/${args.taskKey}/${args.uploadId}.${args.ext}`;
}

export function buildIssueProofPath(args: {
  providerId: string;
  reservationId: string;
  issueId: string;
  uploadId: string;
  ext: string;
}): string {
  return `proof/${args.providerId}/${args.reservationId}/issue_${args.issueId}/${args.uploadId}.${args.ext}`;
}

/**
 * Authorization check used by getProofSignedUrl for non-admin callers: a
 * provider may only read signed URLs for paths under their own provider
 * prefix. The trailing slash matters — without it, providerId "prov_1" would
 * incorrectly match a path belonging to "prov_12".
 */
export function isProofPathOwnedByProvider(storagePath: string, providerId: string): boolean {
  return storagePath.startsWith(`proof/${providerId}/`);
}
