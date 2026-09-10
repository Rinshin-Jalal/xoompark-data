// Pure checklist-computation logic, split out of the reservation detail page
// so it can be unit tested without pulling in Firestore/Next.js/React. Follows
// the same "Firestore/'server-only'-free so it runs under plain node" pattern
// used by src/lib/sourcing/__tests__.
import type { TaskKey } from './tasks';
import type { TaskLog } from './types';

export type TaskStatus = 'PENDING' | 'DONE' | 'NOT_APPLICABLE';

export interface ChecklistEntry {
  status: TaskStatus;
  latestLog: TaskLog | null;
}

/**
 * Computes each task's display status from its most recent log entry.
 * `taskLogs` is expected ordered `recordedAt` desc (as the Firestore query in
 * the detail page returns it) — the first match per key is the current state.
 * PENDING is never stored; it's the absence of any log for that key.
 */
export function computeChecklist(
  tasksSnapshot: TaskKey[],
  taskLogs: TaskLog[],
): Record<string, ChecklistEntry> {
  const result: Record<string, ChecklistEntry> = {};
  for (const key of tasksSnapshot) {
    const latest = taskLogs.find((l) => l.taskKey === key) ?? null;
    result[key] = {
      status: latest ? (latest.outcome as TaskStatus) : 'PENDING',
      latestLog: latest,
    };
  }
  return result;
}

/**
 * A PENDING task is "stale" once the session it belongs to has already
 * closed — nobody logged the task while the vehicle was still on-site. This
 * is purely a display signal (spec §13): nothing server-side ever infers
 * failure from silence, it's just a visual nudge for ops review.
 */
export function isTaskStale(status: TaskStatus, sessionClosed: boolean): boolean {
  return status === 'PENDING' && sessionClosed;
}
