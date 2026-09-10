'use server';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { buildAddLocationInput, validateAddLocationInput } from '@/lib/sourcing/addLocation';
import type { AddLocationFormInput } from '@/lib/sourcing/addLocation';
import { missingChecklistCount } from '@/lib/sourcing/bdrView';
import { parsePastedFacilities } from '@/lib/sourcing/capture';
import { buildManualPasteImportInput } from '@/lib/sourcing/extensionCapture';
import type { ExtractedFacility, TaggedFacility } from '@/lib/sourcing/extensionCapture';
import { fetchAndParseSourceUrl } from '@/lib/sourcing/sourceUrlFetch';
import type { TaggedSourceLocation } from '@/lib/sourcing/sourceUrlFetch';
import type { SourceUrlKind } from '@/lib/sourcing/sourceUrlAdapter';
import { getSourcedLocation, mergeSourcedLocations as mergeSourcedLocationsInStore, upsertSourcedLocation } from '@/lib/sourcing/store';
import { getOutreachRecord, saveOutreachRecord, setOutreachState as setOutreachStateInStore } from '@/lib/sourcing/outreachStore';
import type { OutreachRecord, OutreachState } from '@/lib/sourcing/types';
import { computeDedupeKey, normalizeAddress } from '@/lib/sourcing/types';
import type { SourcedLocationInput, SourcedParkingLocation, SourcingStatus } from '@/lib/sourcing/types';

// Same collection sourcing/store.ts writes to — no delete function here either,
// same hard rule: sourced records are never removed, only edited or toggled.
const COLLECTION = 'parking_lots';

export type SourcedLocationEdits = Partial<
  Pick<
    SourcedParkingLocation,
    | 'name'
    | 'address'
    | 'priceText'
    | 'hoursText'
    | 'notes'
    | 'clearanceText'
    | 'access247'
    | 'fenced'
    | 'lit'
    | 'ingressEgress'
    | 'stallsTotal'
    | 'surfaceType'
    | 'lat'
    | 'lng'
    | 'claimedBy'
  >
>;

// Every field the edit form can write (notes handled separately — it's a
// free-text annotation, not a sourced fact, so it never gets provenance).
// Tri-state booleans: undefined = untouched in the form, true/false = source
// stated it, null = checked & couldn't tell — all three writes are human
// confirmations, so all stamp 'verified'.
const EDITABLE_PROVENANCE_FIELDS = [
  'name',
  'address',
  'priceText',
  'hoursText',
  'clearanceText',
  'access247',
  'fenced',
  'lit',
  'ingressEgress',
  'stallsTotal',
  'surfaceType',
  'lat',
  'lng',
] as const;

/**
 * Human correction to a draft/saved record. Writes directly to Firestore
 * rather than going through upsertSourcedLocation/buildUpsertDoc — that merge
 * path treats a changed value on an already-populated field as a *conflict*
 * (keeps the old value, just logs a note), which is correct for reconciling
 * two scraped sources disagreeing but wrong here: an admin's correction is
 * authoritative and must apply, not get parked in a conflict note. Dot-path
 * keys update only the touched fieldProvenance entries, leaving the rest of
 * the map (and any existing conflict notes) untouched.
 */
export async function updateSourcedLocation(
  id: string,
  edits: SourcedLocationEdits,
): Promise<SourcedParkingLocation> {
  await requireAdmin();
  const existing = await getSourcedLocation(id);
  if (!existing) throw new Error('Sourced location not found');

  const update: Record<string, unknown> = {
    capturedBy: 'admin',
    updatedAt: new Date().toISOString(),
  };
  for (const field of EDITABLE_PROVENANCE_FIELDS) {
    if (edits[field] === undefined) continue;
    update[field] = edits[field];
    update[`fieldProvenance.${field}`] = 'verified';
  }
  if (edits.notes !== undefined) update.notes = edits.notes;
  if (edits.claimedBy !== undefined) update.claimedBy = edits.claimedBy;

  // Same physical-impossibility rule buildUpsertDoc enforces (see
  // stripClearanceIfSurface in sourcing/types.ts) — surface + clearance can
  // never coexist. Rejected rather than silently nulled here because this is
  // a human correction: the admin should see the conflict and resolve it.
  const finalSurface = edits.surfaceType !== undefined ? edits.surfaceType : existing.surfaceType;
  const finalClearance = edits.clearanceText !== undefined ? edits.clearanceText : existing.clearanceText;
  if (finalSurface === 'surface' && finalClearance) {
    throw new Error('A surface lot cannot have a clearance — clear the clearance or set the surface type to structured.');
  }

  const db = getAdminFirestore();
  await db.collection(COLLECTION).doc(id).update(update);

  const refreshed = await getSourcedLocation(id);
  if (!refreshed) throw new Error('Sourced location vanished after update');
  return refreshed;
}

