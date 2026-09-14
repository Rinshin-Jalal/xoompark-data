'use client';

import { useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { propertyValue, priority, priorities } from '@/lib/outreach/workflow';

// Portfolio view: lots grouped by operator. One card = one commercial
// relationship ("SP+ · 14 lots · 480 stalls"), expandable to the child lots.
// This is the operator-centric unit the experts flagged as the highest-value
// structural change — you sell portfolios, not individual lots.
export function PipelinePortfolio({ leads, onSelect }: { leads: Lead[]; onSelect: (l: Lead) => void }) {
  const [open, setOpen] = useState<string | null>(null);

  const portfolios = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of leads) {
      const op = propertyValue(l, 'operator') || 'Unknown operator';
      if (!map.has(op)) map.set(op, []);
      map.get(op)!.push(l);
    }
    return [...map.entries()]
      .map(([operator, lots]) => ({
        operator,
        lots,
        stalls: lots.reduce((sum, l) => sum + (parseInt(l.raw.stall_count, 10) || 0), 0),
        contact: lots.find((l) => l.contact_name)?.contact_name ?? '',
      }))
      .sort((a, b) => b.lots.length - a.lots.length);
  }, [leads]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {portfolios.map((p) => {
        const isOpen = open === p.operator;
        return (
          <div key={p.operator} className="portfolio-card">
            <button className="portfolio-head" onClick={() => setOpen(isOpen ? null : p.operator)}>
              <div className="flex items-center gap-2 min-w-0">
                <Building2 size={16} className="text-[#3b7a57] shrink-0" />
                <span className="font-semibold text-[#171717] truncate">{p.operator}</span>
              </div>
              <span className="text-xs text-[#6b6868] shrink-0">
                {p.lots.length} lots · {p.stalls} stalls
              </span>
              {isOpen ? <ChevronDown size={15} className="text-[#6b6868] shrink-0" /> : <ChevronRight size={15} className="text-[#6b6868] shrink-0" />}
            </button>

            {p.contact && (
              <div className="portfolio-contact">👤 {p.contact}</div>
            )}

            {isOpen && (
              <div className="portfolio-lots">
                {p.lots.map((l) => (
                  <button key={l.id} className="portfolio-lot" onClick={() => onSelect(l)}>
                    <span className="truncate">{l.raw.name}</span>
                    <span className="text-xs text-[#6b6868] shrink-0">
                      {l.raw.stall_count ? `${l.raw.stall_count} stalls` : ''} · {priorities[priority(l) - 1]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {portfolios.length === 0 && (
        <div className="empty-state col-span-full">
          <Building2 />
          <h3>No portfolios yet</h3>
          <p>Lots will group by operator as they're sourced.</p>
        </div>
      )}
    </div>
  );
}