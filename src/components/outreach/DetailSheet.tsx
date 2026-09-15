'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Zap, MapPin, Search, Eye, Pencil, Check, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useDetail } from '@/components/outreach/DetailContext';
import { useData } from '@/components/outreach/DataContext';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';
import { DetailWorkflow } from '@/components/outreach/DetailWorkflow';
import { OfferCapture } from '@/components/outreach/OfferCapture';
import { EnrichmentVerify } from '@/components/outreach/EnrichmentVerify';
import { OpenInLinks } from '@/components/outreach/OpenInLinks';
import { nextAction, gaps } from '@/lib/outreach/workflow';
import { getActivity, saveFields, saveContact } from '@/lib/outreach/actions';

const EDITABLE_FIELDS: { key: string; label: string }[] = [
  { key: 'stall_count', label: 'Total spaces' },
  { key: 'hours_text', label: 'Hours' },
  { key: 'clearance_text', label: 'Clearance' },
  { key: 'price_text', label: 'Rates' },
  { key: 'gate_type', label: 'Gate' },
  { key: 'ev', label: 'EV charging' },
  { key: 'pudo', label: 'Pickup / drop-off' },
  { key: 'staging', label: 'Waiting / staging' },
  { key: 'accessible_routes', label: 'Accessible routes' },
];

const CONTACT_FIELDS: { key: string; label: string }[] = [
  { key: 'contact_name', label: 'Contact name' },
  { key: 'contact_role', label: 'Role' },
  { key: 'email', label: 'Business email' },
  { key: 'phone', label: 'Phone' },
];

const inputCls = 'w-full h-9 px-2.5 border border-[#e5e3e3] rounded-md text-sm text-[#171717] focus:outline-none focus:border-[#3b7a57] transition-colors duration-150';

// Shared detail drawer — opened from any view (Properties, My Day, Pipeline).
// Shows the operator context, next action, workflow controls, offers, and gaps.
export function DetailSheet() {
  const { selected, close } = useDetail();
  const data = useData();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activity, setActivity] = useState<{ actor: string; message: string; created: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getActivity(selected.id).then((a) => { if (!cancelled) setActivity(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id]);

  // Reset edit mode when the selected lot changes.
  useEffect(() => { setEditing(false); }, [selected?.id]);

  const lotCount = selected
    ? data.leads.filter((l) => l.raw.company_account_id === selected.raw.company_account_id).length
    : 0;

  function startEdit() {
    if (!selected) return;
    setDraft({
      name: selected.raw.name,
      address: selected.raw.address,
      stall_count: selected.raw.stall_count,
      hours_text: selected.raw.hours_text,
      clearance_text: selected.raw.clearance_text,
      price_text: selected.raw.price_text,
      gate_type: selected.raw.gate_type,
      ev: selected.raw.ev,
      pudo: selected.raw.pudo,
      staging: selected.raw.staging,
      accessible_routes: selected.raw.accessible_routes,
      contact_name: selected.contact_name,
      contact_role: selected.contact_role,
      email: selected.email,
      phone: selected.phone,
    });
    setEditing(true);
  }

  function save() {
    if (!selected) return;
    // Property fields → saveFields (batch to the lot).
    const propertyChanged: Record<string, string> = {};
    for (const f of EDITABLE_FIELDS) {
      if ((draft[f.key] ?? '') !== (selected.raw[f.key] ?? '')) propertyChanged[f.key] = draft[f.key] ?? '';
    }
    if ((draft.name ?? '') !== selected.raw.name) propertyChanged.name = draft.name ?? '';
    if ((draft.address ?? '') !== selected.raw.address) propertyChanged.address = draft.address ?? '';

    // Contact fields → saveContact (outreach subcollection).
    const contactChanged =
      (draft.contact_name ?? '') !== selected.contact_name ||
      (draft.contact_role ?? '') !== selected.contact_role ||
      (draft.email ?? '') !== selected.email ||
      (draft.phone ?? '') !== selected.phone;

    if (Object.keys(propertyChanged).length === 0 && !contactChanged) { setEditing(false); return; }

    startTransition(async () => {
      try {
        if (Object.keys(propertyChanged).length > 0) await saveFields(selected.id, propertyChanged);
        if (contactChanged) {
          await saveContact(selected.id, {
            name: draft.contact_name ?? '',
            role: draft.contact_role ?? '',
            email: draft.email ?? '',
            phone: draft.phone ?? '',
          });
        }
        toast.success('Saved');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
      setEditing(false);
    });
  }

  return (
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetTitle>Property workspace</SheetTitle>
          <SheetDescription>Research, review and hand off with context.</SheetDescription>
        </SheetHeader>
        {selected && (
          <div className="detail-body">
            <div className="detail-edit-bar">
              {editing ? (
                <>
                  <button onClick={save} disabled={pending} className="px-3 py-1.5 text-xs rounded-md bg-[#3b7a57] text-white hover:bg-[#2f6145] inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Check size={13} /> Save
                  </button>
                  <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717] inline-flex items-center gap-1.5">
                    <X size={13} /> Cancel
                  </button>
                </>
              ) : (
                <button onClick={startEdit} className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1.5">
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="detail-name-input" />
            ) : (
              <h2>{selected.raw.name}</h2>
            )}
            <div className="detail-topline">
              {editing ? (
                <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className={inputCls} />
              ) : (
                <span className="muted">{selected.raw.address}</span>
              )}
            </div>

            <div className="open-in-links">
              <OpenInLinks
                name={selected.raw.name}
                address={selected.raw.address}
                lat={selected.raw.lat}
                lng={selected.raw.lng}
                sourceUrl={selected.raw.source_url}
              />
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
            <EnrichmentVerify lotId={selected.id} />
            <section className="detail-section">
              <h3>Contact</h3>
              <div className="detail-info-grid">
                {CONTACT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <small>{f.label}</small>
                    {editing ? (
                      <input value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className={inputCls} />
                    ) : (
                      <span>{f.key === 'contact_name' ? (selected.contact_name || 'Decision-maker needed') : (selected[f.key as 'contact_role' | 'email' | 'phone'] || '—')}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="detail-section">
              <h3>Property details</h3>
              <div className="detail-info-grid">
                {EDITABLE_FIELDS.map((f) => (
                  <div key={f.key}>
                    <small>{f.label}</small>
                    {editing ? (
                      <input value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className={inputCls} />
                    ) : (
                      <span>{selected.raw[f.key] || '—'}</span>
                    )}
                  </div>
                ))}
                <div><small>Owner</small><span>{selected.property_details?.owner || '—'}</span></div>
                <div><small>Operator</small><span>{selected.property_details?.operator || '—'}</span></div>
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