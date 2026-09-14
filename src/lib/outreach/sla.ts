// Score-based priority + SLA rules for the My Day queue. Pure, dependency-free.
import type { Lead } from './workflow';

// Stage weight — closer to a closed deal = higher priority.
const STAGE_WEIGHTS: Record<string, number> = {
  qualified: 500,
  email_reply: 350,
  sdr: 200,
  followup: 200,
  email_followup: 100,
  ready: 100,
  verify: 50,
  research: 50,
  hold: 0,
};

/** Priority score = stage weight + urgency (overdue decay) + asset multiplier. */
export function calculateScore(l: Lead): number {
  let score = STAGE_WEIGHTS[l.stage] ?? 0;

  // Urgency — overdue follow-ups decay upward, capped at +150.
  const nextTouch = l.raw.next_touch_at;
  if (nextTouch) {
    const hoursOverdue = (Date.now() - new Date(nextTouch).getTime()) / (1000 * 60 * 60);
    if (hoursOverdue > 0) score += Math.min(hoursOverdue * 10, 150);
  }

  // Asset multiplier — big fleet-ready lots come first.
  const stalls = parseInt(l.raw.stall_count, 10) || 0;
  if (stalls >= 100) score += 80;
  else if (stalls >= 50) score += 40;
  else if (stalls >= 20) score += 10;

  return score;
}

/** Sort leads by score descending (highest priority first). */
export function sortByScore(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => calculateScore(b) - calculateScore(a) || a.id.localeCompare(b.id));
}

/** SLA warning — surfaced on task cards when a follow-up is overdue. */
export function slaWarning(l: Lead): string | null {
  const nextTouch = l.raw.next_touch_at;
  if (nextTouch) {
    const overdue = new Date(nextTouch).getTime() < Date.now();
    if (l.stage === 'email_followup') return overdue ? 'Follow-up overdue' : 'Awaiting reply';
    if (l.stage === 'sdr') return overdue ? 'Call overdue' : 'Call due';
  }
  if (l.stage === 'email_reply') return 'Reply received — respond';
  if (l.stage === 'qualified') return 'Qualified — prepare proposal';
  return null;
}

/** Overdue flag — true when next_touch_at has passed. */
export function isOverdue(l: Lead): boolean {
  const nextTouch = l.raw.next_touch_at;
  return !!nextTouch && new Date(nextTouch).getTime() < Date.now();
}