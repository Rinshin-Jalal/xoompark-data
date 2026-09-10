import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function generateLocator(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'XP-';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
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
