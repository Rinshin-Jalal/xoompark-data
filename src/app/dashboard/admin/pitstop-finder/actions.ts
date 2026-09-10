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

async function persistSiteFindings(db: FirebaseFirestore.Firestore, metro: MetroCode, sites: any[]) {
  const refs = sites.map((site) =>
    db.collection('siteFindings').doc(`${metro}_${site.osmId.replace('/', '_')}`)
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
        metro,
        osmId: site.osmId,
        lat: site.lat,
        lon: site.lon,
        capacitySource: site.capacitySource,
        areaSqm: site.areaSqm,

        // Scored data (always refresh)
        storageScore: site.storageScore,
        stagingScore: site.stagingScore,
        nearestAnchor: site.nearestAnchor,
        anchorMi: site.anchorMi,
        depotMi: site.depotMi ?? undefined,
        residentialFlag: site.residentialFlag,
        resDistanceM: site.resDistanceM,
        ownerDirectCandidate: site.ownerDirectCandidate,
        access: site.access,
        fee: site.fee || undefined,
        walkList: site.walkList,
        closedAtNight: site.closedAtNight ?? false,

        // Editable dossier fields — an existing manual correction always wins
        // over the freshly-scraped/enriched value from this run.
        name: existing?.name ?? site.name,
        type: existing?.type ?? site.type,
        capacity: existing?.capacity ?? site.capacity,
        address: existing?.address ?? site.address ?? undefined,
        owner: existing?.owner ?? site.owner ?? undefined,
        ownerMailing: existing?.ownerMailing ?? site.ownerMailing ?? undefined,
        parcelId: existing?.parcelId ?? site.parcelId ?? undefined,
        landUse: existing?.landUse ?? site.landUse ?? undefined,
        zoning: existing?.zoning ?? site.zoning ?? undefined,
        openingHours: existing?.openingHours ?? site.openingHours ?? undefined,

        // Timestamps
        lastScoredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),

        // Preserve manual fields from existing doc
        status: (existing?.status ?? 'new') as SiteFindingStatus,
        capacityActual: existing?.capacityActual,
        clearanceHeight: existing?.clearanceHeight,
        powerAvailable: existing?.powerAvailable,
        notesInternal: existing?.notesInternal,
        photos: existing?.photos,

        // Create timestamp (only on new docs)
        createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

// Saves whatever's already on screen — no live re-query. This is the fast
// path for "persist these results" (the per-row Save button); refreshFinderResults
// below is the slow path that re-runs the finder against live data first.
export async function saveFinderResults(metro: MetroCode, sites: any[]) {
  await requireAdmin();
  const db = getDb();

  try {
    await persistSiteFindings(db, metro, sites);
  } catch (error) {
    console.error(`[pitstop-finder] save failed for ${metro}:`, error);
    throw new Error(`Failed to save finder results for ${metro}`);
  }

  revalidatePath('/dashboard/admin/pitstop-finder');
}

export async function refreshFinderResults(metro: MetroCode) {
  await requireAdmin();
  const db = getDb();

  try {
    // Load config from Firestore or use default
    let config: FinderConfig | undefined;
    try {
      const doc = await db.collection('finderConfigs').doc(metro).get();
      if (doc.exists) {
        config = doc.data() as FinderConfig;
      }
    } catch {
      // Firestore unavailable; fall back to hardcoded defaults
    }

    if (!config) {
      const defaultConfig = DEFAULT_FINDER_CONFIGS[metro];
      config = {
        ...defaultConfig,
        createdAt: undefined as any,
        updatedAt: undefined as any,
      };
    }

    // Run finder with the config
    const scored = await runFinder(metro, config);

    // Enrich with owner/hours data
    const enriched = await enrichSites(scored, metro);

    await persistSiteFindings(db, metro, enriched);
  } catch (error) {
    console.error(`[pitstop-finder] refresh failed for ${metro}:`, error);
    throw new Error(`Failed to refresh finder results for ${metro}`);
  }

  revalidatePath('/dashboard/admin/pitstop-finder');
}

// ===== Site Status & Manual Fields =====

export async function updateSiteStatus(siteId: string, newStatus: SiteFindingStatus) {
  await requireAdmin();
  const db = getDb();
  await db.collection('siteFindings').doc(siteId).update({
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateSiteManualFields(
  siteId: string,
  fields: {
    name?: string | null;
    type?: string | null;
    capacity?: number | null;
    capacityActual?: number | null;
    clearanceHeight?: string | null;
    powerAvailable?: boolean | null;
    notesInternal?: string | null;
    photos?: string[] | null;
    address?: string | null;
    owner?: string | null;
    ownerMailing?: string | null;
    landUse?: string | null;
    parcelId?: string | null;
    zoning?: string | null;
    openingHours?: string | null;
  },
) {
  await requireAdmin();
  const db = getDb();

  const updateData: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      updateData[key] = FieldValue.delete();
    } else if (value !== undefined) {
      updateData[key] = value;
    }
  }

  await db.collection('siteFindings').doc(siteId).update(updateData);
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
  const siteDoc = await db.collection('siteFindings').doc(siteId).get();
  if (!siteDoc.exists) {
    throw new Error(`Site not found: ${siteId}`);
  }

  const site = siteDoc.data() as SiteFinding;

  // Create prospect record
  const prospectRef = db.collection('bdProspects').doc();
  await prospectRef.set({
    side: 'provider',
    stage: 'INITIAL',
    companyName: companyName || site.owner || 'Unknown',
    contactName,
    contactEmail,
    contactPhone: contactPhone || '',
    source: 'OUTBOUND',
    description: `Pit Stop Finder discovery: ${site.name} (${site.metro}). ${site.storageScore}/${site.stagingScore} scores.`,
    tags: ['pitstop-finder', site.metro],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update site status
  await updateSiteStatus(siteId, 'contacted');
}

// ===== Config Management =====

export async function saveFinderConfig(metro: MetroCode, config: Omit<FinderConfig, 'createdAt' | 'updatedAt'>) {
  await requireAdmin();
  const db = getDb();

  const existing = await db.collection('finderConfigs').doc(metro).get();

  const doc: Record<string, any> = {
    ...config,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!existing.exists) {
    doc.createdAt = FieldValue.serverTimestamp();
  }

  await db.collection('finderConfigs').doc(metro).set(doc, { merge: true });
}

export async function deleteMetro(metro: MetroCode) {
  await requireAdmin();
  const db = getDb();

  // Delete config
  await db.collection('finderConfigs').doc(metro).delete();

  // Optionally delete all site findings for this metro
  const sites = await db.collection('siteFindings').where('metro', '==', metro).get();
  const batch = db.batch();
  sites.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
