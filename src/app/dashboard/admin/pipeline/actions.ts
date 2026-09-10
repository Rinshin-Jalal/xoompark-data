'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import type { ProspectSide, ProspectStage } from './types';

const BD_COLLECTION = 'bdProspects';
const LIST_PATH = '/dashboard/admin/pipeline';

async function requireAdmin(): Promise<{ uid: string; email: string; name: string }> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (!session) throw new Error('Not authenticated');
  const decoded = await getAdminAuth().verifySessionCookie(session, true);
  if (decoded.role !== 'admin') throw new Error('Not authorized — xoompark.co accounts only');
  return {
    uid: decoded.uid,
    email: decoded.email ?? '',
    name: (decoded.name as string | undefined) ?? decoded.email ?? 'Team',
  };
}

export type ProspectInput = {
  side: ProspectSide;
  stage: ProspectStage;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  city: string;
  description: string;
  source: string;
  assignedTo: string;
  nextFollowUp: string;
  tags: string[];
  // Provider-specific
  providerType: string;
  infraType: string;
  estimatedSpaces: number | null;
  estimatedLocations: number | null;
  servicesInterested: string[];
  currentlyMonetized: boolean | null;
  // Operator-specific
  fleetType: string;
  fleetSize: number | null;
  servicesNeeded: string[];
  operatingMarkets: string;
  currentSolution: string;
  apiReady: boolean | null;
  estimatedMonthlyVolume: number | null;
  targetGoLive: string;
};

function buildNestedDetails(input: ProspectInput) {
  const providerDetails =
    input.side === 'provider'
      ? {
          providerType: input.providerType,
          infraType: input.infraType,
          estimatedSpaces: input.estimatedSpaces,
          estimatedLocations: input.estimatedLocations,
          servicesInterested: input.servicesInterested,
          currentlyMonetized: input.currentlyMonetized,
        }
      : null;

  const operatorDetails =
    input.side === 'operator'
      ? {
          fleetType: input.fleetType,
          fleetSize: input.fleetSize,
          servicesNeeded: input.servicesNeeded,
          operatingMarkets: input.operatingMarkets,
          currentSolution: input.currentSolution,
          apiReady: input.apiReady,
          estimatedMonthlyVolume: input.estimatedMonthlyVolume,
          targetGoLive: input.targetGoLive,
        }
      : null;

  return { providerDetails, operatorDetails };
}

export async function createProspect(input: ProspectInput): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();
  const { providerDetails, operatorDetails } = buildNestedDetails(input);

  const ref = db.collection(BD_COLLECTION).doc();

  await ref.set({
    id: ref.id,
    side: input.side,
    stage: input.stage,
    companyName: input.companyName.trim(),
    contactName: input.contactName.trim(),
    contactTitle: input.contactTitle.trim(),
    contactEmail: input.contactEmail.trim(),
    contactPhone: input.contactPhone.trim(),
    website: input.website.trim(),
    city: input.city.trim(),
    description: input.description.trim(),
    source: input.source,
    assignedTo: input.assignedTo.trim() || admin.email,
    lastContactedAt: null,
    nextFollowUp: input.nextFollowUp || null,
    tags: input.tags.filter(Boolean),
    providerDetails,
    operatorDetails,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: admin.email,
  });

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${ref.id}`);
}

export async function updateProspect(id: string, side: ProspectSide, input: ProspectInput): Promise<void> {
  await requireAdmin();
  const db = getAdminFirestore();
  const { providerDetails, operatorDetails } = buildNestedDetails({ ...input, side });

  await db.collection(BD_COLLECTION).doc(id).update({
    stage: input.stage,
    companyName: input.companyName.trim(),
    contactName: input.contactName.trim(),
    contactTitle: input.contactTitle.trim(),
    contactEmail: input.contactEmail.trim(),
    contactPhone: input.contactPhone.trim(),
    website: input.website.trim(),
    city: input.city.trim(),
    description: input.description.trim(),
    source: input.source,
    assignedTo: input.assignedTo.trim(),
    nextFollowUp: input.nextFollowUp || null,
    tags: input.tags.filter(Boolean),
    providerDetails,
    operatorDetails,
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(`${LIST_PATH}/${id}`);
}

export async function updateStage(id: string, stage: ProspectStage): Promise<void> {
  await requireAdmin();
  const db = getAdminFirestore();
  await db.collection(BD_COLLECTION).doc(id).update({
    stage,
    updatedAt: FieldValue.serverTimestamp(),
  });
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
}

export async function deleteProspect(id: string): Promise<void> {
  await requireAdmin();
  const db = getAdminFirestore();

  const notesSnap = await db.collection(BD_COLLECTION).doc(id).collection('notes').get();
  const batch = db.batch();
  notesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection(BD_COLLECTION).doc(id));
  await batch.commit();

  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}

export async function addNote(prospectId: string, body: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();

  const noteRef = db.collection(BD_COLLECTION).doc(prospectId).collection('notes').doc();
  await noteRef.set({
    id: noteRef.id,
    body: body.trim(),
    authorEmail: admin.email,
    authorName: admin.name,
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection(BD_COLLECTION).doc(prospectId).update({
    lastContactedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidatePath(`${LIST_PATH}/${prospectId}`);
}

export async function deleteNote(prospectId: string, noteId: string): Promise<void> {
  await requireAdmin();
  const db = getAdminFirestore();
  await db
    .collection(BD_COLLECTION)
    .doc(prospectId)
    .collection('notes')
    .doc(noteId)
    .delete();
  revalidatePath(`${LIST_PATH}/${prospectId}`);
}

export async function duplicateProspect(id: string): Promise<{ newId: string }> {
  const admin = await requireAdmin();
  const db = getAdminFirestore();

  const srcDoc = await db.collection(BD_COLLECTION).doc(id).get();
  if (!srcDoc.exists) throw new Error('Prospect not found');

  const d = srcDoc.data()!;
  const newRef = db.collection(BD_COLLECTION).doc();

  await newRef.set({
    ...d,
    id: newRef.id,
    companyName: `Copy of ${d.companyName ?? ''}`.trim(),
    stage: 'IDENTIFIED',
    lastContactedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: admin.email,
  });

  revalidatePath(LIST_PATH);
  return { newId: newRef.id };
}