/** Draft <-> saved toggle. Saved = a human has reviewed the record. */
export async function setSourcingStatus(id: string, status: SourcingStatus): Promise<void> {
  await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(COLLECTION).doc(id).update({
    status,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Admin-approved cross-source merge: folds secondaryId's soft fields into
 * primaryId (see mergeSourcedLocationsPure in sourcing/types.ts for the
 * exact rules) and marks secondaryId as merged. Secondary is never deleted.
 */
export async function mergeSourcedLocations(primaryId: string, secondaryId: string): Promise<SourcedParkingLocation> {
  const adminUser = await requireAdmin();
  return mergeSourcedLocationsInStore(primaryId, secondaryId, adminUser);
}

export type AddLocationResult =
  | { ok: true; id: string; mergedExisting: boolean; saved: boolean }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Admin "+ Add Location" manual entry. Re-validates server-side (never
 * trust the client) via validateAddLocationInput, then goes through the
 * normal upsertSourcedLocation merge path — so a repeat submission of the
 * same name+address lands on the existing 'manual' doc instead of creating
 * a duplicate (see buildAddLocationInput in addLocation.ts for why the
 * sourceListingId slug is deterministic).
 *
 * mergedExisting can't be read off the returned doc after the fact — every
 * manual add uses the same 'manual' source, so buildUpsertDoc updates that
 * source's evidence entry in place on a repeat submission rather than
 * appending a second one, meaning evidence.length is 1 either way. The only
 * reliable signal is checking whether a doc already existed at the computed
 * id *before* calling upsertSourcedLocation.
 */
export async function addSourcedLocation(input: AddLocationFormInput): Promise<AddLocationResult> {
  await requireAdmin();

  const validation = validateAddLocationInput(input);
  if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };

  const locationInput = buildAddLocationInput(validation.value, input);
  const normalizedAddress = locationInput.normalizedAddress
    ?? (locationInput.address ? normalizeAddress(locationInput.address) : undefined);
  const id = computeDedupeKey({
    source: locationInput.source,
    sourceListingId: locationInput.sourceListingId,
    normalizedAddress,
  });

  const existing = await getSourcedLocation(id);
  const doc = await upsertSourcedLocation(locationInput);

  // A BDR typing every checklist field in by hand at add-time IS the human
  // verification the BDR queue's wizard exists to collect — so a fully-
  // filled manual add shouldn't need a second trip through that queue just
  // to click "Done". Scoped to this exact human-entry flow only: a scraped
  // record happening to have every raw field non-empty is not the same as a
  // human having verified it, so this never touches upsertSourcedLocation's
  // other callers (spothero.ts, parkopedia.ts, etc).
  if (doc.status === 'draft' && missingChecklistCount(doc) === 0) {
    await setSourcingStatus(doc.id, 'saved');
    doc.status = 'saved';
  }

  return { ok: true, id: doc.id, mergedExisting: existing !== null, saved: doc.status === 'saved' };
}

// Same http(s)-only rule addLocation.ts's validateAddLocationInput enforces
// for sourceUrl — provenance needs a real source page, not a blank/garbage
// string.
function validateSourceUrl(sourceUrl: string): string | null {
  const trimmed = sourceUrl?.trim() ?? '';
  if (!trimmed) return 'Source URL is required — where did this HTML come from?';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Source URL must be a valid http(s) URL.';
    }
  } catch {
    return 'Source URL must be a valid http(s) URL.';
  }
  return null;
}

export type ParsePastedHtmlResult =
  | { ok: true; results: TaggedFacility[] }
  | { ok: false; error: string };

