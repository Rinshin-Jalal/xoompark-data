'use client';

import { useEffect, useState } from 'react';
import { Zap, MapPin, Search, Eye } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useDetail } from '@/components/outreach/DetailContext';
import { useData } from '@/components/outreach/DataContext';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';
import { DetailWorkflow } from '@/components/outreach/DetailWorkflow';
import { OfferCapture } from '@/components/outreach/OfferCapture';
import { EditableField } from '@/components/outreach/EditableField';
import { nextAction, gaps } from '@/lib/outreach/workflow';
import { getActivity } from '@/lib/outreach/actions';

// Shared detail drawer — opened from any view (Properties, My Day, Pipeline).
// Shows the operator context, next action, workflow controls, offers, and gaps.
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

  const lat = selected?.raw.lat ? parseFloat(selected.raw.lat) : null;
  const lng = selected?.raw.lng ? parseFloat(selected.raw.lng) : null;
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);

  return (
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetTitle>Property workspace</SheetTitle>
          <SheetDescription>Research, review and hand off with context.</SheetDescription>
        </SheetHeader>
        {selected && (
          <div className="detail-body">
            <EditableField label="Name" value={selected.raw.name} lotId={selected.id} field="name" className="detail-name" />
            <div className="detail-topline">
              <EditableField label="Address" value={selected.raw.address} lotId={selected.id} field="address" className="muted" />
            </div>

            <div className="open-in-links">
              {hasCoords && (
                <>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer">
                    <MapPin size={13} /> Maps
                  </a>
                  <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`} target="_blank" rel="noreferrer">
                    <Eye size={13} /> Street View
                  </a>
                </>
              )}
              <a href={`https://www.google.com/search?q=${encodeURIComponent(`${selected.raw.name} ${selected.raw.address}`)}`} target="_blank" rel="noreferrer">
                <Search size={13} /> Google
              </a>
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
            <OfferCapture lotId={selected.id} />
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
                <div><small>Total spaces</small><EditableField label="Total spaces" value={selected.raw.stall_count} lotId={selected.id} field="stall_count" className="detail-field" /></div>
                <div><small>Hours</small><EditableField label="Hours" value={selected.raw.hours_text} lotId={selected.id} field="hours_text" className="detail-field" /></div>
                <div><small>Clearance</small><EditableField label="Clearance" value={selected.raw.clearance_text} lotId={selected.id} field="clearance_text" className="detail-field" /></div>
                <div><small>Rates</small><EditableField label="Rates" value={selected.raw.price_text} lotId={selected.id} field="price_text" className="detail-field" /></div>
                <div><small>Gate</small><EditableField label="Gate" value={selected.raw.gate_type} lotId={selected.id} field="gate_type" className="detail-field" /></div>
                <div><small>Owner</small><span>{selected.property_details?.owner || '—'}</span></div>
                <div><small>Operator</small><span>{selected.property_details?.operator || '—'}</span></div>
                <div><small>EV</small><span>{selected.property_details?.ev || '—'}</span></div>
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