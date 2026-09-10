import 'server-only';
import { getAdminFirestore } from '../firebaseAdmin.ts';
import { deriveLocality } from './locality.ts';
import { buildUpsertDoc, computeDedupeKey, mergeSourcedLocationsPure, normalizeAddress, normalizeTriState } from './types.ts';
import type { AdminUser, SourcedLocationInput, SourcedParkingLocation, SourcingStatus } from './types.ts';

const COLLECTION = 'sourcedParkingLocations';
const getDb = getAdminFirestore;

// No delete function here — hard rule, sourced records are never removed.

/**
 * Firestore rejects an array directly containing another array as a document
 * field value — GeoJSON-shaped rawInput (LineString/Polygon coordinates,
 * e.g. Parkopedia's [[lng,lat],[lng,lat],...]) hits this constantly. Stored
 * as a JSON string instead, so any JSON-serializable rawInput shape survives
 * regardless of nesting, and parsed back out on every read.
 */
function parseStoredRawInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw; // pre-fix docs stored it as a native object
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Coerce legacy 'yes'/'no'/'unknown' strings on the tri-state fields — see normalizeTriState in types.ts. */
function normalizeTriStateFields<T extends SourcedParkingLocation>(doc: T): T {
  return {
    ...doc,
    access247: normalizeTriState(doc.access247) as T['access247'],
    fenced: normalizeTriState(doc.fenced) as T['fenced'],
    lit: normalizeTriState(doc.lit) as T['lit'],
  };
}

/**
 * Create-or-merge a sourced location from one source's snapshot. Never
 * overwrites blindly — see buildUpsertDoc in types.ts for the merge rules.
 */
export async function upsertSourcedLocation(input: SourcedLocationInput): Promise<SourcedParkingLocation> {
  const db = getDb();
  const normalizedAddress = input.normalizedAddress
    ?? (input.address ? normalizeAddress(input.address) : undefined);
  const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
  const ref = db.collection(COLLECTION).doc(id);

  const snap = await ref.get();
  const existingRaw = snap.exists ? (snap.data() as SourcedParkingLocation) : null;
  const existing = existingRaw
    ? normalizeTriStateFields({ ...existingRaw, rawInput: parseStoredRawInput(existingRaw.rawInput) })
    : null;
  const doc = buildUpsertDoc(existing, input, new Date().toISOString());

  // Locality on CREATE only — never overwrite an already-set locality on a
  // re-upsert/merge (same "compute once, don't silently overwrite" rule as
  // geoContext/enrichedAt). buildUpsertDoc never touches `locality` itself
  // (not a SOFT_FIELD), so on create it's always still unset here. Prefer
  // the caller's explicit locality (input.locality, e.g. the Hunt tracker's
  // already-selected locality) over deriving it; deriveLocality itself
  // prefers real lat/lng (nearest-center match) over address-text keyword
  // matching when both are available — see its own comment.
  if (!existing && !doc.locality) {
    const locality = input.locality ?? deriveLocality(doc.address, doc.lat, doc.lng);
    if (locality) doc.locality = locality;
  }

  await ref.set({ ...doc, rawInput: JSON.stringify(doc.rawInput) });
  return doc;
}

/**
 * Stamp the facility-detail enrichment marker directly, bypassing
 * buildUpsertDoc entirely — enrichedAt is a pipeline-stage bookkeeping
 * field, not scraped content, so it doesn't belong in the fill-empty/
 * conflict-log soft-field machinery (see SourcedParkingLocation.enrichedAt).
 */
export async function markSourcedLocationEnriched(id: string, enrichedAt: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ enrichedAt });
}

/**
 * Stamp computed geo context directly, bypassing buildUpsertDoc entirely —
 * geoContext is derived from external geo APIs, not scraped content, so it
 * doesn't belong in the fill-empty/conflict-log soft-field machinery (same
 * pattern as markSourcedLocationEnriched above; see
 * SourcedParkingLocation.geoContext and geoContext.ts).
 */
export async function setGeoContext(
  id: string,
  geoContext: NonNullable<SourcedParkingLocation['geoContext']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ geoContext });
}

/**
 * Stamp computed locality directly, bypassing buildUpsertDoc entirely — same
 * pattern as setGeoContext/markSourcedLocationEnriched above. Used by the
 * one-time backfill script for the ~214 pre-existing records that predate
 * the write-path auto-derive hook in upsertSourcedLocation.
 */
