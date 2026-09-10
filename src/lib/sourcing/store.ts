import 'server-only';
import { getAdminFirestore } from '../firebaseAdmin.ts';
import { deriveLocality } from './locality.ts';
import { detectOperator, loadOperatorRegistry } from './operators.ts';
import { buildUpsertDoc, computeDedupeKey, mergeSourcedLocationsPure, normalizeAddress, normalizeTriState } from './types.ts';
import type { AdminUser, SourcedLocationInput, SourcedParkingLocation, SourcingStatus } from './types.ts';

const COLLECTION = 'parking_lots';
const getDb = getAdminFirestore;

// No delete function here — hard rule, sourced records are never removed.

function parseStoredRawInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeTriStateFields<T extends SourcedParkingLocation>(doc: T): T {
  return {
    ...doc,
    is_24_7: normalizeTriState(doc.is_24_7) as T['is_24_7'],
    is_fenced: normalizeTriState(doc.is_fenced) as T['is_fenced'],
    is_lit: normalizeTriState(doc.is_lit) as T['is_lit'],
  };
}

export async function upsertSourcedLocation(input: SourcedLocationInput): Promise<SourcedParkingLocation> {
  const db = getDb();
  const normalizedAddress = input.normalizedAddress
    ?? (input.address ? normalizeAddress(input.address) : undefined);
  const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
  const ref = db.collection(COLLECTION).doc(id);

  const snap = await ref.get();
  const existingRaw = snap.exists ? (snap.data() as SourcedParkingLocation) : null;
  const existing = existingRaw
    ? normalizeTriStateFields({ ...existingRaw, raw_input: parseStoredRawInput(existingRaw.raw_input) })
    : null;
  const doc = buildUpsertDoc(existing, input, new Date().toISOString());

  if (!existing && !doc.locality) {
    const locality = input.locality ?? deriveLocality(doc.address, doc.lat, doc.lng);
    if (locality) doc.locality = locality;
  }

  // Operator auto-detection on CREATE only — same "compute once, don't
  // silently overwrite" rule as locality. A manual override
  // (operator_source = 'manual') is never touched: detection only runs when
  // operator_id is still unset. Best-effort — a registry load failure skips
  // detection rather than failing the upsert.
  if (!existing && !doc.operator_id) {
    try {
      const registry = await loadOperatorRegistry();
      const detected = detectOperator(doc, registry);
      if (detected) {
        doc.operator_id = detected.operator_id;
        doc.operator_source = detected.operator_source;
      }
    } catch {
      // registry unavailable — skip detection, lot stays unidentified
    }
  }

  await ref.set({ ...doc, raw_input: JSON.stringify(doc.raw_input) });
  return doc;
}

export async function markSourcedLocationEnriched(id: string, enrichedAt: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ enriched_at: enrichedAt });
}

export async function setGeoContext(
  id: string,
  geoContext: NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['geo']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'enrichment.geo': geoContext });
}

export async function setEvContext(
  id: string,
  evContext: NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['ev']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'enrichment.ev': evContext });
}

export async function setPitstopContext(
  id: string,
  pitstopContext: NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['pitstop']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'enrichment.pitstop': pitstopContext });
}

export async function setAmenityContext(
  id: string,
  amenityContext: NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['amenities']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'enrichment.amenities': amenityContext });
}

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
    derived_at: derivedAt,
    'field_sources.services': 'derived',
    'field_sources.resources': 'derived',
  });
}

export async function setDemandContext(
  id: string,
  demand: NonNullable<NonNullable<NonNullable<SourcedParkingLocation['enrichment']>['geo']>['demand']>,
): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ 'enrichment.geo.demand': demand });
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
  return normalizeTriStateFields({ ...data, raw_input: parseStoredRawInput(data.raw_input) });
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
  const parsed = docs.map((d) => normalizeTriStateFields({ ...d, raw_input: parseStoredRawInput(d.raw_input) }));
  return opts.includeMerged ? parsed : parsed.filter((d) => !d.merged_into_lot_id);
}

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
    raw_input: JSON.stringify(mergedPrimary.raw_input),
  });
  batch.set(db.collection(COLLECTION).doc(secondaryId), {
    ...markedSecondary,
    raw_input: JSON.stringify(markedSecondary.raw_input),
  });
  await batch.commit();

  return mergedPrimary;
}