'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { oddZoneAt } from '@/lib/odd/odd';
import type { SourceLocationTag, TaggedSourceLocation } from '@/lib/sourcing/sourceUrlFetch';
import type { SourcedLocationInput } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';
import { importParsedSourceLocations, parseSourceUrl } from '../actions';

// Real network fetch (unlike PasteHtmlButton, which parses HTML the admin
// already pasted in) — classifies the URL (spothero-listing/facility,
// parkopedia-listing/location) and routes through the matching adapter's
// existing pure parse/map logic via sourceUrlFetch.ts, then the same
// dedupe-tag step every capture surface uses. No new write path: Import
// selected goes through importParsedSourceLocations -> upsertSourcedLocation,
// same as every other adapter.

type Toast = { type: 'success' | 'error'; message: string };
type ResultRow = TaggedSourceLocation & { selected: boolean };

function tagBadgeClasses(tag: SourceLocationTag) {
  if (tag === 'NEW') return 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]';
  if (tag === 'EXISTS') return 'bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a]';
  return 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60';
}

function priceOrHours(row: TaggedSourceLocation): string {
  return [row.priceText, row.hoursText].filter(Boolean).join(' / ') || '—';
}

/** At-capture-time ODD check, reusing oddZoneAt (same real Waymo service-area
 * polygons charging-sites checks against — see src/lib/odd/odd.ts) for both
 * the in/out verdict and the metro name. null when no lat/lng came back with
 * this source's fetch — most adapters don't scrape coordinates. */
function OddCaptureBadge({ row }: { row: TaggedSourceLocation }) {
  if (row.lat === undefined || row.lng === undefined) return null;
  const zone = oddZoneAt(row.lat, row.lng, 'waymo');
  return (
    <span
      title={zone ? `In Waymo ODD — ${zone.metro}` : 'Outside the Waymo ODD'}
      className={cn(
        'ml-1 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border whitespace-nowrap',
        zone
          ? 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]'
          : 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/40',
      )}
    >
      {zone ? `odd · ${zone.metro}` : 'outside odd'}
    </span>
  );
}

export function PasteUrlButton({
  locality,
  onStage,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Stamped onto each staged row — same convention as AddLocationButton's
   * `locality` prop. */
  locality?: string;
  /** When set, "Stage selected" replaces "Import selected" — hands the
   * selected rows (already the full SourcedLocationInput shape, real
   * source/sourceListingId included) to this callback instead of writing to
   * Firestore immediately. */
  onStage?: (rows: SourcedLocationInput[]) => void;
  /** Controlled open — when set, the internal trigger button is hidden and
   * the dialog opens from outside (e.g. the Add-lot dropdown menu). */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
} = {}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [url, setUrl] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [isFetching, startFetching] = useTransition();
  const [isImporting, startImporting] = useTransition();

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  const handleClose = () => {
    setOpen(false);
    setUrl('');
    setFetchError(null);
    setResults(null);
  };

  const handleFetch = () => {
    setFetchError(null);
    startFetching(async () => {
      const res = await parseSourceUrl(url);
      if (!res.ok) {
        setFetchError(res.error);
        setResults(null);
        return;
      }
      setResults(res.results.map((r) => ({ ...r, selected: r.tag === 'NEW' })));
    });
  };

  const toggleRow = (dedupeKey: string, index: number) => {
    setResults((prev) =>
      prev?.map((r, i) => ((r.dedupeKey === dedupeKey && i === index) ? { ...r, selected: !r.selected } : r)) ?? null,
    );
  };

  const handleImport = () => {
    if (!results) return;
    const selected = results.filter((r) => r.selected);
    if (onStage) {
      onStage(selected.map((r) => ({ ...r, locality })));
      handleClose();
      return;
    }
    startImporting(async () => {
      const res = await importParsedSourceLocations(selected);
      if (!res.ok) {
        showToast({ type: 'error', message: res.error });
        return;
      }
      showToast({
        type: 'success',
        message: `Imported ${res.imported} · merged ${res.merged} · skipped ${res.skipped}`,
      });
      handleClose();
      router.refresh();
    });
  };

  const selectedCount = results?.filter((r) => r.selected).length ?? 0;

  return (
    <>


      {controlledOpen === undefined && (
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs font-mono uppercase tracking-[.08em] bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]"
        >
          Paste URL
        </button>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Paste URL</DialogTitle>
            <DialogDescription>
              Paste a URL from any connected source (SpotHero, Parkopedia, or one of 14 other Miami/university/partner
              sources) — auto-detected from the URL. Fetched live from the source.
              {onStage && ' Nothing writes to the database until "Save all" in step 4.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Source URL *</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://spothero.com/destination/miami/... or https://en.parkopedia.com/parking/..."
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                />
              </div>
              {fetchError && <p className="text-xs text-[#c1121f]">{fetchError}</p>}

              <div className="flex justify-end">
                <button
                  onClick={handleFetch}
                  disabled={isFetching || !url.trim()}
                  className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
                >
                  {isFetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>

              {results && (
                <div>
                  {results.length === 0 ? (
                    <p className="text-xs text-[#0e1c36]/50 py-3">No facilities found at that URL.</p>
                  ) : (
                    <div className="border border-[#0e1c36]/12 rounded overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
                            {['', 'Name', 'Address', 'Price / hours', 'Tag'].map((h) => (
                              <th
                                key={h}
                                className="px-2 py-1.5 text-left font-mono text-[9px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40 whitespace-nowrap"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#0e1c36]/8">
                          {results.map((r, i) => (
                            <tr key={`${r.dedupeKey}-${i}`}>
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={r.selected}
                                  onChange={() => toggleRow(r.dedupeKey, i)}
                                />
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{r.name}</td>
                              <td className="px-2 py-1.5 max-w-[10rem] truncate">{r.address || '—'}</td>
                              <td className="px-2 py-1.5 max-w-[10rem] truncate">{priceOrHours(r)}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span
                                  className={cn(
                                    'text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border',
                                    tagBadgeClasses(r.tag),
                                  )}
                                >
                                  {r.tag}
                                </span>
                                <OddCaptureBadge row={r} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button onClick={handleClose} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
                Close
              </button>
              {results && results.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={isImporting || selectedCount === 0}
                  className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
                >
                  {isImporting ? 'Importing…' : onStage ? `Stage selected (${selectedCount})` : `Import selected (${selectedCount})`}
                </button>
              )}
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
