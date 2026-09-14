'use client';

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useDetail } from '@/components/outreach/DetailContext';
import { useData } from '@/components/outreach/DataContext';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';
import { DetailWorkflow } from '@/components/outreach/DetailWorkflow';
import { OfferCapture } from '@/components/outreach/OfferCapture';
import { nextAction, gaps } from '@/lib/outreach/workflow';
import { getActivity } from '@/lib/outreach/actions';

// Shared detail drawer — opened from any view (Properties, My Day, Pipeline).
// Shows the operator context, next action, workflow controls, and gaps.
export function DetailSheet() {
  const { selected, close } = useDetail();
  const data = useData();
  const [activity, setActivity] = useState<{ actor: string; message: string; created: string }[]>([]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getActivity(selected.id).then((a) => { if (!cancelled) setActivity(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id]);

  const lotCount = selected
    ? data.leads.filter((l) => l.raw.company_account_id === selected.raw.company_account_id).length
    : 0;

  return (
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetTitle>Property workspace</SheetTitle>
          <SheetDescription>Research, review and hand off with context.</SheetDescription>
        </SheetHeader>
        {selected && (
          <div className="detail-body">
            <h2>{selected.raw.name}</h2>
            <div className="detail-topline">
              <span className="muted">{selected.raw.address}</span>
            </div>
            <ConnectionsBar lead={selected} lotCount={lotCount} />
            <div className="next-action">
              <Zap size={18} />
              <div>
                <strong>Next action</strong>
                <p>{nextAction(selected)}</p>
              </div>
            </div>
            <DetailWorkflow lead={selected} />
            <section className="detail-section">
              <h3>Contact</h3>
              <div className="detail-info-grid">
                <div><small>Contact name</small><span>{selected.contact_name || 'Decision-maker needed'}</span></div>
                <div><small>Role</small><span>{selected.contact_role || '—'}</span></div>
                <div><small>Business email</small><span>{selected.email || '—'}</span></div>
                <div><small>Phone</small><span>{selected.phone || '—'}</span></div>
              </div>
            </section>
            <section className="detail-section">
              <h3>Property details</h3>
              <div className="detail-info-grid">
                {Object.entries(selected.property_details ?? {}).map(([k, v]) => (
                  <div key={k}><small>{k.replaceAll('_', ' ')}</small><span>{v || '—'}</span></div>
                ))}
              </div>
            </section>
            <section className="detail-section">
              <h3>Missing information</h3>
              {gaps(selected).length === 0 ? (
                <p className="info-complete">All tracked details recorded</p>
              ) : (
                <div className="gap-chips">
                  {gaps(selected).map((f) => <span key={f.key} className={f.status}>{f.label} · {f.status}</span>)}
                </div>
              )}
            </section>
            <section className="detail-section">
              <h3>Activity</h3>
              {activity.length === 0 ? (
                <p className="muted">No activity yet.</p>
              ) : (
                <div>
                  {activity.map((a, i) => (
                    <div key={i} className="history-item">
                      <p>{a.message}</p>
                      <small>{a.actor} · {new Date(a.created).toLocaleString()}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}