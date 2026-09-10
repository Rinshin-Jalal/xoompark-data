import 'server-only';
import { getAdminFirestore } from '../firebaseAdmin.ts';
import type { OutreachRecord, OutreachState } from './types.ts';

const outreachCollection = (lotId: string) =>
  getAdminFirestore().collection('sourcedParkingLocations').doc(lotId).collection('outreach');

export async function getOutreachRecord(lotId: string): Promise<OutreachRecord | null> {
  const snap = await outreachCollection(lotId).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data() as OutreachRecord;
}

export async function saveOutreachRecord(
  lotId: string,
  data: Omit<OutreachRecord, 'id' | 'lotId' | 'createdAt' | 'updatedAt'>,
): Promise<OutreachRecord> {
  const existing = await getOutreachRecord(lotId);
  const now = new Date().toISOString();

  if (existing) {
    const updated: OutreachRecord = { ...existing, ...data, updatedAt: now };
    await outreachCollection(lotId).doc(existing.id).set(updated);
    return updated;
  }

  const ref = outreachCollection(lotId).doc();
  const record: OutreachRecord = {
    id: ref.id,
    lotId,
    ...data,
    createdAt: now,
    updatedAt: now,
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
      lotId,
      contactName: '',
      contactRole: '',
      contactEmail: '',
      contactPhone: '',
      inquirySent: false,
      callMade: false,
      formSubmitted: false,
      offerSpaces: null,
      offerPrice: '',
      offerStart: '',
      outreachState: state,
      responseDate: state === 'responded' ? now : null,
      quoteSource: '',
      bdrOwner: '',
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(record);
    return record;
  }

  const update: Partial<OutreachRecord> = { outreachState: state, updatedAt: now };
  if (state === 'responded' && !existing.responseDate) {
    update.responseDate = now;
  }
  await outreachCollection(lotId).doc(existing.id).update(update);
  return { ...existing, ...update } as OutreachRecord;
}
