'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useData } from '@/components/outreach/DataContext';
import { isActive, propertyValue } from '@/lib/outreach/workflow';
import { WorkQueueMatrix } from '@/components/outreach/WorkQueueMatrix';

export function WorkQueueView() {
  const data = useData();
  const [wqId, setWqId] = useState<string | null>(null);

  const draftLots = data.leads.filter((l) => isActive(l) && l.raw.status === 'draft');
  const current = draftLots.find((l) => l.id === wqId) ?? draftLots[0];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> PIPELINE</div>
          <h1>Fill the field.</h1>
          <p>Work the 7-field checklist, one lot at a time.</p>
        </div>
      </div>
      <div className="queue-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Work Queue <span className="count">{draftLots.length}</span></h2>
              <p>Draft lots needing the 7-field checklist.</p>
            </div>
          </div>
          <div className="wq-picker">
            {draftLots.map((l) => (
              <button key={l.id} onClick={() => setWqId(l.id)} className={'wq-pick' + (l.id === current?.id ? ' active' : '')}>
                <span className="truncate">{l.raw.name}</span>
                <span className="wq-pick-meta">{propertyValue(l, 'operator')}</span>
              </button>
            ))}
            {draftLots.length === 0 && (
              <div className="empty-state"><Check /><h3>Nothing in the queue</h3><p>Every draft lot has been worked.</p></div>
            )}
          </div>
        </section>
        <section className="panel">
          {current ? (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{current.raw.name}</h2>
                  <p className="muted">{current.raw.address} · {propertyValue(current, 'operator')}</p>
                </div>
              </div>
              <div className="p-4"><WorkQueueMatrix lead={current} /></div>
            </>
          ) : (
            <div className="empty-state"><Check /><h3>All caught up</h3><p>No draft lots to work.</p></div>
          )}
        </section>
      </div>
    </>
  );
}