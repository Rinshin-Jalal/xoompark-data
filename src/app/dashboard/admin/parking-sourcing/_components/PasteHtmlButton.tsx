'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AddLocationFormInput } from '@/lib/sourcing/addLocation';
import type { CaptureTag, ExtractedFacility, TaggedFacility } from '@/lib/sourcing/extensionCapture';
import { cn } from '@/lib/utils';
import { importPastedFacilities, parsePastedHtml } from '../actions';

/** ExtractedFacility's fields (name/address/priceText/hoursText/
 * capacityText/clearanceText) are a strict subset of AddLocationFormInput's
 * — a lossless conversion, so a staged paste-derived row can sit in the
 * exact same list as a hand-typed one and get written the exact same way
 * (addSourcedLocation) at "Save all" time. */
function facilityToFormInput(row: ExtractedFacility, sourceUrl: string, locality?: string): AddLocationFormInput {
  return {
    name: row.name,
    sourceUrl,
    address: row.address ?? '',
    lat: '',
    lng: '',
    priceText: row.priceText ?? '',
    hoursText: row.hoursText ?? '',
    capacityText: row.capacityText ?? '',
    clearanceText: row.clearanceText ?? '',
    ingressEgress: '',
    notes: '',
    addedBy: '',
    locality,
  };
}

// Regex-based extraction (no LLM, no network call — the admin already has
// the exact HTML in hand) via parsePastedFacilities in capture.ts, then the
// same dedupe-tag step the Chrome extension's pipeline uses. This panel is
// the "inspect element -> copy HTML -> paste -> import" front door inside
// the portal, no extension required. No new write path: Import selected
// goes through importPastedFacilities -> upsertSourcedLocation, same as
// every other adapter.

type Toast = { type: 'success' | 'error'; message: string };
type ResultRow = TaggedFacility & { selected: boolean };

function tagBadgeClasses(tag: CaptureTag) {
  if (tag === 'NEW') return 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]';
  if (tag === 'EXISTS') return 'bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a]';
  return 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60';
}

function priceOrCapacity(row: ExtractedFacility): string {
  if (row.priceText || row.hoursText) {
    return [row.priceText, row.hoursText].filter(Boolean).join(' / ');
  }
  return [row.capacityText, row.clearanceText].filter(Boolean).join(' / ') || '—';
}

export function PasteHtmlButton({
  locality,
  onStage,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Passed through to each staged row so it carries the same locality
   * every other Hunt-staged lot does — same convention as
   * AddLocationButton's `locality` prop. */
  locality?: string;
  /** When set, "Stage selected" replaces "Import selected" — converts the
   * selected rows to AddLocationFormInput and hands them to this callback
   * instead of writing to Firestore immediately. */
  onStage?: (rows: AddLocationFormInput[]) => void;
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
  const [htmlText, setHtmlText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [isParsing, startParsing] = useTransition();
  const [isImporting, startImporting] = useTransition();

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  const handleClose = () => {
    setOpen(false);
    setHtmlText('');
    setSourceUrl('');
    setParseError(null);
    setResults(null);
  };

  const handleParse = () => {
    setParseError(null);
    startParsing(async () => {
      const res = await parsePastedHtml(htmlText, sourceUrl);
      if (!res.ok) {
        setParseError(res.error);
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
      onStage(selected.map((r) => facilityToFormInput(r, sourceUrl, locality)));
      handleClose();
      return;
    }
    startImporting(async () => {
      const res = await importPastedFacilities(selected, sourceUrl);
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
          Paste HTML
        </button>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Paste HTML</DialogTitle>
            <DialogDescription>
              Inspect element on a listing page, copy the HTML, paste it below — parsed with plain pattern
              matching, no external API. Review the fields before {onStage ? 'staging' : 'importing'}.
              {onStage && ' Nothing writes to the database until "Save all" in step 4.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Source URL *</label>
                <input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://example.com/parking-listing"
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Pasted HTML / text *</label>
                <textarea
                  value={htmlText}
                  onChange={(e) => setHtmlText(e.target.value)}
                  rows={10}
                  placeholder="Paste copied HTML (or plain text) here"
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-xs font-mono resize-y"
                />
              </div>
              {parseError && <p className="text-xs text-[#c1121f]">{parseError}</p>}

              <div className="flex justify-end">
                <button
                  onClick={handleParse}
                  disabled={isParsing || !htmlText.trim() || !sourceUrl.trim()}
                  className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
                >
                  {isParsing ? 'Parsing…' : 'Parse'}
                </button>
              </div>

              {results && (
                <div>
                  {results.length === 0 ? (
                    <p className="text-xs text-[#0e1c36]/50 py-3">No facilities found in that HTML.</p>
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
                              <td className="px-2 py-1.5 max-w-[10rem] truncate">{priceOrCapacity(r)}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                <span
                                  className={cn(
                                    'text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border',
                                    tagBadgeClasses(r.tag),
                                  )}
                                >
                                  {r.tag}
                                </span>
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
