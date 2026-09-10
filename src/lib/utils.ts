import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatDateTime(ts: { toDate(): Date } | Date | string | null | undefined): string {
  if (!ts) return '—';
  const date = ts instanceof Date ? ts : typeof ts === 'string' ? new Date(ts) : ts.toDate();
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(ts: { toDate(): Date } | Date | string | null | undefined): string {
  if (!ts) return '—';
  const date = ts instanceof Date ? ts : typeof ts === 'string' ? new Date(ts) : ts.toDate();
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}
