import 'server-only';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil, Globe, Mail, Phone, MapPin, ExternalLink, BookOpen } from 'lucide-react';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { cn } from '@/lib/utils';
import type { Prospect, ProspectNote, ProspectStage, ProspectSide } from '../types';
import {
  STAGE_LABELS, STAGE_COLORS, SOURCE_LABELS, INFRA_LABELS, FLEET_LABELS,
  PROVIDER_TYPE_LABELS, SERVICE_LABELS,
} from '../types';
import { Button } from '@/components/ui/button';
import { AddNoteForm } from '../_components/AddNoteForm';
import { StageSelect } from '../_components/StageSelect';
import { DeleteProspectButton, DeleteNoteButton } from '../_components/DeleteButtons';

const BD_COLLECTION = 'bdProspects';

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

async function getNotes(id: string): Promise<ProspectNote[]> {
  const db = getAdminFirestore();
  try {
    const snap = await db
      .collection(BD_COLLECTION).doc(id)
      .collection('notes')
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        body: d.body ?? '',
        authorEmail: d.authorEmail ?? '',
        authorName: d.authorName ?? '',
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? '',
      };
    });
  } catch {
    return [];
  }
}

function SidePill({ side }: { side: ProspectSide }) {
  return (
    <span className={cn(
      'font-mono text-[10px] font-semibold uppercase tracking-[.1em] px-2.5 py-1 rounded-full border',
      side === 'provider'
        ? 'bg-[#afcbff]/20 text-[#1a3a7a] border-[#afcbff]/50'
        : 'bg-[#ffede1]/60 text-[#7a3a1a] border-[#ffede1]'
    )}>
      {side === 'provider' ? 'Provider' : 'Operator'}
    </span>
  );
}

