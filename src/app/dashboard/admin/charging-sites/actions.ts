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
 * same rule pitstop_findings already applies to manual fields.
 */
export async function saveChargingLocation(
  source_id: number,
  snapshot: Pick<
    SavedChargingLocation,
    'name' | 'lat' | 'lng' | 'network_name' | 'street_address' | 'city' | 'state' | 'dc_fast_port_count' | 'max_power_kw'
  >,
) {
  const admin = await requireAdmin();
  const db = getDb();
  const ref = db.collection('charging_sites').doc(String(source_id));
  const existing = await ref.get();

  await ref.set(
    {
      id: String(source_id),
      source_id,
      ...snapshot,
      clearance: existing.exists ? undefined : null,
      notes: existing.exists ? undefined : null,
      owner_name: existing.exists ? undefined : null,
      mounting_type: existing.exists ? undefined : null,
      saved_by: existing.exists ? undefined : admin.email,
      createdAt: existing.exists ? undefined : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function listSavedChargingLocations(): Promise<SavedChargingLocation[]> {
  await requireAdmin();
  const db = getDb();
  const snapshot = await db.collection('charging_sites').orderBy('name').get();
  return JSON.parse(JSON.stringify(snapshot.docs.map((doc) => doc.data())));
}

export async function updateChargingLocationClearance(
  source_id: number,
  clearance: { inches: number; status: ClearanceStatus; measuredBy?: string; measuredAt?: string } | null,
) {
  await requireAdmin();
  const db = getDb();
  const value: Clearance | null = clearance;
  await db.collection('charging_sites').doc(String(source_id)).update({
    clearance: value,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationNotes(source_id: number, notes: string) {
  await requireAdmin();
  const db = getDb();
  await db.collection('charging_sites').doc(String(source_id)).update({
    notes: notes || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationOwnerName(source_id: number, owner_name: string) {
  await requireAdmin();
  const db = getDb();
  await db.collection('charging_sites').doc(String(source_id)).update({
    owner_name: owner_name || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateChargingLocationPortMounting(source_id: number, mounting_type: PortMounting | null) {
  await requireAdmin();
  const db = getDb();
  await db.collection('charging_sites').doc(String(source_id)).update({
    mounting_type,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteSavedChargingLocation(source_id: number) {
  await requireAdmin();
  const db = getDb();
  await db.collection('charging_sites').doc(String(source_id)).delete();
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
  const skipped: { source_id: number; reason: string }[] = [];

  for (const row of rows) {
    const ref = db.collection('charging_sites').doc(String(row.afdcId));
    const existing = await ref.get();
    if (!existing.exists) {
      skipped.push({ source_id: row.afdcId, reason: 'not a saved location — save it from a search first' });
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
