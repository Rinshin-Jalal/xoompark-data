import 'server-only';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { Prospect } from './types';
import { PipelineClient } from './_components/PipelineClient';

const BD_COLLECTION = 'prospects';

async function getProspects(): Promise<Prospect[]> {
  const db = getAdminFirestore();
  try {
    const snap = await db.collection(BD_COLLECTION).orderBy('updatedAt', 'desc').get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        side: d.side,
        stage: d.stage,
        companyName: d.companyName ?? '',
        contactName: d.contactName ?? '',
        contactTitle: d.contactTitle ?? '',
        contactEmail: d.contactEmail ?? '',
        contactPhone: d.contactPhone ?? '',
        website: d.website ?? '',
        city: d.city ?? '',
        description: d.description ?? '',
        source: d.source ?? '',
        assignedTo: d.assignedTo ?? '',
        lastContactedAt: d.lastContactedAt?.toDate?.()?.toISOString() ?? null,
        nextFollowUp: d.nextFollowUp ?? null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        providerDetails: d.providerDetails ?? null,
        operatorDetails: d.operatorDetails ?? null,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? '',
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? '',
        createdBy: d.createdBy ?? '',
      } as Prospect;
    });
  } catch {
    return [];
  }
}

export default async function PipelinePage() {
  const prospects = await getProspects();
  return (
    <div className="max-w-6xl">
      <PipelineClient prospects={prospects} />
    </div>
  );
}
