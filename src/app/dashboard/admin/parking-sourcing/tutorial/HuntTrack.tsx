'use client';

// Hunt track — mirrors docs/bdr-workflow.md §0.5's per-locality discovery
// sweep as a 5-step checklist wizard: pick a locality, search the
// aggregators + official sources, compare against what's already in our DB,
// add a real new lot via the real + Add Location form, see the result.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { ExternalLink } from 'lucide-react';
import type { AddLocationFormInput } from '@/lib/sourcing/addLocation';
import { huntAggregatorLinks, HUNT_OFFICIAL_LINKS, HUNT_UNINGESTED_AGGREGATOR_LINKS } from '@/lib/sourcing/huntLinks';
import { LOCALITIES, localityStats } from '@/lib/sourcing/locality';
import {
  completeStep,
  goToStep,
  HUNT_LOCALITY_KEY,
  huntProgressKey,
  INITIAL_PROGRESS,
  makeProgressReader,
  parseProgress,
  serializeProgress,
  type TrackProgress,
} from '@/lib/sourcing/tutorialProgress';
import type { SourcedParkingLocation, SourcedLocationInput } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';
import { addSourcedLocation, importParsedSourceLocations } from '../actions';
import { AddLocationButton } from '../_components/AddLocationButton';
import { HuntCoverageMap } from '../_components/HuntCoverageMap';
import { PasteHtmlButton } from '../_components/PasteHtmlButton';
import { PasteUrlButton } from '../_components/PasteUrlButton';
import { TutorialProgressBar } from './TutorialProgressBar';

// A staged item is either a hand-typed/pasted-HTML lot (AddLocationFormInput
// — always written via addSourcedLocation, source:'manual') or a row fetched
// live from a real source page via Paste URL (the full SourcedLocationInput
// shape, real source/sourceListingId already computed — written via
// importParsedSourceLocations instead, so it keeps its real source
// attribution rather than getting relabeled 'manual'). Only 'manual' entries
// support the double-click editor — AddLocationButton's editStaged only
// understands the form shape.
type StagedItem =
  | { kind: 'manual'; data: AddLocationFormInput }
  | { kind: 'fetched'; data: SourcedLocationInput };

