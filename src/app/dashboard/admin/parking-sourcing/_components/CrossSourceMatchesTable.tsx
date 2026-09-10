'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CrossSourceVerdict } from '@/lib/sourcing/parkopediaParse';
import { cn } from '@/lib/utils';
import { mergeSourcedLocations } from '../actions';

export interface CrossSourceCandidate {
  primaryId: string;
  primaryName: string;
  primaryUrl: string;
  secondaryId: string;
  secondaryName: string;
  secondaryUrl: string;
  distanceMeters: number;
  addressSimilarity: number;
  verdict: CrossSourceVerdict;
}

type Toast = { type: 'success' | 'error'; message: string };

function VerdictBadge({ verdict }: { verdict: CrossSourceVerdict }) {
  return (
    <span
      className={cn(
        'text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap',
        verdict === 'confident'
          ? 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]'
          : 'bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a]',
      )}
    >
      {verdict}
    </span>
  );
}

function ConfirmMergeDialog({
  candidate,
  onConfirm,
  onClose,
}: {
  candidate: CrossSourceCandidate;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge these records?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-sm text-[#0e1c36]/70">
          Merge <span className="font-medium text-[#0e1c36]">{candidate.secondaryName}</span> into{' '}
          <span className="font-medium text-[#0e1c36]">{candidate.primaryName}</span>? The secondary record is kept
          and marked as merged, never deleted.
        </DialogDescription>
        {candidate.verdict === 'ambiguous' && (
          <p className="text-xs text-[#8a6d1a]">
            Address match is weak — review both listings before merging.
          </p>
        )}
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-3 py-1.5 text-sm text-white rounded',
              candidate.verdict === 'confident' ? 'bg-[#1a5a2a] hover:bg-[#144320]' : 'bg-[#8a6d1a] hover:bg-[#6e5714]',
            )}
          >
            Merge
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CrossSourceMatchesTable({ initialCandidates }: { initialCandidates: CrossSourceCandidate[] }) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [confirming, setConfirming] = useState<CrossSourceCandidate | null>(null);
  const [isPending, startTransition] = useTransition();

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  const handleMerge = (candidate: CrossSourceCandidate) => {
    setConfirming(null);
    startTransition(async () => {
      try {
        await mergeSourcedLocations(candidate.primaryId, candidate.secondaryId);
        setCandidates((prev) => prev.filter((c) => c.secondaryId !== candidate.secondaryId));
        showToast({ type: 'success', message: `Merged ${candidate.secondaryName} into ${candidate.primaryName}` });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to merge' });
      }
    });
  };

  if (candidates.length === 0) return null;

  return (
    <div className="mb-8">
      {confirming && (
        <ConfirmMergeDialog candidate={confirming} onConfirm={() => handleMerge(confirming)} onClose={() => setConfirming(null)} />
      )}

      <h2 className="text-sm font-semibold text-[#0e1c36] mb-1">Cross-source matches</h2>
      <p className="text-xs text-[#0e1c36]/50 mb-3">
        {candidates.length} likely duplicate{candidates.length === 1 ? '' : 's'} between SpotHero and Parkopedia.
      </p>

      <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
              {['Primary (SpotHero)', 'Secondary (Parkopedia)', 'Distance', 'Similarity', 'Verdict', ''].map((h) => (
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
            {candidates.map((c) => (
              <tr key={`${c.primaryId}::${c.secondaryId}`} className="hover:bg-[#0e1c36]/[.02]">
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <a href={c.primaryUrl} target="_blank" rel="noreferrer" className="text-[#0e1c36] hover:text-[#1a3a7a] hover:underline">
                    {c.primaryName}
                  </a>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <a href={c.secondaryUrl} target="_blank" rel="noreferrer" className="text-[#0e1c36] hover:text-[#1a3a7a] hover:underline">
                    {c.secondaryName}
                  </a>
                </td>
                <td className="px-3 py-2 text-xs text-[#0e1c36]/60 whitespace-nowrap">{c.distanceMeters.toFixed(1)}m</td>
                <td className="px-3 py-2 text-xs text-[#0e1c36]/60 whitespace-nowrap">{c.addressSimilarity.toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <VerdictBadge verdict={c.verdict} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    onClick={() => setConfirming(c)}
                    disabled={isPending}
                    className={cn(
                      'px-2 py-1 rounded text-[9px] border disabled:opacity-50',
                      c.verdict === 'confident'
                        ? 'text-[#1a5a2a] bg-[#dff5e1] border-[#c8ecc9] hover:bg-[#c8ecc9]'
                        : 'text-[#8a6d1a] bg-[#fdf3d8] border-[#f0dfa0] hover:bg-[#f0dfa0]',
                    )}
                  >
                    Merge
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