/**
 * Admin "Paste HTML" panel — Parse step. Thin wrapper around capture.ts's
 * parsePastedFacilities: regex-based extraction (no LLM, no network call —
 * the admin already has the exact HTML in hand) plus the same dedupe-tag
 * step the browser extension's /api/sourcing/capture route runs, so both
 * capture surfaces land on identical NEW/EXISTS/DUPLICATE decisions.
 * sourceUrl isn't needed for extraction itself, but is still required
 * upfront (see validateSourceUrl) since provenance needs it on import.
 */
export async function parsePastedHtml(htmlOrText: string, sourceUrl: string): Promise<ParsePastedHtmlResult> {
  await requireAdmin();

  const urlError = validateSourceUrl(sourceUrl);
  if (urlError) return { ok: false, error: urlError };
  if (!htmlOrText?.trim()) return { ok: false, error: 'Paste some HTML or text first.' };

  try {
    const { results } = await parsePastedFacilities(htmlOrText);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Parse failed' };
  }
}

export type ImportPastedFacilitiesResult =
  | { ok: true; imported: number; merged: number; skipped: number }
  | { ok: false; error: string };

/**
 * Admin "Paste HTML" panel — Import selected step. Mirrors
 * addSourcedLocation's shape (validate, upsert via the normal merge path,
 * report counts the client renders) but loops the admin's checked rows from
 * the Parse step instead of a single hand-typed form. No new write path —
 * every row still goes through upsertSourcedLocation, same as every other
 * adapter (see buildManualPasteImportInput in extensionCapture.ts for the
 * source:'manual'/capturedBy:'admin' shape this builds).
 */
export async function importPastedFacilities(
  facilities: ExtractedFacility[],
  sourceUrl: string,
): Promise<ImportPastedFacilitiesResult> {
  await requireAdmin();

  const urlError = validateSourceUrl(sourceUrl);
  if (urlError) return { ok: false, error: urlError };
  const trimmedUrl = sourceUrl.trim();

  let imported = 0;
  let merged = 0;
  let skipped = 0;
  for (const facility of facilities) {
    const locationInput = buildManualPasteImportInput(facility, trimmedUrl);
    if (!locationInput) {
      skipped++;
      continue;
    }
    const normalizedAddress = locationInput.address ? normalizeAddress(locationInput.address) : undefined;
    const id = computeDedupeKey({
      source: locationInput.source,
      sourceListingId: locationInput.sourceListingId,
      normalizedAddress,
    });
    const existing = await getSourcedLocation(id);
    await upsertSourcedLocation(locationInput);
    if (existing) merged++;
    else imported++;
  }

  return { ok: true, imported, merged, skipped };
}

export type ParseSourceUrlResult =
  | { ok: true; kind: Exclude<SourceUrlKind, 'unknown'>; results: TaggedSourceLocation[] }
  | { ok: false; error: string };

/**
 * Admin "Paste URL" panel — Fetch step. Classifies the pasted URL
 * (sourceUrlAdapter.ts) and routes to the matching SpotHero/Parkopedia
 * fetch+parse+map flow (sourceUrlFetch.ts, reusing the existing adapters'
 * pure parse logic — nothing reimplemented here), then dedupe-tags the
 * results against Firestore. Real network fetch — unlike parsePastedHtml
 * above, which parses HTML the admin already pasted in.
 */
export async function parseSourceUrl(url: string): Promise<ParseSourceUrlResult> {
  await requireAdmin();

  const urlError = validateSourceUrl(url);
  if (urlError) return { ok: false, error: urlError };

  const result = await fetchAndParseSourceUrl(url.trim());
  if (result.kind === 'unknown') return { ok: false, error: result.error };
  return { ok: true, kind: result.kind, results: result.results };
}

export type ImportParsedSourceLocationsResult =
  | { ok: true; imported: number; merged: number; skipped: number }
  | { ok: false; error: string };

/**
 * Admin "Paste URL" panel — Import selected step. Same shape as
 * importPastedFacilities above (loop, upsert via the normal merge path,
 * report counts) but the inputs already arrive as real SourcedLocationInput
 * (source/sourceListingId/etc already set by the SpotHero/Parkopedia
 * mappers) rather than needing a buildManualPasteImportInput adaptation —
 * no new write path, every row still goes through upsertSourcedLocation.
 */