/**
 * Stamp computed EV / pitstop context directly, bypassing buildUpsertDoc
 * entirely — same pattern as setGeoContext above (see SourcedParkingLocation
 * .evContext / .pitstopContext). Written by scripts/enrich-ev-pitstop.ts.
 */
export async function setEvContext(
  id: string,
  evContext: NonNullable<SourcedParkingLocation['evContext']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ evContext });
}

export async function setPitstopContext(
  id: string,
  pitstopContext: NonNullable<SourcedParkingLocation['pitstopContext']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ pitstopContext });
}

export async function setAmenityContext(
  id: string,
  amenityContext: NonNullable<SourcedParkingLocation['amenityContext']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ amenityContext });
}

/**
 * Stamp derived service/resource tags directly, bypassing buildUpsertDoc
 * entirely — same pattern as setGeoContext above (pipeline-owned, not
 * scrape/merge machinery). Dot-path provenance merge so other fields'
 * provenance entries survive the update.
 */
export async function setDerivedServices(
  id: string,
  services: SourcedParkingLocation['services'],
  resources: SourcedParkingLocation['resources'],
  derivedAt: string,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    services,
    resources,
    derivedAt,
    'fieldProvenance.services': 'derived',
    'fieldProvenance.resources': 'derived',
  });
}

/**
 * Stamp computed demand-zone context via a dot-path update so existing
 * geoContext fields (floodZone, residentialAdjacent, checkedAt) are never
 * clobbered — same pipeline-owned discipline as setGeoContext above.
 */
export async function setDemandContext(
  id: string,
  demand: NonNullable<NonNullable<SourcedParkingLocation['geoContext']>['demand']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'geoContext.demand': demand });
}

export async function setLocality(id: string, locality: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ locality });
}

export async function getSourcedLocation(id: string): Promise<SourcedParkingLocation | null> {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const data = JSON.parse(JSON.stringify(snap.data())) as SourcedParkingLocation;
  return normalizeTriStateFields({ ...data, rawInput: parseStoredRawInput(data.rawInput) });
}

export async function listSourcedLocations(opts: {
  status?: SourcingStatus;
  limit?: number;
  includeMerged?: boolean;
} = {}): Promise<SourcedParkingLocation[]> {
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTION);
  if (opts.status) query = query.where('status', '==', opts.status);
  if (opts.limit) query = query.limit(opts.limit);
  const snap = await query.get();
  const docs = JSON.parse(JSON.stringify(snap.docs.map((d) => d.data()))) as SourcedParkingLocation[];
  const parsed = docs.map((d) => normalizeTriStateFields({ ...d, rawInput: parseStoredRawInput(d.rawInput) }));
  // ponytail: filtering merged-out docs in memory rather than a Firestore
  // `where('mergedInto', '==', null)` clause — fine at ~200 docs; add a real
  // index/query if this collection grows into the tens of thousands.
  return opts.includeMerged ? parsed : parsed.filter((d) => !d.mergedInto);
}

/**
 * Fold secondary's soft fields into primary (reusing buildUpsertDoc's
 * fill-empty/conflict-log rules via mergeSourcedLocationsPure), mark
 * secondary as merged, and write both atomically. Secondary is never
 * deleted or otherwise modified — see mergeSourcedLocationsPure in types.ts
 * for the exact field-level rules.
 */
export async function mergeSourcedLocations(
  primaryId: string,
  secondaryId: string,
  adminUser: AdminUser,
): Promise<SourcedParkingLocation> {
  if (primaryId === secondaryId) {
    throw new Error('mergeSourcedLocations: primaryId and secondaryId must differ');
  }
  const [primary, secondary] = await Promise.all([
    getSourcedLocation(primaryId),
    getSourcedLocation(secondaryId),
  ]);
  if (!primary) throw new Error(`mergeSourcedLocations: primary ${primaryId} not found`);
  if (!secondary) throw new Error(`mergeSourcedLocations: secondary ${secondaryId} not found`);

  const { mergedPrimary, markedSecondary } = mergeSourcedLocationsPure(
    primary,
    secondary,
    adminUser,
    new Date().toISOString(),
  );

  const db = getDb();
  const batch = db.batch();
  batch.set(db.collection(COLLECTION).doc(primaryId), {
    ...mergedPrimary,
    rawInput: JSON.stringify(mergedPrimary.rawInput),
  });
  batch.set(db.collection(COLLECTION).doc(secondaryId), {
    ...markedSecondary,
    rawInput: JSON.stringify(markedSecondary.rawInput),
  });
  await batch.commit();

  return mergedPrimary;
}
