/**
 * Garage clearance — our own data layer.
 *
 * AFDC does not return clearance height and OSM tags it on almost nothing, so
 * this is entered and maintained by us. Three rules, all load-bearing:
 *
 *   1. One unit, integer inches, no free text. A column holding 6'8", 80in and
 *      2.03m breaks silently six months in.
 *   2. Provenance is part of the datum. Clearance changes with resurfacing, new
 *      signage, retrofitted sprinklers — a number with no measurer and no date
 *      is not evidence.
 *   3. Unknown must never read as passable. The failure mode is a high-roof van
 *      into a concrete beam, so absent/unparseable data returns 'unverified',
 *      never 'fits'.
 *
 * No `import 'server-only'` here: this module is pure and clearance.test.ts
 * runs it under plain `node --test`.
 */

import type { Clearance, ClearanceFit, ClearanceStatus } from '@/lib/types';

export function clearanceFit(
  clearance: Clearance | undefined | null,
  requiredInches: number,
): ClearanceFit {
  if (!clearance || !Number.isFinite(clearance.inches) || clearance.inches <= 0) return 'unverified';
  // A height with no provenance is a rumour. Migrated free-text values land here.
  if (clearance.status === 'unknown') return 'unverified';
  return clearance.inches >= requiredInches ? 'fits' : 'too-low';
}

export function formatClearance(clearance: Clearance | undefined | null): string {
  if (!clearance) return 'unknown';
  const feet = Math.floor(clearance.inches / 12);
  const inches = clearance.inches % 12;
  return `${feet}'${inches}" (${clearance.status})`;
}

export interface ClearanceImportRow {
  afdcId: number;
  inches: number;
  status: ClearanceStatus;
  measuredBy?: string;
  measuredAt?: string;
}

export interface ClearanceImportError {
  line: number;
  raw: string;
  reason: string;
}

const VALID_STATUSES: ClearanceStatus[] = ['measured', 'signposted', 'unknown'];

/**
 * Bulk clearance source — a survey CSV, not manual per-row entry.
 * Columns: afdcId,inches,status,measuredBy,measuredAt (last two optional).
 * A header row is detected and skipped automatically (first column non-numeric).
 *
 * Same "one unit, integer inches, no free text" rule as manual entry — inches
 * is a plain integer column, not a parsed height string, so there's no
 * feet/metres/centimetres ambiguity to get wrong on a few hundred rows at once.
 * A row that fails validation is reported, not silently dropped or coerced.
 */
export function parseClearanceCsv(text: string): { rows: ClearanceImportRow[]; errors: ClearanceImportError[] } {
  const rows: ClearanceImportRow[] = [];
  const errors: ClearanceImportError[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  lines.forEach((line, i) => {
    const [afdcIdRaw, inchesRaw, statusRaw, measuredBy, measuredAt] = line.split(',').map((c) => c.trim());

    if (i === 0 && !Number.isFinite(Number(afdcIdRaw))) return; // header row

    const afdcId = Number(afdcIdRaw);
    const inches = Number(inchesRaw);
    const status = statusRaw as ClearanceStatus;

    if (!Number.isFinite(afdcId) || afdcId <= 0) {
      errors.push({ line: i + 1, raw: line, reason: 'afdcId must be a positive number' });
      return;
    }
    if (!Number.isInteger(inches) || inches <= 0) {
      errors.push({ line: i + 1, raw: line, reason: 'inches must be a positive integer' });
      return;
    }
    if (!VALID_STATUSES.includes(status)) {
      errors.push({ line: i + 1, raw: line, reason: `status must be one of ${VALID_STATUSES.join('/')}` });
      return;
    }

    rows.push({ afdcId, inches, status, measuredBy: measuredBy || undefined, measuredAt: measuredAt || undefined });
  });

  return { rows, errors };
}
