'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { FinderConfig, MetroCode, SiteFinding, SiteFindingStatus } from '@/lib/types';
import { runFinder } from './lib/finder';
import { enrichSites } from './lib/enrichment';
import { DEFAULT_FINDER_CONFIGS } from './lib/config';

const getDb = getAdminFirestore;

// ===== Refresh Finder Results =====

// Firestore write batches cap at 500 operations - metros this size (SF alone
// scores 1300+ sites) blow past that in one batch.commit(), so chunk it.
const BATCH_CHUNK_SIZE = 450;

async function persistSiteFindings(db: FirebaseFirestore.Firestore, metro_id: MetroCode, sites: any[]) {
  const refs = sites.map((site) =>
    db.collection('pitstop_findings').doc(`${metro_id}_${site.osm_id.replace('/', '_')}`)
  );

  // Sequential per-doc reads for 1000+ sites is the slow part users actually
  // feel - read them all in parallel instead.
  const existingDocs = await Promise.all(refs.map((ref) => ref.get()));

  for (let i = 0; i < sites.length; i += BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (let j = i; j < Math.min(i + BATCH_CHUNK_SIZE, sites.length); j++) {
      const site = sites[j];
      const doc = existingDocs[j];
      const existing = doc.exists ? (doc.data() as SiteFinding) : undefined;

      batch.set(refs[j], {
        id: refs[j].id,
        metro_id,
        osm_id: site.osm_id,
        lat: site.lat,
        lng: site.lng,
        capacity_source: site.capacity_source,
        area_sqm: site.area_sqm,

        // Scored data (always refresh)
        storage_score: site.storage_score,
        staging_score: site.staging_score,
        nearest_anchor_name: site.nearest_anchor_name,
        distance_to_anchor_miles: site.distance_to_anchor_miles,
        distance_to_depot_miles: site.distance_to_depot_miles ?? undefined,
        residential_flag: site.residential_flag,
        distance_to_res_meters: site.distance_to_res_meters,
        is_owner_direct_candidate: site.is_owner_direct_candidate,
        access: site.access,
        fee: site.fee || undefined,
        is_walk_list_ready: site.is_walk_list_ready,
        is_closed_at_night: site.is_closed_at_night ?? false,

        // Editable dossier fields — an existing manual correction always wins
        // over the freshly-scraped/enriched value from this run.
        name: existing?.name ?? site.name,
        type: existing?.facility_type ?? site.facility_type,
        capacity: existing?.stall_count ?? site.stall_count,
        address: existing?.address ?? site.address ?? undefined,
        owner: existing?.owner_name ?? site.owner_name ?? undefined,
        owner_mailing_address: existing?.owner_mailing_address ?? site.owner_mailing_address ?? undefined,
        parcel_id: existing?.parcel_id ?? site.parcel_id ?? undefined,
        land_use_code: existing?.land_use_code ?? site.land_use_code ?? undefined,
        zoning_code: existing?.zoning_code ?? site.zoning_code ?? undefined,
        opening_hours: existing?.opening_hours ?? site.opening_hours ?? undefined,

        // Timestamps
        last_scored_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),

        // Preserve manual fields from existing doc
        status: (existing?.status ?? 'new') as SiteFindingStatus,
        stall_count_actual: existing?.stall_count_actual,
        clearance_height_inches: existing?.clearance_height_inches,
        has_power_available: existing?.has_power_available,
        internal_notes: existing?.internal_notes,
        photos: existing?.photos,

        // Create timestamp (only on new docs)
        created_at: existing?.created_at ?? FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

// Saves whatever's already on screen — no live re-query. This is the fast
// path for "persist these results" (the per-row Save button); refreshFinderResults
// below is the slow path that re-runs the finder against live data first.
export async function saveFinderResults(metro_id: MetroCode, sites: any[]) {
  await requireAdmin();
  const db = getDb();

  try {
    await persistSiteFindings(db, metro_id, sites);
  } catch (error) {
    console.error(`[pitstop-finder] save failed for ${metro_id}:`, error);
    throw new Error(`Failed to save finder results for ${metro_id}`);
  }

  revalidatePath('/dashboard/admin/pitstop-finder');
}

export async function refreshFinderResults(metro_id: MetroCode) {
  await requireAdmin();
  const db = getDb();

  try {
    // Load config from Firestore or use default
    let config: FinderConfig | undefined;
    try {
      const doc = await db.collection('pitstop_configs').doc(metro_id).get();
      if (doc.exists) {
        config = doc.data() as FinderConfig;
      }
    } catch {
      // Firestore unavailable; fall back to hardcoded defaults
    }

    if (!config) {
      const defaultConfig = DEFAULT_FINDER_CONFIGS[metro_id];
      config = {
        ...defaultConfig,
        created_at: undefined as any,
        updated_at: undefined as any,
      };
    }

    // Run finder with the config
    const scored = await runFinder(metro_id, config);

    // Enrich with owner/hours data
    const enriched = await enrichSites(scored, metro_id);

    await persistSiteFindings(db, metro_id, enriched);
  } catch (error) {
    console.error(`[pitstop-finder] refresh failed for ${metro_id}:`, error);
    throw new Error(`Failed to refresh finder results for ${metro_id}`);
  }

  revalidatePath('/dashboard/admin/pitstop-finder');
}

// ===== Site Status & Manual Fields =====

export async function updateSiteStatus(siteId: string, newStatus: SiteFindingStatus) {
  await requireAdmin();
  const db = getDb();
  await db.collection('pitstop_findings').doc(siteId).update({
    status: newStatus,
    updated_at: FieldValue.serverTimestamp(),
  });
}

export async function updateSiteManualFields(
  siteId: string,
  fields: {
    name?: string | null;
    type?: string | null;
    capacity?: number | null;
    stall_count_actual?: number | null;
    clearance_height_inches?: string | null;
    has_power_available?: boolean | null;
    internal_notes?: string | null;
    photos?: string[] | null;
    address?: string | null;
    owner?: string | null;
    owner_mailing_address?: string | null;
    land_use_code?: string | null;
    parcel_id?: string | null;
    zoning_code?: string | null;
    opening_hours?: string | null;
  },
) {
  await requireAdmin();
  const db = getDb();

  const updateData: Record<string, any> = { updated_at: FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      updateData[key] = FieldValue.delete();
    } else if (value !== undefined) {
      updateData[key] = value;
    }
  }

  await db.collection('pitstop_findings').doc(siteId).update(updateData);
}

// ===== Promote to Prospect =====

export async function promoteSiteToProspect(
  siteId: string,
  companyName: string,
  contactName: string,
  contactEmail: string,
  contactPhone?: string,
) {
  await requireAdmin();
  const db = getDb();

  // Fetch the site to get owner info
  const siteDoc = await db.collection('pitstop_findings').doc(siteId).get();
  if (!siteDoc.exists) {
    throw new Error(`Site not found: ${siteId}`);
  }

  const site = siteDoc.data() as SiteFinding;

  // Create prospect record
  const prospectRef = db.collection('prospects').doc();
  await prospectRef.set({
    side: 'provider',
    stage: 'INITIAL',
    companyName: companyName || site.owner_name || 'Unknown',
    contactName,
    contactEmail,
    contactPhone: contactPhone || '',
    source: 'OUTBOUND',
    description: `Pit Stop Finder discovery: ${site.name} (${site.metro_id}). ${site.storage_score}/${site.staging_score} scores.`,
    tags: ['pitstop-finder', site.metro_id],
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  // Update site status
  await updateSiteStatus(siteId, 'contacted');
}

// ===== Config Management =====

export async function saveFinderConfig(metro_id: MetroCode, config: Omit<FinderConfig, 'created_at' | 'updated_at'>) {
  await requireAdmin();
  const db = getDb();

  const existing = await db.collection('pitstop_configs').doc(metro_id).get();

  const doc: Record<string, any> = {
    ...config,
    updated_at: FieldValue.serverTimestamp(),
  };

  if (!existing.exists) {
    doc.created_at = FieldValue.serverTimestamp();
  }

  await db.collection('pitstop_configs').doc(metro_id).set(doc, { merge: true });
}

export async function deleteMetro(metro_id: MetroCode) {
  await requireAdmin();
  const db = getDb();

  // Delete config
  await db.collection('pitstop_configs').doc(metro_id).delete();

  // Optionally delete all site findings for this metro_id
  const sites = await db.collection('pitstop_findings').where('metro_id', '==', metro_id).get();
  const batch = db.batch();
  sites.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
