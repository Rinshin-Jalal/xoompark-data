'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { moveProspectStage } from '@/lib/outreach/actions';
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, type BDProspect, type ProspectStage } from '@/lib/pipeline/types';

export function ProspectCard({ prospect, onOpen }: { prospect: BDProspect; onOpen: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function move(stage: string) {
    startTransition(async () => {
      try {
        await moveProspectStage(prospect.id, stage as ProspectStage);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to move stage');
      }
    });
  }

  return (
    <div className="kanban-card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span
          className="pill"
          style={prospect.deal_type === 'portfolio_master_agreement' ? { color: '#328266', background: '#edf7f1' } : { color: '#657e8a', background: '#f5f4f4' }}
        >
          {prospect.deal_type === 'portfolio_master_agreement' ? 'Portfolio' : 'Single'}
        </span>
        <small>
          {prospect.total_stalls_in_deal ?? '—'} stalls{prospect.city ? ` · ${prospect.city}` : ''}
        </small>
      </div>
      <h3>{prospect.companyName}</h3>
      <p>
        {prospect.contactName || 'No contact'}
        {prospect.contactTitle ? ` · ${prospect.contactTitle}` : ''}
      </p>
      <footer>
        <span>{prospect.assignedTo || 'Unassigned'}</span>
        <select
          value={prospect.stage}
          disabled={pending}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => move(e.target.value)}
          style={{ marginLeft: 'auto', fontSize: 11, border: '1px solid #e0e7e9', borderRadius: 6, padding: '3px 4px', background: '#fff', color: '#171717' }}
        >
          {PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>
              {PIPELINE_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </footer>
    </div>
  );
}