export async function importParsedSourceLocations(
  inputs: SourcedLocationInput[],
): Promise<ImportParsedSourceLocationsResult> {
  await requireAdmin();

  let imported = 0;
  let merged = 0;
  let skipped = 0;
  for (const input of inputs) {
    if (!input.sourceUrl?.trim()) {
      skipped++;
      continue;
    }
    const normalizedAddress = input.normalizedAddress
      ?? (input.address ? normalizeAddress(input.address) : undefined);
    let id: string;
    try {
      id = computeDedupeKey({
        source: input.source,
        sourceListingId: input.sourceListingId,
        normalizedAddress,
        address: input.address,
      });
    } catch {
      skipped++;
      continue;
    }
    const existing = await getSourcedLocation(id);
    await upsertSourcedLocation(input);
    if (existing) merged++;
    else imported++;
  }

  return { ok: true, imported, merged, skipped };
}

// ── Outreach actions ─────────────────────────────────────────────────────

export type OutreachInput = Omit<OutreachRecord, 'id' | 'lotId' | 'createdAt' | 'updatedAt'>;

export async function getOutreach(lotId: string): Promise<OutreachRecord | null> {
  await requireAdmin();
  return getOutreachRecord(lotId);
}

export async function getOutreachBatch(lotIds: string[]): Promise<Record<string, OutreachRecord>> {
  await requireAdmin();
  if (lotIds.length === 0) return {};
  const db = getAdminFirestore();
  // ponytail: collection group query — one read instead of N. Firestore
  // doesn't support IN on collection group IDs, so we fetch all outreach
  // docs and filter client-side. At current scale (~1500 lots, ~100 with
  // outreach records) this is one query returning ~100 small docs.
  const snap = await db.collectionGroup('outreach').get();
  const idSet = new Set(lotIds);
  const map: Record<string, OutreachRecord> = {};
  for (const doc of snap.docs) {
    // doc.ref.parent.parent = the lot doc — its id is the lotId
    const lotId = doc.ref.parent?.parent?.id;
    if (lotId && idSet.has(lotId)) {
      map[lotId] = doc.data() as OutreachRecord;
    }
  }
  return map;
}

export async function saveOutreach(lotId: string, data: OutreachInput): Promise<OutreachRecord> {
  await requireAdmin();
  return saveOutreachRecord(lotId, data);
}

export async function advanceOutreachState(lotId: string, state: OutreachState): Promise<OutreachRecord> {
  await requireAdmin();
  const result = await setOutreachStateInStore(lotId, state);
  if (!result) throw new Error('Outreach record not found');
  return result;
}

export async function exportOutreachCsv(): Promise<string> {
  await requireAdmin();
  const db = getAdminFirestore();
  const lotsSnap = await db.collection('parking_lots').get();

  const headers = [
    'lot_name', 'address', 'locality', 'source',
    'contact_name', 'contact_role', 'contact_email', 'contact_phone',
    'inquiry_sent', 'call_made', 'form_submitted',
    'outreach_state', 'response_date', 'quote_source', 'bdr_owner',
    'offer_spaces', 'offer_price', 'offer_start',
  ];

  const rows: string[][] = [];
  for (const lotDoc of lotsSnap.docs) {
    const lot = lotDoc.data() as SourcedParkingLocation;
    if (lot.mergedInto) continue;
    const outreachSnap = await db
      .collection('parking_lots')
      .doc(lotDoc.id)
      .collection('outreach')
      .limit(1)
      .get();
    if (outreachSnap.empty) continue;
    const o = outreachSnap.docs[0].data() as OutreachRecord;
    rows.push([
      lot.name, lot.address ?? '', lot.locality ?? '', lot.source,
      o.contactName, o.contactRole, o.contactEmail, o.contactPhone,
      String(o.inquirySent), String(o.callMade), String(o.formSubmitted),
      o.outreachState, o.responseDate ?? '', o.quoteSource, o.bdrOwner,
      String(o.offerSpaces ?? ''), o.offerPrice, o.offerStart,
    ]);
  }

  const escape = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