/** Shared row list for the staged batch — same markup in step 2 and step 4. */
function StagedListRows({
  items,
  batchPending,
  onEdit,
  onRemove,
}: {
  items: StagedItem[];
  batchPending: boolean;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="divide-y divide-[#0e1c36]/8 max-h-48 overflow-y-auto">
      {items.map((item, i) => (
        <div
          key={i}
          onDoubleClick={() => item.kind === 'manual' && !batchPending && onEdit(i)}
          className={cn(
            'flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[#0e1c36]/[.03]',
            item.kind === 'manual' && 'cursor-pointer',
          )}
        >
          <span className="text-[#0e1c36] truncate">
            {item.data.name}
            {item.kind === 'fetched' && (
              <span className="ml-1.5 text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">fetched</span>
            )}
          </span>
          <button
            onClick={() => onRemove(i)}
            disabled={batchPending}
            className="text-xs text-[#0e1c36]/40 hover:text-[#c1121f] shrink-0 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

const STEP_LABELS = [
  'Pick a locality',
  'Search the aggregators',
  'Compare against our DB',
  'Add a new lot',
  'Done',
];

const noSubscription = () => () => {};
function readLocality(): string | null {
  return localStorage.getItem(HUNT_LOCALITY_KEY);
}

export function HuntTrack({ locations }: { locations: SourcedParkingLocation[] }) {
  const storedLocality = useSyncExternalStore(noSubscription, readLocality, () => null as string | null);
  const [localityOverride, setLocalityOverride] = useState<string | null | undefined>(undefined);
  const locality = localityOverride === undefined ? storedLocality : localityOverride;

  // Progress is namespaced PER LOCALITY (see huntProgressKey's comment) — a
  // learner switching localities resumes that locality's own saved progress
  // instead of inheriting whatever was unlocked for the last one. The reader
  // must stay referentially stable across re-renders for the SAME locality
  // (useMemo, keyed on locality) or useSyncExternalStore logs/loops on
  // "getSnapshot should be cached".
  const readProgress = useMemo(() => makeProgressReader(huntProgressKey(locality)), [locality]);
  const storedProgress = useSyncExternalStore(noSubscription, readProgress, () => INITIAL_PROGRESS);
  const [progressOverride, setProgressOverride] = useState<TrackProgress | null>(null);
  const progress = progressOverride ?? storedProgress;

  // Lots found while sweeping aggregators (step 2) are staged here — nothing
  // is written to Firestore until "Save all" at step 4, regardless of which
  // of the three add paths (Add Location, Paste HTML, Paste URL) produced
  // them. Kept as plain component state (not localStorage-backed like
  // progress/locality above): it's meant to live for one sweep, and clears
  // whenever the locality changes so a staged lot never silently gets saved
  // under the wrong one.
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [batchPending, setBatchPending] = useState(false);
  const [batchResult, setBatchResult] = useState<{ added: number; merged: number } | null>(null);

  function stageManual(input: AddLocationFormInput) {
    setStagedItems((prev) => [...prev, { kind: 'manual', data: input }]);
  }
  function stageManualBatch(inputs: AddLocationFormInput[]) {
    setStagedItems((prev) => [...prev, ...inputs.map((data): StagedItem => ({ kind: 'manual', data }))]);
  }
  function stageFetchedBatch(inputs: SourcedLocationInput[]) {
    setStagedItems((prev) => [...prev, ...inputs.map((data): StagedItem => ({ kind: 'fetched', data }))]);
  }

  function removeStagedItem(index: number) {
    setStagedItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Double-click a staged row (in either step 2's or step 4's list) to
  // reopen the form pre-filled with that entry — only 'manual' items
  // support this (see StagedItem's comment). Edits a local staged value,
  // never Firestore, so there's no separate "save" path to wire.
  const [editingStagedIndex, setEditingStagedIndex] = useState<number | null>(null);
  const editingItem = editingStagedIndex !== null ? stagedItems[editingStagedIndex] : undefined;

  function saveStagedEdit(input: AddLocationFormInput) {
    if (editingStagedIndex === null) return;
    setStagedItems((prev) => prev.map((item, i) => (i === editingStagedIndex ? { kind: 'manual', data: input } : item)));
    setEditingStagedIndex(null);
  }

  async function handleSaveAllStaged() {
    setBatchPending(true);
    let added = 0;
    let merged = 0;
    const fetchedBatch: SourcedLocationInput[] = [];
    for (const item of stagedItems) {
      if (item.kind === 'fetched') {
        fetchedBatch.push(item.data);
        continue;
      }
      const result = await addSourcedLocation(item.data);
      if (result.ok) {
        if (result.mergedExisting) merged++;
        else added++;
      }
    }
    if (fetchedBatch.length > 0) {
      const result = await importParsedSourceLocations(fetchedBatch);
      if (result.ok) {
        added += result.imported;
        merged += result.merged;
      }
    }
    setStagedItems([]);
    setBatchResult({ added, merged });
    setBatchPending(false);
    persistProgress(completeStep(progress, 3, STEP_LABELS.length));
  }

  /** Writes progress under the CURRENT locality's key — safe to use from any
   * handler that doesn't itself change locality (checkbox completions,
   * progress-bar jumps, "change" link, the add-location success step). */
  function persistProgress(next: TrackProgress) {
    localStorage.setItem(huntProgressKey(locality), serializeProgress(next));
    setProgressOverride(next);
  }

  function pickLocality(name: string) {
    localStorage.setItem(HUNT_LOCALITY_KEY, name);
    setLocalityOverride(name);
    setStagedItems([]);
    setBatchResult(null);
    // Base off NAME's own saved progress (read fresh from storage, not the
    // `progress` closure above, which still reflects whatever locality was
    // active before this click) — resumes that locality's history instead of
    // carrying over the previous locality's unlockedThrough.
    const key = huntProgressKey(name);
    const base = parseProgress(localStorage.getItem(key));
    const next = completeStep(base, 0, STEP_LABELS.length);
    localStorage.setItem(key, serializeProgress(next));
    setProgressOverride(next);
  }

  function resetForNewLocality() {
    localStorage.removeItem(HUNT_LOCALITY_KEY);
    setLocalityOverride(null);
    setStagedItems([]);
    setBatchResult(null);
    // No locality selected -> huntProgressKey(null)'s bucket is never written
    // to meaningfully, so falling back to INITIAL_PROGRESS in memory (rather
    // than persisting it) is enough to show the picker at step 0.
    setProgressOverride(INITIAL_PROGRESS);
  }

  const stats = localityStats(locations);
  const localityLots = locality ? locations.filter((l) => l.locality === locality) : [];

  /** Back one step (not to be confused with "change", which always jumps
   * straight to the locality picker) — goToStep never re-locks anything, so
   * this is always safe. */
  const goBack = () => persistProgress(goToStep(progress, progress.step - 1));

  return (
    <div className="border border-[#0e1c36]/12 bg-white p-6 mb-6">
      {editingItem?.kind === 'manual' && (
        <AddLocationButton
          key={editingStagedIndex}
          locality={locality ?? undefined}
          editStaged={{
            value: editingItem.data,
            onSave: saveStagedEdit,
            onCancel: () => setEditingStagedIndex(null),
          }}
        />
      )}

      <TutorialProgressBar steps={STEP_LABELS} progress={progress} onJump={(i) => persistProgress(goToStep(progress, i))} />

      {locality && progress.step > 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-[#0e1c36]/60">
          Working: <span className="font-semibold text-[#0e1c36]">{locality}</span>
          <button onClick={() => persistProgress(goToStep(progress, 0))} className="text-[#1a3a7a] hover:underline">
            change
          </button>
        </div>
      )}

      {/* Step 0 — pick a locality */}
      {progress.step === 0 && (
        <div>
          <p className="text-sm text-[#0e1c36]/70 mb-3">
            {`Miami-Dade is split into ${LOCALITIES.length} named localities. You own one until it's exhausted — three consecutive sweeps of every source tier turning up zero lots you don't already have (§0.5). Pick one to practice on.`}
          </p>
          <HuntCoverageMap stats={stats} selected={locality} onSelect={pickLocality} />
          <div className="grid sm:grid-cols-2 gap-2">
            {LOCALITIES.map((name) => {
              const stat = stats.find((s) => s.locality === name);
              return (
                <button
                  key={name}
                  onClick={() => pickLocality(name)}
                  className={cn(
                    'text-left px-3 py-2 border rounded text-sm hover:bg-[#0e1c36]/[.03]',
                    locality === name ? 'border-[#1a3a7a] bg-[#afcbff]/20' : 'border-[#0e1c36]/15',
                  )}
                >
                  <span className="text-[#0e1c36]">{name}</span>
                  <span className="text-[#0e1c36]/40 ml-2 font-mono text-xs">{stat?.lotCount ?? 0} lots</span>
                  {stat?.needsHunt && (
                    <span className="ml-2 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a]">
                      hunt needed
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 1 — aggregator + official search */}
      {progress.step === 1 && locality && (
        <div>
          <p className="text-sm font-semibold text-[#0e1c36] mb-1">
            {/* Template literal, not adjacent JSX text + expression — the
                compiler here silently drops the space between `{locality}`
                and a literal text word that immediately follows it on the
                same line (confirmed against a clean rebuild, not a stale
                Turbopack cache). */}
            1. Search each aggregator for &ldquo;{`${locality} parking`}&rdquo;
          </p>
          <p className="text-xs text-[#0e1c36]/50 mb-3">
            Every lot listed that isn&apos;t in our DB yet → Add Location (§0.5 step 1).
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mb-5">
            {huntAggregatorLinks(locality).map((l) => (
              <a
                key={l.aggregator}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 border border-[#0e1c36]/15 rounded text-sm hover:bg-[#0e1c36]/[.03]"
              >
                <span className="text-[#0e1c36]">{l.aggregator}</span>
                <span className="flex items-center gap-1.5">
                  {!l.verified && <span className="text-[10px] text-[#0e1c36]/40">type it in the search box</span>}
                  <ExternalLink className="h-3.5 w-3.5 text-[#0e1c36]/40" />
                </span>
              </a>
            ))}
          </div>

          <p className="text-sm font-semibold text-[#0e1c36] mb-1">2. Official sources + aggregators we don&apos;t ingest yet</p>
          <p className="text-xs text-[#0e1c36]/50 mb-3">City-wide pages (§4) — same rule: not in our DB yet → add it.</p>
          <div className="grid sm:grid-cols-2 gap-2 mb-5">
            {[...HUNT_OFFICIAL_LINKS, ...HUNT_UNINGESTED_AGGREGATOR_LINKS].map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 border border-[#0e1c36]/15 rounded text-sm hover:bg-[#0e1c36]/[.03]"
              >
                <span className="text-[#0e1c36]">{l.label}</span>
                <ExternalLink className="h-3.5 w-3.5 text-[#0e1c36]/40 shrink-0 ml-2" />
              </a>
            ))}
          </div>

          <p className="text-xs text-[#0e1c36]/50 mb-1.5">
            Found one already? Add it here — it&apos;s staged, not saved yet. Save the whole list together in step 4.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            <AddLocationButton locality={locality} onStage={stageManual} />
            <PasteHtmlButton locality={locality} onStage={stageManualBatch} />
            <PasteUrlButton locality={locality} onStage={stageFetchedBatch} />
          </div>

          {stagedItems.length > 0 && (
            <div className="mb-4 border border-[#0e1c36]/12 rounded">
              <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40 border-b border-[#0e1c36]/8">
                {stagedItems.length} staged — double-click one to edit, save {stagedItems.length === 1 ? 'it' : 'them all'} in step 4
              </p>
              <StagedListRows
                items={stagedItems}
                batchPending={batchPending}
                onEdit={setEditingStagedIndex}
                onRemove={removeStagedItem}
              />
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-[#0e1c36] p-3 bg-[#f9fbf2] border border-[#0e1c36]/10 rounded cursor-pointer mb-3">
            <input
              type="checkbox"
              className="mt-0.5"
              onChange={(e) => e.target.checked && persistProgress(completeStep(progress, 1, STEP_LABELS.length))}
            />
            I checked the aggregators and official sources above for lots in {locality} not yet in our DB
          </label>
          <button onClick={goBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        </div>
      )}

      {/* Step 2 — compare against DB */}
      {progress.step === 2 && locality && (
        <div>
          <p className="text-sm font-semibold text-[#0e1c36] mb-1">
            What&apos;s already in our DB for {locality}
          </p>
          <p className="text-xs text-[#0e1c36]/50 mb-3">
            Anything you found that ISN&apos;T in this list is a new lot. Anything that IS — skip it, or re-add it
            anyway (re-adding is safe, it merges, never duplicates).
          </p>
          <div className="border border-[#0e1c36]/12 rounded mb-4 max-h-64 overflow-y-auto">
            {localityLots.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[#0e1c36]/40">
                Nothing sourced for {locality} yet — every lot you find here will be new.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[#0e1c36]/40">
                    <th className="px-3 py-1.5 text-left font-medium">Name</th>
                    <th className="px-3 py-1.5 text-left font-medium">Source</th>
                    <th className="px-3 py-1.5 text-left font-medium">Address</th>
                    <th className="px-3 py-1.5 text-left font-medium">Added by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0e1c36]/8">
                  {localityLots.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-[#0e1c36]">{l.name}</td>
                      <td className="px-3 py-2 text-[#0e1c36]/50 whitespace-nowrap">{l.source}</td>
                      <td className="px-3 py-2 text-[#0e1c36]/50 truncate max-w-[16rem]">{l.address || '—'}</td>
                      <td className="px-3 py-2 text-[#0e1c36]/50 whitespace-nowrap">{l.addedBy || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm text-[#0e1c36] p-3 bg-[#f9fbf2] border border-[#0e1c36]/10 rounded cursor-pointer mb-3">
            <input
              type="checkbox"
              className="mt-0.5"
              onChange={(e) => e.target.checked && persistProgress(completeStep(progress, 2, STEP_LABELS.length))}
            />
            I compared what I found against this list — I can tell which lots are new vs. already here
          </label>
          <button onClick={goBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        </div>
      )}

      {/* Step 3 — add a lot(s) */}
      {progress.step === 3 && locality && (
        <div>
          <p className="text-sm font-semibold text-[#0e1c36] mb-1">Add the lot(s) you found in {locality}</p>
          <p className="text-xs text-[#0e1c36]/50 mb-4">
            Name + source URL required — no URL, no entry (§4). Add as many as you found (including anything
            staged back in step 2) — nothing writes to the database until you hit &ldquo;Save all&rdquo; below.
            If it turns out to already exist, that&apos;s not a mistake — the merge is the dedupe system working.
            Got a supported source page in hand instead? Paste its URL or HTML and skip retyping the fields by
            hand.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            <AddLocationButton locality={locality} onStage={stageManual} />
            <PasteHtmlButton locality={locality} onStage={stageManualBatch} />
            <PasteUrlButton locality={locality} onStage={stageFetchedBatch} />
          </div>

          {stagedItems.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-[#0e1c36]/50 mb-1.5">
                {stagedItems.length} staged — double-click one to edit it first.
              </p>
              <div className="border border-[#0e1c36]/12 rounded mb-3">
                <StagedListRows
                  items={stagedItems}
                  batchPending={batchPending}
                  onEdit={setEditingStagedIndex}
                  onRemove={removeStagedItem}
                />
              </div>
              <button
                onClick={handleSaveAllStaged}
                disabled={batchPending}
                className="px-4 py-2 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
              >
                {batchPending ? 'Saving…' : `Save all ${stagedItems.length}`}
              </button>
            </div>
          )}

          <button onClick={goBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        </div>
      )}

      {/* Step 4 — success */}
      {progress.step === 4 && (
        <div>
          {batchResult ? (
            <div className="p-4 bg-[#dff5e1] border border-[#c8ecc9] rounded">
              <p className="font-semibold text-[#1a5a2a] mb-1">✓ Saved</p>
              <p className="text-sm text-[#1a5a2a]">
                {batchResult.added > 0 && `${batchResult.added} new draft${batchResult.added === 1 ? '' : 's'} created`}
                {batchResult.added > 0 && batchResult.merged > 0 && ', '}
                {batchResult.merged > 0 &&
                  `${batchResult.merged} already existed and merged in — the dedupe system working, not a mistake`}
                {' — all ready to be worked in the Work Queue.'}
              </p>
            </div>
          ) : (
            // Reached step 4 without a batchResult — only possible via a raw
            // page reload while already on this step (batchResult isn't
            // localStorage-persisted like progress is), since Save all is
            // the only path that unlocks step 4. Generic fallback, not a
            // real result to report.
            <div className="p-4 bg-[#dff5e1] border border-[#c8ecc9] rounded">
              <p className="font-semibold text-[#1a5a2a] mb-1">✓ Done</p>
              <p className="text-sm text-[#1a5a2a]">
                Whatever you saved is in the system, ready to be worked in the Work Queue.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={goBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
              ← Back
            </button>
            <button
              onClick={resetForNewLocality}
              className="px-4 py-2 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]"
            >
              Hunt another locality
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
