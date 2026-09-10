// Pure parse/map layer for Greg's "Master Location Listing (July 2026)" PDF
// (104 owned/managed/leased lots, shared via Slack). Same split as the other
// adapters: this file is Firestore- and network-free so it unit-tests with
// plain `node --experimental-strip-types`; the CLI runner that writes lives in
// src/app/dashboard/admin/parking-sourcing/scripts/ingest-greg-master.ts.
import type { FieldProvenanceValue, SourcedLocationInput, SurfaceType } from './types.ts';
import { normalizeAddress } from './types.ts';

export const GREG_MASTER_SOURCE = 'greg-master-listing-july-2026';
// No public URL exists — the PDF came via Greg's Slack message. The evidence
// trail needs a stable locator, so a slack: URI naming the exact artifact.
export const GREG_MASTER_SOURCE_URL = 'slack://greg/master-location-listing-july-2026.pdf';

export interface GregMasterRow {
  loc: string; // PDF's own location code, e.g. 'CH410' — used as sourceListingId
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  oml?: 'O' | 'M' | 'L'; // Owned / Managed / Leased
  mgr?: string; // operating manager, e.g. 'SP+', 'ProPark' — no schema field, lives in rawInput
}

/**
 * City fixes for rows whose City column is blank in the PDF itself. The PDF's
 * own footer prefix key states these (RM = Remote Monitoring Center/Chicago),
 * so this is source-stated, not guessed. State-column typos elsewhere (CL
 * says IL, SL says MI) are left as-is — state isn't a schema field and the
 * zip disambiguates geocoding.
 */
const PREFIX_CITY_FIX: Record<string, { city: string; state: string }> = {
  RM: { city: 'Chicago', state: 'IL' },
};

const LOC_RE = /^[A-Z]{2}\d{3}$/;
const STATE_RE = /^[A-Z]{2}$|^Washington DC$/; // DC122's state column says "Washington DC" verbatim
const ZIP_RE = /^\d{5}$/;

/**
 * Parse the `pdftotext -layout` extraction of the PDF. Rows are lines
 * starting with a location code; columns are separated by 2+ spaces (both
 * PDF pages keep that invariant, only the column widths differ).
 */
export function parseGregMasterListing(text: string): { rows: GregMasterRow[]; errors: string[] } {
  const rows: GregMasterRow[] = [];
  const errors: string[] = [];

  for (const line of text.split('\n')) {
    if (!LOC_RE.test(line.slice(0, 5)) || !/\s{2,}/.test(line.slice(5, 7))) continue;
    const parts = line.trim().split(/\s{2,}/);
    const [loc, name, address, ...rest] = parts;
    if (!name || !address) {
      errors.push(`${loc}: missing name or address`);
      continue;
    }

    let city: string;
    let state: string;
    let zip: string;
    let tail: string[];

    if (STATE_RE.test(rest[0] ?? '') && ZIP_RE.test(rest[1] ?? '')) {
      // City column blank (RM001) — apply the PDF's own prefix-key fix.
      const fix = PREFIX_CITY_FIX[loc.slice(0, 2)];
      if (!fix) {
        errors.push(`${loc}: blank city and no prefix-key fix`);
        continue;
      }
      city = fix.city;
      state = fix.state;
      zip = rest[1];
      tail = rest.slice(2);
    } else {
      [city, state, zip, ...tail] = rest as string[];
      if (!STATE_RE.test(state ?? '') || !ZIP_RE.test(zip ?? '')) {
        errors.push(`${loc}: unexpected column shape: ${JSON.stringify(rest)}`);
        continue;
      }
    }

    let oml: GregMasterRow['oml'];
    const first = tail[0];
    if (first === 'O' || first === 'M' || first === 'L') { oml = first; tail.shift(); }
    const mgr = tail.length ? tail.join(' ') : undefined;

    rows.push({ loc, name, address, city, state, zip, oml, mgr });
  }

  return { rows, errors };
}

/**
 * Surface vs garage, only when the name states it outright — "X Garage" or
 * "X Lot". Mixed ("Lot & Garage") or neither stays undefined; never guessed.
 */
export function surfaceTypeFromName(name: string): SurfaceType | undefined {
  const garage = /garage/i.test(name);
  const lot = /\blot\b/i.test(name);
  if (garage && !lot) return 'structured';
  if (lot && !garage) return 'surface';
  return undefined;
}

/**
 * Geocode query overrides for rows whose PDF address text Nominatim can't
 * resolve (parentheticals, slashed double-addresses, abbreviations). Each
 * uses the PDF's own alternate address from the parenthetical, or the
 * spelled-out street form — never a different lot.
 */
const GEOCODE_QUERY_OVERRIDES: Record<string, string[]> = {
  AP005: ['4000 Global Gateway Connector, College Park, GA 30337'],
  CH379: ['325 W Wolf Point Plaza, Chicago, IL 60654', '350 N Orleans St, Chicago, IL 60654'],
  CH380: ['325 W Wolf Point Plaza, Chicago, IL 60654', '350 N Orleans St, Chicago, IL 60654'],
  CH616: ['328 S Franklin St, Chicago, IL 60606'],
  CH618: ['301 W Lake St, Chicago, IL 60606'],
  PH010: ['107 S 10th St, Philadelphia, PA 19107'],
  PH025: ['1599 JFK Blvd, Philadelphia, PA 19102'],
  RM001: ['81 West Lake Street, Chicago, IL', '81 W Lake St, Chicago, IL 60601'],
  SL002: ['215 S 8th St, St. Louis, MO 63102'],
};

/** Geocode query candidates, best first — zip disambiguates state typos. */
export function geocodeQueries(row: GregMasterRow): string[] {
  const override = GEOCODE_QUERY_OVERRIDES[row.loc];
  if (override) return override;
  const q = [`${row.address}, ${row.zip}`];
  const withCity = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
  if (withCity !== q[0]) q.push(withCity);
  return q;
}

/**
 * Map one row onto the sourcing schema. Capacity doesn't exist in the PDF
 * (never guessed); operator (Mgr) and O/M/L have no schema field and ride
 * in rawInput. Every filled field is 'self-reported' — Greg's list, not
 * verified (same rule as every other scraped source).
 */
export function rowToInput(row: GregMasterRow, lat?: number, lng?: number): SourcedLocationInput {
  const surfaceType = surfaceTypeFromName(row.name);
  const fieldProvenance: Record<string, FieldProvenanceValue> = {
    name: 'self-reported',
    address: 'self-reported',
  };
  if (surfaceType) fieldProvenance.surfaceType = 'self-reported';
  if (lat !== undefined && lng !== undefined) {
    fieldProvenance.lat = 'self-reported';
    fieldProvenance.lng = 'self-reported';
  }
  return {
    name: row.name,
    address: row.address,
    normalizedAddress: normalizeAddress(row.address),
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    source: GREG_MASTER_SOURCE,
    sourceUrl: GREG_MASTER_SOURCE_URL,
    sourceListingId: row.loc,
    ...(surfaceType ? { surfaceType } : {}),
    fieldProvenance,
    capturedBy: 'scraped',
    rawInput: row,
  };
}
