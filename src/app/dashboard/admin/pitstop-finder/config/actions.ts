'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { FinderConfig, MetroCode } from '@/lib/types';

const getDb = getAdminFirestore;

// ===== Validation =====

function validateConfig(config: Omit<FinderConfig, 'createdAt' | 'updatedAt'>): string | null {
  // Weights validation
  const storageSum = config.storageWeights.proximity +
                     config.storageWeights.geometry +
                     config.storageWeights.capacity +
                     config.storageWeights.commercial +
                     (config.storageWeights.depot ?? 0);
  if (Math.abs(storageSum - 1.0) > 0.01) {
    return `Storage weights sum to ${storageSum.toFixed(2)}, must be 1.0`;
  }

  const stagingSum = config.stagingWeights.proximity +
                    config.stagingWeights.geometry +
                    config.stagingWeights.capacity +
                    config.stagingWeights.commercial;
  if (Math.abs(stagingSum - 1.0) > 0.01) {
    return `Staging weights sum to ${stagingSum.toFixed(2)}, must be 1.0`;
  }

  // Bbox validation
  if (config.bbox.south >= config.bbox.north) {
    return 'Bounding box: south must be less than north';
  }
  if (config.bbox.west >= config.bbox.east) {
    return 'Bounding box: west must be less than east';
  }

  // Anchors validation
  if (!config.anchors || config.anchors.length < 4) {
    return 'At least 4 anchors required';
  }

  for (const anchor of config.anchors) {
    if (!anchor.name || !anchor.kind) {
      return 'All anchors must have name and kind';
    }
  }

  // Thresholds validation
  if (config.walkListThreshold < 0 || config.walkListThreshold > 100) {
    return 'Walk-list threshold must be between 0 and 100';
  }
  if (config.residentialPenalty < 0 || config.residentialPenalty > 50) {
    return 'Residential penalty must be between 0 and 50';
  }
  if (config.residentialBuffer < 0 || config.residentialBuffer > 1000) {
    return 'Residential buffer must be between 0 and 1000 meters';
  }

  return null;
}

// ===== Save Config =====

export async function saveFinderConfig(
  metro: MetroCode,
  config: Omit<FinderConfig, 'createdAt' | 'updatedAt'>,
) {
  await requireAdmin();

  // Validate
  const error = validateConfig(config);
  if (error) {
    throw new Error(error);
  }

  const db = getDb();

  try {
    const existing = await db.collection('finderConfigs').doc(metro).get();

    const doc: Record<string, any> = {
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!existing.exists) {
      doc.createdAt = FieldValue.serverTimestamp();
    }

    await db.collection('finderConfigs').doc(metro).set(doc, { merge: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to save config: ${message}`);
  }
}

// ===== Delete Metro =====

export async function deleteMetro(metro: MetroCode, deleteFindings: boolean = false) {
  await requireAdmin();

  const db = getDb();

  try {
    // Delete config
    await db.collection('finderConfigs').doc(metro).delete();

    // Optionally delete all site findings for this metro
    if (deleteFindings) {
      const sites = await db.collection('siteFindings').where('metro', '==', metro).get();
      if (sites.size > 0) {
        const batch = db.batch();
        sites.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to delete metro: ${message}`);
  }
}
