'use client';

import { useState } from 'react';
import { KanbanSquare } from 'lucide-react';
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, type BDProspect } from '@/lib/pipeline/types';
import { ProspectCard } from '@/components/pipeline/ProspectCard';
import { ProspectDetailSheet } from '@/components/pipeline/ProspectDetailSheet';

export function PipelineKanban({ prospects }: { prospects: BDProspect[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (prospects.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          <KanbanSquare size={34} />
          <h3>No BD prospects yet</h3>
          <p>Promote a sourced lot from Outreach to create your first deal.</p>
        </div>
      </div>
    );
  }

  // Derive from props so a stage move refreshes the open sheet too.
  const selected = prospects.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <div className="kanban">
        {PIPELINE_STAGES.map((stage) => {
          const cards = prospects.filter((p) => p.stage === stage);
          const stalls = cards.reduce((sum, p) => sum + (p.total_stalls_in_deal ?? 0), 0);
          return (
            <div key={stage} className="kanban-column">
              <h2>
                {PIPELINE_STAGE_LABELS[stage]}
                <span>{cards.length} · {stalls} stalls</span>
              </h2>
              {cards.length === 0 ? (
                <div style={{ border: '1px dashed #d3dcdf', borderRadius: 8, padding: '22px 12px', textAlign: 'center', fontSize: 11, color: '#a3b1b8' }}>
                  No deals in {PIPELINE_STAGE_LABELS[stage].toLowerCase()}
                </div>
              ) : (
                cards.map((p) => <ProspectCard key={p.id} prospect={p} onOpen={() => setSelectedId(p.id)} />)
              )}
            </div>
          );
        })}
      </div>
      <ProspectDetailSheet prospect={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