function StagePill({ stage }: { stage: ProspectStage }) {
  return (
    <span className={cn(
      'inline-flex items-center border font-mono text-[10px] font-semibold uppercase tracking-[.1em] px-2.5 py-1 rounded-full',
      STAGE_COLORS[stage]
    )}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[#0e1c36]/8 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#0e1c36]/40 w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-[#0e1c36]">{value}</span>
    </div>
  );
}

function formatDate(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatNoteDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [prospect, notes] = await Promise.all([getProspect(id), getNotes(id)]);

  if (!prospect) notFound();

  const pd = prospect.providerDetails;
  const od = prospect.operatorDetails;

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/admin/pipeline"
        className="flex items-center gap-1.5 font-mono text-[10px] text-[#0e1c36]/40 hover:text-[#1a3a7a] mb-5 uppercase tracking-[.12em]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Pipeline
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <SidePill side={prospect.side} />
            <StagePill stage={prospect.stage} />
          </div>
          <h1 className="text-3xl font-bold text-[#0e1c36] tracking-tight">{prospect.companyName}</h1>
          {prospect.city && (
            <p className="flex items-center gap-1.5 text-sm text-[#0e1c36]/50 mt-1">
              <MapPin className="h-3.5 w-3.5" /> {prospect.city}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageSelect prospectId={prospect.id} current={prospect.stage} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/admin/pipeline/${prospect.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/admin/pipeline/${prospect.id}/guide`}>
              <BookOpen className="h-4 w-4" /> Onboarding Guide
            </Link>
          </Button>
          <DeleteProspectButton prospectId={prospect.id} companyName={prospect.companyName} />
        </div>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-7 text-sm text-[#0e1c36]/50">
        {prospect.assignedTo && (
          <span>Assigned to <strong className="text-[#0e1c36]/70">{prospect.assignedTo}</strong></span>
        )}
        {prospect.lastContactedAt && (
          <span>Last contacted <strong className="text-[#0e1c36]/70">{formatDate(prospect.lastContactedAt)}</strong></span>
        )}
        {prospect.nextFollowUp && (
          <span>Follow up <strong className="text-[#0e1c36]/70">{formatDate(prospect.nextFollowUp)}</strong></span>
        )}
        <span>Added by <strong className="text-[#0e1c36]/70">{prospect.createdBy}</strong> on {formatDate(prospect.createdAt)}</span>
      </div>

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left — Details (3/5) */}
        <div className="lg:col-span-3 space-y-5">
          {/* Core info */}
          <div className="border border-[#0e1c36]/12 bg-white p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 mb-3">Contact</p>
            <FieldRow label="Name" value={prospect.contactName} />
            <FieldRow label="Title" value={prospect.contactTitle} />
            <FieldRow label="Email" value={prospect.contactEmail} />
            <FieldRow label="Phone" value={prospect.contactPhone} />
            {prospect.website && (
              <div className="flex items-start gap-3 py-2">
                <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#0e1c36]/40 w-32 shrink-0 pt-0.5">Website</span>
                <a href={prospect.website} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-[#1a3a7a] hover:underline flex items-center gap-1">
                  {prospect.website.replace(/^https?:\/\//, '')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Description */}
          {prospect.description && (
            <div className="border border-[#0e1c36]/12 bg-white p-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 mb-3">Description</p>
              <p className="text-sm text-[#0e1c36] leading-relaxed whitespace-pre-wrap">{prospect.description}</p>
            </div>
          )}

          {/* Pipeline metadata */}
          <div className="border border-[#0e1c36]/12 bg-white p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 mb-3">Pipeline</p>
            <FieldRow label="Source" value={prospect.source ? SOURCE_LABELS[prospect.source as keyof typeof SOURCE_LABELS] : null} />
            <FieldRow label="Assigned to" value={prospect.assignedTo} />
            <FieldRow label="Follow-up" value={formatDate(prospect.nextFollowUp)} />
          </div>

          {/* Provider details */}
          {pd && (
            <div className="border border-[#0e1c36]/12 bg-white p-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 mb-3">Infrastructure Details</p>
              <FieldRow label="Entity type" value={pd.providerType ? PROVIDER_TYPE_LABELS[pd.providerType as keyof typeof PROVIDER_TYPE_LABELS] : null} />
              <FieldRow label="Infra type" value={pd.infraType ? INFRA_LABELS[pd.infraType as keyof typeof INFRA_LABELS] : null} />
              <FieldRow label="Est. spaces" value={pd.estimatedSpaces != null ? pd.estimatedSpaces.toString() : null} />
              <FieldRow label="Est. locations" value={pd.estimatedLocations != null ? pd.estimatedLocations.toString() : null} />
              <FieldRow label="Monetised?" value={pd.currentlyMonetized == null ? null : pd.currentlyMonetized ? 'Yes' : 'No'} />
              {pd.servicesInterested.length > 0 && (
                <div className="flex items-start gap-3 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#0e1c36]/40 w-32 shrink-0 pt-0.5">Services</span>
                  <div className="flex flex-wrap gap-1.5">
                    {pd.servicesInterested.map((s) => (
                      <span key={s} className="font-mono text-[9px] font-semibold uppercase tracking-[.1em] bg-[#0e1c36]/8 text-[#0e1c36]/70 px-2 py-0.5 rounded">
                        {SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Operator details */}
          {od && (
            <div className="border border-[#0e1c36]/12 bg-white p-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 mb-3">Fleet Details</p>
              <FieldRow label="Fleet type" value={od.fleetType ? FLEET_LABELS[od.fleetType as keyof typeof FLEET_LABELS] : null} />
              <FieldRow label="Fleet size" value={od.fleetSize != null ? `${od.fleetSize} vehicles` : null} />
              <FieldRow label="Markets" value={od.operatingMarkets} />
              <FieldRow label="Current solution" value={od.currentSolution} />
              <FieldRow label="API ready?" value={od.apiReady == null ? null : od.apiReady ? 'Yes' : 'Not yet'} />
              <FieldRow label="Monthly vol." value={od.estimatedMonthlyVolume != null ? `~${od.estimatedMonthlyVolume.toLocaleString()} reservations` : null} />
              <FieldRow label="Target go-live" value={formatDate(od.targetGoLive)} />
              {od.servicesNeeded.length > 0 && (
                <div className="flex items-start gap-3 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[.1em] text-[#0e1c36]/40 w-32 shrink-0 pt-0.5">Needs</span>
                  <div className="flex flex-wrap gap-1.5">
                    {od.servicesNeeded.map((s) => (
                      <span key={s} className="font-mono text-[9px] font-semibold uppercase tracking-[.1em] bg-[#0e1c36]/8 text-[#0e1c36]/70 px-2 py-0.5 rounded">
                        {SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          {prospect.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {prospect.tags.map((tag) => (
                <span key={tag} className="font-mono text-[10px] bg-[#0e1c36]/8 text-[#0e1c36]/60 px-2.5 py-1 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right — Notes (2/5) */}
        <div className="lg:col-span-2">
          <div className="border border-[#0e1c36]/12 bg-white">
            <div className="border-b border-[#0e1c36]/10 px-5 py-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/50">
                Notes {notes.length > 0 && `(${notes.length})`}
              </p>
            </div>
            <div className="p-4">
              <AddNoteForm prospectId={prospect.id} />
            </div>
            {notes.length > 0 && (
              <div className="divide-y divide-[#0e1c36]/8">
                {notes.map((note) => (
                  <div key={note.id} className="px-5 py-4 group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full bg-[#0e1c36] flex items-center justify-center">
                          <span className="font-mono text-[8px] font-bold text-[#f9fbf2]">
                            {(note.authorName[0] ?? note.authorEmail[0] ?? '?').toUpperCase()}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-[#0e1c36]/55">{note.authorEmail.split('@')[0]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[#0e1c36]/35">{formatNoteDate(note.createdAt)}</span>
                        <DeleteNoteButton prospectId={prospect.id} noteId={note.id} />
                      </div>
                    </div>
                    <p className="text-sm text-[#0e1c36] leading-relaxed whitespace-pre-wrap">{note.body}</p>
                  </div>
                ))}
              </div>
            )}
            {notes.length === 0 && (
              <p className="px-5 pb-6 text-sm text-center text-[#0e1c36]/30">No notes yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
