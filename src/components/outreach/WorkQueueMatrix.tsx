'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, CircleDashed } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { saveField } from '@/lib/outreach/actions';

// The 7-field checklist as a dense matrix — all fields visible at once, a
// single cursor on the first unverified field. Y/N/S for tri-state, inline
// input for text. No pagination, no walls of text.
type FieldDef = {
  key: string;
  label: string;
  kind: 'tri' | 'number' | 'text';
  raw: string;
};

const FIELDS: FieldDef[] = [
  { key: 'stall_count', label: 'Stalls', kind: 'number', raw: 'stall_count' },
  { key: 'is_24_7', label: '24/7 access', kind: 'tri', raw: 'is_24_7' },
  { key: 'is_fenced', label: 'Fenced', kind: 'tri', raw: 'is_fenced' },
  { key: 'is_lit', label: 'Lit', kind: 'tri', raw: 'is_lit' },
  { key: 'ingress_egress', label: 'Ingress/egress', kind: 'text', raw: 'ingress_egress' },
  { key: 'clearance_text', label: 'Clearance', kind: 'text', raw: 'clearance_text' },
  { key: 'price_text', label: 'Rates & hours', kind: 'text', raw: 'price_text' },
];

function valueOf(lead: Lead, f: FieldDef): string {
  return lead.raw[f.raw] ?? '';
}

function isDone(lead: Lead, f: FieldDef): boolean {
  return valueOf(lead, f).trim() !== '';
}

export function WorkQueueMatrix({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const firstOpen = FIELDS.find((f) => !isDone(lead, f))?.key;

  function run(field: string, value: string | number | boolean | null, ok: string) {
    startTransition(async () => {
      try {
        await saveField(lead.id, field, value);
        toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  function commitText(f: FieldDef) {
    const v = draft.trim();
    if (!v) return;
    run(f.key, v, `${f.label} saved`);
    setEditing(null);
    setDraft('');
  }

  return (
    <div className="wq-matrix">
      {FIELDS.map((f, i) => {
        const done = isDone(lead, f);
        const val = valueOf(lead, f);
        const active = f.key === firstOpen;
        return (
          <div key={f.key} className={'wq-row' + (active ? ' active' : '')}>
            <span className="wq-idx">{i + 1}</span>
            <span className="wq-label">{f.label}</span>
            <span className="wq-value">
              {done ? (
                <span className="wq-confirmed">
                  {f.kind === 'tri' ? (val === 'yes' ? 'Yes' : val === 'no' ? 'No' : val) : val}
                </span>
              ) : (
                <span className="wq-unknown">Unknown</span>
              )}
            </span>
            <span className="wq-action">
              {f.kind === 'tri' ? (
                <>
                  <button disabled={pending} onClick={() => run(f.key, true, `${f.label} → Yes`)} className="wq-btn yes">Y</button>
                  <button disabled={pending} onClick={() => run(f.key, false, `${f.label} → No`)} className="wq-btn no">N</button>
                  <button disabled={pending} onClick={() => run(f.key, null, `${f.label} skipped`)} className="wq-btn skip">S</button>
                </>
              ) : editing === f.key ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitText(f); if (e.key === 'Escape') setEditing(null); }}
                    placeholder={f.kind === 'number' ? 'e.g. 200' : 'value'}
                    className="wq-input"
                  />
                  <button disabled={pending} onClick={() => commitText(f)} className="wq-btn save">✓</button>
                </>
              ) : (
                <button
                  disabled={pending}
                  onClick={() => { setEditing(f.key); setDraft(val); }}
                  className="wq-btn edit"
                >
                  {done ? 'Edit' : 'Fill'}
                </button>
              )}
            </span>
            <span className="wq-status">
              {done ? <Check size={14} className="text-[#3b7a57]" /> : <CircleDashed size={14} className="text-[#6b6868]" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}