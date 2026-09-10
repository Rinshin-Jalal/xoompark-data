import { Timestamp } from 'firebase/firestore';
import type { ResourceHold, ResourceBooking } from './types';

export function intervalsOverlap(
  s1: Timestamp | number,
  e1: Timestamp | number,
  s2: Timestamp | number,
  e2: Timestamp | number,
): boolean {
  const ms = (t: Timestamp | number) => t instanceof Timestamp ? t.toMillis() : t;
  return ms(s1) < ms(e2) && ms(s2) < ms(e1);
}

export function computeAvailable(
  capacity: number,
  holds: ResourceHold[],
  bookings: ResourceBooking[],
  reqStart: Timestamp,
  reqEnd: Timestamp,
  now: Timestamp,
): number {
  const nowMs = now.toMillis();

  const activeHoldCount = holds.filter(
    (h) =>
      h.state === 'ACTIVE' &&
      h.expiresAt.toMillis() > nowMs &&
      intervalsOverlap(h.start, h.end, reqStart, reqEnd),
  ).length;

  const activeBookingCount = bookings.filter(
    (b) =>
      (b.state === 'CONFIRMED' || b.state === 'ACTIVE') &&
      intervalsOverlap(b.start, b.end, reqStart, reqEnd),
  ).length;

  return capacity - activeHoldCount - activeBookingCount;
}

export function ceilMinutes(start: Timestamp, end: Timestamp): number {
  return Math.ceil((end.toMillis() - start.toMillis()) / 60_000);
}
