'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EyeOff, Archive, RotateCcw, ShieldX, Sparkles, ArrowRight } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { OUTREACH_STATES, OUTREACH_STATE_LABELS } from '@/lib/sourcing/types';
import type { OutreachState } from '@/lib/sourcing/types';
import { advanceStage, setPriority, setVisibility, disqualifyLot, restoreLot, createProspectFromLot, enrichLot } from '@/lib/outreach/actions';

const PRIORITY_LABELS = ['Highest', 'High', 'Medium', 'Low'];

// The outreach state machine + priority + actions. Stage and priority are
// selects (not button walls); actions are clearly labelled buttons.
export function DetailWorkflow({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const current = (OUTREACH_STATES as readonly string[]).includes(lead.stage)
    ? (lead.stage as OutreachState)
    : null;

  function run(fn: () => Promise<void>, ok: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  const selectCls = 'w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717] focus:outline-none focus:border-[#3b7a57] transition-colors duration-150';

  return (
    <section className="detail-section">
      <h3>Workflow</h3>

      <div className="form-grid">
        <label>
          <span className="text-xs text-[#6b6868]">Stage</span>
          <select
            value={current ?? ''}
            disabled={pending}
            onChange={(e) => run(() => advanceStage(lead.id, e.target.value as OutreachState), `Stage → ${OUTREACH_STATE_LABELS[e.target.value as OutreachState]}`)}
            className={selectCls}
          >
            <option value="" disabled>Select stage…</option>
            {OUTREACH_STATES.map((s) => (
              <option key={s} value={s}>{OUTREACH_STATE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs text-[#6b6868]">Priority</span>
          <select
            value={lead.priority_rating ?? ''}
            disabled={pending}
            onChange={(e) => run(() => setPriority(lead.id, Number(e.target.value)), `Priority → P${e.target.value}`)}
            className={selectCls}
          >
            <option value="" disabled>Select priority…</option>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>P{p} · {PRIORITY_LABELS[p - 1]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="detail-actions">
        {['responded', 'quoted'].includes(lead.stage) && (
          <button
            disabled={pending}
            onClick={() => run(() => createProspectFromLot(lead.id).then(() => {}), 'Promoted to prospect')}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3b7a57] text-white hover:bg-[#2f6145] inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            Promote to Deal <ArrowRight size={13} />
          </button>
        )}
        <button
          disabled={pending}
          onClick={() => run(() => enrichLot(lead.id).then(() => {}), 'Enrichment started')}
          className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          <Sparkles size={13} /> Enrich
        </button>
      </div>

      <div className="detail-actions">
        {lead.visibility === 'active' || !lead.visibility ? (
          <>
            <button
              disabled={pending}
              onClick={() => run(() => setVisibility(lead.id, 'hidden'), 'Hidden')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717] inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <EyeOff size={13} /> Hide
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => setVisibility(lead.id, 'archived'), 'Archived')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717] inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Archive size={13} /> Archive
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => disqualifyLot(lead.id, 'manual'), 'Disqualified')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#b63232] hover:border-[#b63232] inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <ShieldX size={13} /> Disqualify
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            onClick={() => run(() => restoreLot(lead.id), 'Restored')}
            className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <RotateCcw size={13} /> Restore
          </button>
        )}
      </div>
    </section>
  );
}