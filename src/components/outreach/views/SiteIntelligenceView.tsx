'use client';

import { useMemo } from 'react';
import { useData } from '@/components/outreach/DataContext';
import { isActive, stages } from '@/lib/outreach/workflow';
import { StatCards } from '@/components/spectrumui/charts/stat-cards';

export function SiteIntelligenceView() {
  const data = useData();
  const active = data.leads.filter(isActive);

  const counts = Object.fromEntries(Object.keys(stages).map((s) => [s, active.filter((l) => l.stage === s).length]));

  const byLocality = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of active) {
      const loc = l.raw.locality || 'Unassigned';
      map.set(loc, (map.get(loc) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [active]);

  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of active) {
      const src = l.raw.source_name || 'unknown';
      map.set(src, (map.get(src) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const maxLocality = byLocality[0]?.[1] ?? 1;
  const maxSource = bySource[0]?.[1] ?? 1;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> INTELLIGENCE</div>
          <h1>Understand the site.</h1>
          <p>Coverage, funnel and pipeline across the whole supply motion.</p>
        </div>
      </div>

      <div className="mb-7">
        <StatCards
          columns={4}
          cards={[
            { label: 'Properties in scope', value: active.length, caption: 'Active inventory' },
            { label: 'Need research', value: counts.research + counts.verify, caption: 'Checklist + contact' },
            { label: 'In outreach', value: counts.ready + counts.email_followup + counts.email_reply + counts.sdr + counts.followup, caption: 'Email + call' },
            { label: 'Qualified', value: counts.qualified, caption: 'Ready for proposal' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel">
          <div className="panel-heading">
            <div><h2>Coverage by locality</h2><p>Top 10 localities by lot count.</p></div>
          </div>
          <div className="p-4 space-y-2">
            {byLocality.map(([loc, n]) => (
              <div key={loc} className="flex items-center gap-3">
                <span className="w-32 truncate text-sm text-[#171717]">{loc}</span>
                <div className="flex-1 h-2 bg-[#f5f4f4] rounded-md overflow-hidden">
                  <div className="h-full bg-[#3b7a57]" style={{ width: `${(n / maxLocality) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-sm text-[#6b6868]">{n}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><h2>Coverage by source</h2><p>Where lots came from.</p></div>
          </div>
          <div className="p-4 space-y-2">
            {bySource.map(([src, n]) => (
              <div key={src} className="flex items-center gap-3">
                <span className="w-32 truncate text-sm text-[#171717]">{src}</span>
                <div className="flex-1 h-2 bg-[#f5f4f4] rounded-md overflow-hidden">
                  <div className="h-full bg-[#3b7a57]" style={{ width: `${(n / maxSource) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-sm text-[#6b6868]">{n}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <div className="panel-heading">
          <div><h2>Outreach funnel</h2><p>Lots by stage, from research to qualified.</p></div>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(stages).map(([key, label]) => (
            <div key={key} className="border border-[#e5e3e3] rounded-lg p-4">
              <div className="text-[13px] text-[#6b6868]">{label}</div>
              <div className="text-2xl font-medium text-[#171717] mt-1">{counts[key]}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}