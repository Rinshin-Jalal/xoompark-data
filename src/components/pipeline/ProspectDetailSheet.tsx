'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { moveProspectStage, getProspectLots } from '@/lib/outreach/actions';
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, type BDProspect, type ProspectStage } from '@/lib/pipeline/types';

export function ProspectDetailSheet({ prospect, onClose }: { prospect: BDProspect | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lots, setLots] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!prospect) return;
    let cancelled = false;
    getProspectLots(prospect.id)
      .then((l) => { if (!cancelled) setLots(l); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [prospect?.id]);

  function move(stage: ProspectStage) {
    if (!prospect) return;
    startTransition(async () => {
      try {
        await moveProspectStage(prospect.id, stage);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to move stage');
      }
    });
  }

  return (
    <Sheet open={!!prospect} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetTitle>Deal workspace</SheetTitle>
          <SheetDescription>The prospect is the primary object — lots are context.</SheetDescription>
        </SheetHeader>
        {prospect && (
          <div className="detail-body">
            <h2>{prospect.companyName}</h2>
            <div className="detail-topline">
              <span className="muted">{prospect.description}</span>
            </div>

            <section className="detail-section">
              <h3>Prospect</h3>
              <div className="detail-info-grid">
                <div>
                  <small>Stage</small>
                  <select
                    value={prospect.stage}
                    disabled={pending}
                    onChange={(e) => move(e.target.value as ProspectStage)}
                    style={{ fontSize: 13, border: '1px solid #e5e3e3', borderRadius: 6, padding: '5px 6px', background: '#fff', color: '#171717', width: '100%' }}
                  >
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>{PIPELINE_STAGE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div><small>Deal type</small><span>{prospect.deal_type === 'portfolio_master_agreement' ? 'Portfolio master agreement' : 'Single site'}</span></div>
                <div><small>Assigned to</small><span>{prospect.assignedTo || '—'}</span></div>
                <div><small>Source</small><span>{prospect.source}</span></div>
              </div>
            </section>

            <section className="detail-section">
              <h3>Contact</h3>
              <div className="detail-info-grid">
                <div><small>Name</small><span>{prospect.contactName || '—'}</span></div>
                <div><small>Title</small><span>{prospect.contactTitle || '—'}</span></div>
                <div><small>Email</small><span>{prospect.contactEmail || '—'}</span></div>
                <div><small>Phone</small><span>{prospect.contactPhone || '—'}</span></div>
                <div>
                  <small>Website</small>
                  <span>
                    {prospect.website ? (
                      <a href={prospect.website} target="_blank" rel="noreferrer" style={{ color: '#3b7a57' }}>{prospect.website}</a>
                    ) : '—'}
                  </span>
                </div>
                <div><small>City</small><span>{prospect.city || '—'}</span></div>
              </div>
            </section>

            <section className="detail-section">
              <h3>Deal</h3>
              <div className="detail-info-grid">
                <div><small>Total stalls in deal</small><span>{prospect.total_stalls_in_deal ?? '—'}</span></div>
                <div><small>Linked lots</small><span>{prospect.associated_lot_ids?.length ?? 0}</span></div>
                <div><small>Created</small><span>{prospect.createdAt ? new Date(prospect.createdAt).toLocaleDateString() : '—'}</span></div>
                <div><small>Stage updated</small><span>{prospect.stageUpdatedAt ? new Date(prospect.stageUpdatedAt).toLocaleString() : '—'}</span></div>
              </div>
            </section>

            <section className="detail-section">
              <h3>Linked lots</h3>
              {lots.length === 0 ? (
                <p className="muted">No linked lots found.</p>
              ) : (
                lots.map((lot) => (
                  <div key={lot.id} className="history-item">
                    <p>{lot.name}</p>
                    <small>{lot.id}</small>
                  </div>
                ))
              )}
            </section>

            <section className="detail-section">
              <h3>Provider snapshot</h3>
              <div className="detail-info-grid">
                <div><small>Provider type</small><span>{prospect.providerDetails?.providerType || '—'}</span></div>
                <div><small>Infrastructure</small><span>{prospect.providerDetails?.infraType || '—'}</span></div>
                <div><small>Estimated spaces</small><span>{prospect.providerDetails?.estimatedSpaces ?? '—'}</span></div>
                <div><small>Estimated locations</small><span>{prospect.providerDetails?.estimatedLocations ?? '—'}</span></div>
                <div><small>Currently monetized</small><span>{prospect.providerDetails?.currentlyMonetized == null ? '—' : prospect.providerDetails.currentlyMonetized ? 'Yes' : 'No'}</span></div>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
