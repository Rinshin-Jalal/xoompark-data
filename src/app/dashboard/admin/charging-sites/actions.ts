'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import type { Clearance, ClearanceStatus, PortMounting, SavedChargingLocation } from '@/lib/types';
import { searchChargingSites, type AfdcSearchParams } from './lib/afdc';
import type { ClearanceImportRow } from './lib/clearance';

const getDb = getAdminFirestore;

export async function findChargingSites(params: AfdcSearchParams) {
  await requireAdmin();
  return searchChargingSites(params);
}

/**
 * Save (or refresh) a station. Merge, not overwrite: clearance and notes are
 * ours and must survive a re-save that only refreshes the AFDC snapshot —
 * same rule siteFindings already applies to manual fields.
 */
export async function saveChargingLocation(
  afdcId: number,
  snapshot: Pick<
    SavedChargingLocation,
    'name' | 'lat' | 'lng' | 'network' | 'streetAddress' | 'city' | 'state' | 'dcFastPorts' | 'maxPowerKw'
  >,
) {
  const admin = await requireAdmin();
  const db = getDb();
  const ref = db.collection('savedChargingLocations').doc(String(afdcId));
  const existing = await ref.get();

  await ref.set(
    {
      id: String(afdcId),
      afdcId,
      ...snapshot,
      clearance: existing.exists ? undefined : null,
      notes: existing.exists ? undefined : null,
      ownerName: existing.exists ? undefined : null,
      portMounting: existing.exists ? undefined : null,
      savedBy: existing.exists ? undefined : admin.email,
      createdAt: existing.exists ? undefined : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function listSavedChargingLocations(): Promise<SavedChargingLocation[]> {
  await requireAdmin();
  const db = getDb();
  const snapshot = await db.collection('savedChargingLocations').orderBy('name').get();
  return JSON.parse(JSON.stringify(snapshot.docs.map((doc) => doc.data())));
}

export async function updateChargingLocationClearance(
  afdcId: number,
  clearance: { inches: number; status: ClearanceStatus; measuredBy?: string; measuredAt?: string } | null,
) {
  await requireAdmin();
  const db = getDb();
  const value: Clearance | null = clearance;
  await db.collection('savedChargingLocations').doc(String(afdcId)).update({
    clearance: value,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationNotes(afdcId: number, notes: string) {
  await requireAdmin();
  const db = getDb();
  await db.collection('savedChargingLocations').doc(String(afdcId)).update({
    notes: notes || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationOwnerName(afdcId: number, ownerName: string) {
  await requireAdmin();
  const db = getDb();
  await db.collection('savedChargingLocations').doc(String(afdcId)).update({
    ownerName: ownerName || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationPortMounting(afdcId: number, portMounting: PortMounting | null) {
  await requireAdmin();
  const db = getDb();
  await db.collection('savedChargingLocations').doc(String(afdcId)).update({
    portMounting,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteSavedChargingLocation(afdcId: number) {
  await requireAdmin();
  const db = getDb();
  await db.collection('savedChargingLocations').doc(String(afdcId)).delete();
}

/**
 * Bulk clearance source — a survey CSV rather than one row at a time.
 * Only writes onto locations already saved from a search: the AFDC id is the
 * join key, and a row for an id we haven't saved has no station snapshot to
 * attach to, so it's reported as skipped rather than creating a stub doc.
 */
export async function bulkImportClearance(rows: ClearanceImportRow[]) {
  await requireAdmin();
  const db = getDb();

  const updated: number[] = [];
  const skipped: { afdcId: number; reason: string }[] = [];

  for (const row of rows) {
    const ref = db.collection('savedChargingLocations').doc(String(row.afdcId));
    const existing = await ref.get();
    if (!existing.exists) {
      skipped.push({ afdcId: row.afdcId, reason: 'not a saved location — save it from a search first' });
      continue;
    }

    const clearance: Clearance = {
      inches: row.inches,
      status: row.status,
      measuredBy: row.measuredBy,
      measuredAt: row.measuredAt,
    };
    await ref.update({ clearance, updatedAt: FieldValue.serverTimestamp() });
    updated.push(row.afdcId);
  }

  return { updated, skipped };
}
