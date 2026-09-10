'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { FinderConfig, MetroCode } from '@/lib/types';

const getDb = getAdminFirestore;

// ===== Validation =====

function validateConfig(config: Omit<FinderConfig, 'created_at' | 'updated_at'>): string | null {
  // Weights validation
  const storageSum = config.storage_weights.proximity +
                     config.storage_weights.geometry +
                     config.storage_weights.capacity +
                     config.storage_weights.commercial +
                     (config.storage_weights.depot ?? 0);
  if (Math.abs(storageSum - 1.0) > 0.01) {
    return `Storage weights sum to ${storageSum.toFixed(2)}, must be 1.0`;
  }

  const stagingSum = config.staging_weights.proximity +
                    config.staging_weights.geometry +
                    config.staging_weights.capacity +
                    config.staging_weights.commercial;
  if (Math.abs(stagingSum - 1.0) > 0.01) {
    return `Staging weights sum to ${stagingSum.toFixed(2)}, must be 1.0`;
  }

  // Bbox validation
  if (config.bounding_box.south >= config.bounding_box.north) {
    return 'Bounding box: south must be less than north';
  }
  if (config.bounding_box.west >= config.bounding_box.east) {
    return 'Bounding box: west must be less than east';
  }

  // Anchors validation
  if (!config.anchor_locations || config.anchor_locations.length < 4) {
    return 'At least 4 anchor_locations required';
  }

  for (const anchor of config.anchor_locations) {
    if (!anchor.name || !anchor.kind) {
      return 'All anchor_locations must have name and kind';
    }
  }

  // Thresholds validation
  if (config.walk_list_min_score < 0 || config.walk_list_min_score > 100) {
    return 'Walk-list threshold must be between 0 and 100';
  }
  if (config.residential_penalty_points < 0 || config.residential_penalty_points > 50) {
    return 'Residential penalty must be between 0 and 50';
  }
  if (config.residential_buffer_meters < 0 || config.residential_buffer_meters > 1000) {
    return 'Residential buffer must be between 0 and 1000 meters';
  }

  return null;
}

// ===== Save Config =====

export async function saveFinderConfig(
  metro_id: MetroCode,
  config: Omit<FinderConfig, 'created_at' | 'updated_at'>,
) {
  await requireAdmin();

  // Validate
  const error = validateConfig(config);
  if (error) {
    throw new Error(error);
  }

  const db = getDb();

  try {
    const existing = await db.collection('pitstop_configs').doc(metro_id).get();

    const doc: Record<string, any> = {
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
      doc.createdAt = FieldValue.serverTimestamp();
    }

    await db.collection('pitstop_configs').doc(metro_id).set(doc, { merge: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to save config: ${message}`);
  }
}

// ===== Delete Metro =====

export async function deleteMetro(metro_id: MetroCode, deleteFindings: boolean = false) {
  await requireAdmin();

  const db = getDb();

  try {
    // Delete config
    await db.collection('pitstop_configs').doc(metro_id).delete();

    // Optionally delete all site findings for this metro_id
    if (deleteFindings) {
      const sites = await db.collection('pitstop_findings').where('metro_id', '==', metro_id).get();
      if (sites.size > 0) {
        const batch = db.batch();
        sites.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to delete metro_id: ${message}`);
  }
}
