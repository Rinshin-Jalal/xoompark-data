import 'server-only';
import { getAdminFirestore } from '../firebaseAdmin.ts';
import type { OutreachRecord, OutreachState } from './types.ts';

const outreachCollection = (lotId: string) =>
  getAdminFirestore().collection('parking_lots').doc(lotId).collection('outreach');

export async function getOutreachRecord(lotId: string): Promise<OutreachRecord | null> {
  const snap = await outreachCollection(lotId).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data() as OutreachRecord;
}

export async function saveOutreachRecord(
  lotId: string,
  data: Omit<OutreachRecord, 'id' | 'lot_id' | 'created_at' | 'updated_at'>,
): Promise<OutreachRecord> {
  const existing = await getOutreachRecord(lotId);
  const now = new Date().toISOString();

  if (existing) {
    const updated: OutreachRecord = { ...existing, ...data, updated_at: now };
    await outreachCollection(lotId).doc(existing.id).set(updated);
    return updated;
  }

  const ref = outreachCollection(lotId).doc();
  const record: OutreachRecord = {
    id: ref.id,
    lot_id: lotId,
    ...data,
    created_at: now,
    updated_at: now,
  };
  await ref.set(record);
  return record;
}

export async function setOutreachState(
  lotId: string,
  state: OutreachState,
): Promise<OutreachRecord | null> {
  const existing = await getOutreachRecord(lotId);
  const now = new Date().toISOString();

  if (!existing) {
    const ref = outreachCollection(lotId).doc();
    const record: OutreachRecord = {
      id: ref.id,
      lot_id: lotId,
      contact_name: '',
      contact_title: '',
      contact_email: '',
      contact_phone: '',
      email_sent: false,
      call_completed: false,
      form_submitted: false,
      offered_spaces: null,
      offered_price: '',
      offered_start_date: '',
      status: state,
      response_date: state === 'responded' ? now : null,
      quote_source: '',
      assigned_to: '',
      created_at: now,
      updated_at: now,
    };
    await ref.set(record);
    return record;
  }

  const update: Partial<OutreachRecord> = { status: state, updated_at: now };
  if (state === 'responded' && !existing.response_date) {
    update.response_date = now;
  }
  await outreachCollection(lotId).doc(existing.id).update(update);
  return { ...existing, ...update } as OutreachRecord;
}