import 'server-only';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { ProspectForm } from '../../_components/ProspectForm';
import type { Prospect } from '../../types';

const BD_COLLECTION = 'prospects';

async function getProspect(id: string): Promise<Prospect | null> {
  const db = getAdminFirestore();
  try {
    const doc = await db.collection(BD_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const d = doc.data()!;
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
  } catch {
    return null;
  }
}

export default async function EditProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/dashboard/admin/pipeline/${id}`}
          className="flex items-center gap-1.5 font-mono text-[10px] text-[#0e1c36]/40 hover:text-[#1a3a7a] mb-4 uppercase tracking-[.12em]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {prospect.companyName}
        </Link>
        <h1 className="text-2xl font-bold text-[#0e1c36]">Edit Prospect</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">{prospect.companyName}</p>
      </div>
      <ProspectForm prospect={prospect} />
    </div>
  );
}
