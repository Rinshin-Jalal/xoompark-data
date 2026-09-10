import type { OfferingRate } from './types';

export function computeTimeCost(
  quantityMinutes: number,
  rate: Pick<OfferingRate, 'perMinute' | 'perHour' | 'freeMinutes' | 'minCharge' | 'maxCharge'>,
): number {
  const perMin = rate.perMinute ?? (rate.perHour != null ? Math.ceil(rate.perHour / 60) : 0);
  const billable = Math.max(0, quantityMinutes - rate.freeMinutes);
  const raw = billable * perMin;
  const clamped = Math.max(raw, rate.minCharge);
  const result = rate.maxCharge != null ? Math.min(clamped, rate.maxCharge) : clamped;
  return Math.round(result);
}
