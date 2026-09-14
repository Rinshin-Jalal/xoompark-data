'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EyeOff, Archive, RotateCcw, ShieldX } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { OUTREACH_STATES, OUTREACH_STATE_LABELS } from '@/lib/sourcing/types';
import type { OutreachState } from '@/lib/sourcing/types';
import { advanceStage, setPriority, setVisibility, disqualifyLot, restoreLot, createProspectFromLot, enrichLot } from '@/lib/outreach/actions';

// The outreach state machine, mapped to the Lead's derived stage. Shows the
// current state and one-tap advance buttons. Writes via server actions.
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

  return (
    <section className="detail-section">
      <h3>Workflow</h3>

      <div className="detail-actions">
        {OUTREACH_STATES.map((s) => (
          <button
            key={s}
            disabled={pending}
            onClick={() => run(() => advanceStage(lead.id, s), `Stage → ${OUTREACH_STATE_LABELS[s]}`)}
            className={
              current === s
                ? 'px-3 py-1.5 text-xs rounded-md bg-[#111] text-white'
                : 'px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57]'
            }
          >
            {OUTREACH_STATE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="detail-actions" style={{ marginTop: 12 }}>
        {[1, 2, 3, 4].map((p) => (
          <button
            key={p}
            disabled={pending}
            onClick={() => run(() => setPriority(lead.id, p), `Priority → ${p}`)}
            className={
              lead.priority_rating === p
                ? 'px-3 py-1.5 text-xs rounded-md bg-[#171717] text-white'
                : 'px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717]'
            }
          >
            P{p}
          </button>
        ))}
      </div>

      <div className="detail-actions" style={{ marginTop: 12 }}>
        {['responded', 'quoted'].includes(lead.stage) && (
          <button
            disabled={pending}
            onClick={() => run(() => createProspectFromLot(lead.id).then(() => {}), 'Promoted to prospect')}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3b7a57] text-white hover:bg-[#2f6145] inline-flex items-center gap-1"
          >
            Promote to Deal →
          </button>
        )}
        <button
          disabled={pending}
          onClick={() => run(() => enrichLot(lead.id).then(() => {}), 'Enrichment started')}
          className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1"
        >
          Enrich
        </button>
      </div>

      <div className="detail-actions" style={{ marginTop: 12 }}>
        {lead.visibility === 'active' || !lead.visibility ? (
          <>
            <button
              disabled={pending}
              onClick={() => run(() => setVisibility(lead.id, 'hidden'), 'Hidden')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717] inline-flex items-center gap-1"
            >
              <EyeOff size={13} /> Hide
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => setVisibility(lead.id, 'archived'), 'Archived')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#171717] inline-flex items-center gap-1"
            >
              <Archive size={13} /> Archive
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => disqualifyLot(lead.id, 'manual'), 'Disqualified')}
              className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#b63232] hover:border-[#b63232] inline-flex items-center gap-1"
            >
              <ShieldX size={13} /> Disqualify
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            onClick={() => run(() => restoreLot(lead.id), 'Restored')}
            className="px-3 py-1.5 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1"
          >
            <RotateCcw size={13} /> Restore
          </button>
        )}
      </div>
    </section>
  );
}