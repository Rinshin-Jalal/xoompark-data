'use client';

// Shared "Localities" tracker section — rendered above both the admin table
// and the BDR queue (ParkingSourcingModeView wires it up once and filters
// whichever child view is currently showing). Pure presentation over
// localityStats (lib/sourcing/locality.ts); no parallel record-rendering —
// selecting a row just narrows the `locations` array the existing
// SourcingReviewTable/BdrQueueView already render.
import { localityStats } from '@/lib/sourcing/locality';
import type { SourcedParkingLocation } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';

export function LocalitiesTracker({
  locations,
  selected,
  onSelect,
}: {
  /** Always the FULL unfiltered set — stats must reflect every locality
   * regardless of which one is currently selected. */
  locations: SourcedParkingLocation[];
  selected: string | null;
  onSelect: (locality: string | null) => void;
}) {
  const stats = localityStats(locations);

  return (
    <div className="mb-6 border border-[#0e1c36]/12 bg-white">
      <div className="px-4 py-2.5 border-b border-[#0e1c36]/10 bg-[#f9fbf2] flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-[#0e1c36]/40">
          Localities
        </span>
        {selected && (
          <button
            onClick={() => onSelect(null)}
            className="text-xs font-mono uppercase tracking-[.06em] text-[#1a3a7a] hover:underline"
          >
            Clear filter ({selected}) ✕
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0e1c36]/10">
              {['Locality', 'Lots', 'Enriched', 'Saved', ''].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0e1c36]/8">
            {stats.map((s) => (
              <tr
                key={s.locality}
                onClick={() => onSelect(selected === s.locality ? null : s.locality)}
                title="Click to filter to this locality"
                className={cn(
                  'cursor-pointer hover:bg-[#0e1c36]/[.02]',
                  selected === s.locality && 'bg-[#afcbff]/20',
                )}
              >
                <td className="px-3 py-2 text-xs text-[#0e1c36] whitespace-nowrap">{s.locality}</td>
                <td className="px-3 py-2 text-xs text-[#0e1c36]/70 whitespace-nowrap">{s.lotCount}</td>
                <td className="px-3 py-2 text-xs text-[#0e1c36]/70 whitespace-nowrap">{s.enrichedCount}</td>
                <td className="px-3 py-2 text-xs text-[#0e1c36]/70 whitespace-nowrap">{s.savedCount}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {s.needsHunt && (
                    <span className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a]">
                      hunt needed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
