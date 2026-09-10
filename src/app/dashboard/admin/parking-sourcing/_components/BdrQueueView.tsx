'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  bdrChecklistRows,
  buildBdrQueue,
  CHECKLIST_FIELDS,
  CONFLICT_LABEL,
  contextStripLabel,
  filterByOdd,
  floodBanner,
  hasConflictNote,
  mapsUrl,
  sourceLabel,
} from '@/lib/sourcing/bdrView';
import {
  type FieldStatus,
  nextOpenStepIndex,
  summarizeWizard,
  WIZARD_FIELD_KEYS,
  wizardFieldState,
  type WizardStatus,
} from '@/lib/sourcing/bdrWizard';
import { FIELD_SOURCE_LADDERS, type FillTrackFieldKey } from '@/lib/sourcing/tutorialFieldLadders';
import { isInWaymoOdd } from '@/lib/sourcing/types';
import type { OutreachRecord, OutreachState, SourcedParkingLocation } from '@/lib/sourcing/types';
import { OUTREACH_STATES, OUTREACH_STATE_LABELS } from '@/lib/sourcing/types';
import { cn } from '@/lib/utils';
import { setSourcingStatus, updateSourcedLocation, type SourcedLocationEdits } from '../actions';
import { advanceOutreachState, getOutreach, saveOutreach, type OutreachInput } from '../actions';
import { TriStateControl } from './SourcingReviewTable';

type Toast = { type: 'success' | 'error'; message: string };

// Dot-per-checklist-field summary for the queue picker list — same visual
// language as SourcingReviewTable's ProvenanceSummary (a row of small dots,
// hover for detail) rather than a raw percentage, but over the 7 BDR
// checklist fields specifically (different field set than that component's
// provenance dots).
function ChecklistDots({ location }: { location: SourcedParkingLocation }) {
  const rows = bdrChecklistRows(location);
  return (
    <span
      className="flex items-center gap-1 shrink-0"
      title={`${rows.filter((r) => r.done).length} of ${rows.length} fields done`}
    >
      {rows.map((r) => (
        <span
          key={r.key}
          title={`${r.label}: ${r.done ? 'done' : 'not done'}`}
          className={cn('inline-block h-2 w-2 rounded-full', r.done ? 'bg-[#1a5a2a]' : 'bg-[#0e1c36]/20')}
        />
      ))}
    </span>
  );
}

// Short, concrete "why it matters" lines — one per checklist field, shown at
// the top of that field's wizard step. Distinct from FIELD_SOURCE_LADDERS
// (the "where to look" list) and from CHECKLIST_FIELDS' longer recording
// guidance (still used for the confirm/manual-input copy below).
const WHY_IT_MATTERS: Record<string, string> = {
  capacity: '50+ stalls is the working minimum — the hard filter fails below that.',
  open247: '24/7 access is a hard requirement for round-the-clock robotaxi ops.',
  is_fenced: 'Security signal — an unfenced lot is a likely hard-filter no.',
  is_lit: 'Needed for safe night operation — another hard filter.',
  ingress_egress: 'Separate one-way in/out avoids robotaxi conflict points at the gate.',
  clearance: "Under-clearance garages physically can't take the vehicle — a hard stop.",
  ratesHours: 'Usually the easiest field to close — almost always stated right on the listing.',
};

function fieldLabel(key: string): string {
  return CHECKLIST_FIELDS.find((f) => f.key === key)?.label ?? key;
}

// ── Outreach panel ───────────────────────────────────────────────────────

function OutreachPanel({
  lotId,
  showToast,
  refresh,
}: {
  lotId: string;
  showToast: (t: Toast) => void;
  refresh: () => void;
}) {
  const [record, setRecord] = useState<OutreachRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // form state
  const [contact_name, setContactName] = useState('');
  const [contact_title, setContactRole] = useState('');
  const [contact_email, setContactEmail] = useState('');
  const [contact_phone, setContactPhone] = useState('');
  const [email_sent, setInquirySent] = useState(false);
  const [call_completed, setCallMade] = useState(false);
  const [form_submitted, setFormSubmitted] = useState(false);
  const [offered_spaces, setOfferSpaces] = useState('');
  const [offered_price, setOfferPrice] = useState('');
  const [offered_start_date, setOfferStart] = useState('');
  const [quote_source, setQuoteSource] = useState('');
  const [assigned_to, setBdrOwner] = useState('');

  useEffect(() => {
    let cancelled = false;
    getOutreach(lotId).then((r) => {
      if (cancelled) return;
      setRecord(r);
      if (r) {
        setContactName(r.contact_name);
        setContactRole(r.contact_title);
        setContactEmail(r.contact_email);
        setContactPhone(r.contact_phone);
        setInquirySent(r.email_sent);
        setCallMade(r.call_completed);
        setFormSubmitted(r.form_submitted);
        setOfferSpaces(r.offered_spaces != null ? String(r.offered_spaces) : '');
        setOfferPrice(r.offered_price);
        setOfferStart(r.offered_start_date);
        setQuoteSource(r.quote_source);
        setBdrOwner(r.assigned_to);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [lotId]);

  function buildData(): OutreachInput {
    return {
      contact_name, contact_title, contact_email, contact_phone,
      email_sent, call_completed, form_submitted,
      offered_spaces: offered_spaces.trim() === '' ? null : Number(offered_spaces),
      offered_price, offered_start_date,
      status: record?.status ?? 'ready',
      response_date: record?.response_date ?? null,
      quote_source, assigned_to,
    };
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const saved = await saveOutreach(lotId, buildData());
        setRecord(saved);
        showToast({ type: 'success', message: 'Outreach saved' });
        refresh();
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save outreach' });
      }
    });
  }

  function handleAdvanceState(state: OutreachState) {
    startTransition(async () => {
      try {
        // save current fields first
        await saveOutreach(lotId, buildData());
        const updated = await advanceOutreachState(lotId, state);
        setRecord(updated);
        showToast({ type: 'success', message: `State → ${OUTREACH_STATE_LABELS[state]}` });
        refresh();
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to advance state' });
      }
    });
  }

  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t border-[#0e1c36]/10">
        <p className="text-xs text-[#0e1c36]/40">Loading outreach…</p>
      </div>
    );
  }

  const currentState = record?.status ?? 'ready';
  const inputCls = 'w-full mt-1 px-2 py-1.5 border border-[#0e1c36]/20 rounded text-sm focus:outline-none focus:border-[#1a3a7a]';
  const labelCls = 'text-[10px] font-medium text-[#0e1c36]/60';

  return (
    <div className="mt-4 pt-4 border-t border-[#0e1c36]/10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[#0e1c36]">Outreach</span>
        <span className="text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#afcbff]/30 border-[#1a3a7a]/20 text-[#1a3a7a]">
          {OUTREACH_STATE_LABELS[currentState]}
        </span>
      </div>

      {/* State buttons */}
      <div className="flex flex-wrap gap-1 mb-3">
        {OUTREACH_STATES.map((s) => (
          <button
            key={s}
            onClick={() => handleAdvanceState(s)}
            disabled={isPending}
            className={cn(
              'px-2 py-1 text-[10px] font-mono uppercase tracking-wide rounded border transition-colors disabled:opacity-50',
              currentState === s
                ? 'bg-[#0e1c36] text-white border-[#0e1c36]'
                : 'border-[#0e1c36]/20 text-[#0e1c36]/60 hover:border-[#0e1c36]/50',
            )}
          >
            {OUTREACH_STATE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Contact fields */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className={labelCls}>Contact name</label>
          <input value={contact_name} onChange={(e) => setContactName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <input value={contact_title} onChange={(e) => setContactRole(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input value={contact_email} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input value={contact_phone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* Inquiry checkboxes */}
      <div className="flex flex-wrap gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-xs text-[#0e1c36]/70 cursor-pointer">
          <input type="checkbox" checked={email_sent} onChange={(e) => setInquirySent(e.target.checked)} className="rounded" />
          Inquiry sent
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[#0e1c36]/70 cursor-pointer">
          <input type="checkbox" checked={call_completed} onChange={(e) => setCallMade(e.target.checked)} className="rounded" />
          Call made
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[#0e1c36]/70 cursor-pointer">
          <input type="checkbox" checked={form_submitted} onChange={(e) => setFormSubmitted(e.target.checked)} className="rounded" />
          Form submitted
        </label>
      </div>

      {/* Offer fields */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className={labelCls}>Offer spaces</label>
          <input type="number" min={0} value={offered_spaces} onChange={(e) => setOfferSpaces(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Price</label>
          <input value={offered_price} onChange={(e) => setOfferPrice(e.target.value)} placeholder="$10/day" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Start date</label>
          <input type="date" value={offered_start_date} onChange={(e) => setOfferStart(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* BDR + source */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className={labelCls}>BDR owner</label>
          <input value={assigned_to} onChange={(e) => setBdrOwner(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Quote source</label>
          <input value={quote_source} onChange={(e) => setQuoteSource(e.target.value)} className={inputCls} />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="px-3 py-1.5 text-xs bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
      >
        {isPending ? 'Saving…' : 'Save outreach'}
      </button>
    </div>
  );
}

/** Writes back exactly what's already on the record for a one-tap confirm —
 * no new value, just a human signing off on the scraped one. Only ever
 * called when wizardFieldState already reported a non-null scrapedValue for
 * this key, so the per-case fallbacks here are defensive, not load-bearing. */
function buildConfirmEdits(location: SourcedParkingLocation, key: string): SourcedLocationEdits | null {
  switch (key) {
    case 'capacity':
      return typeof location.stall_count === 'number' ? { stall_count: location.stall_count } : null;
    case 'open247':
      return location.is_24_7 !== undefined ? { is_24_7: location.is_24_7 } : null;
    case 'is_fenced':
      return location.is_fenced !== undefined ? { is_fenced: location.is_fenced } : null;
    case 'is_lit':
      return location.is_lit !== undefined ? { is_lit: location.is_lit } : null;
    case 'ingress_egress':
      return location.ingress_egress ? { ingress_egress: location.ingress_egress } : null;
    case 'clearance':
      return location.clearance_text ? { clearance_text: location.clearance_text } : null;
    case 'ratesHours': {
      const edits: SourcedLocationEdits = {};
      if (location.price_text) edits.price_text = location.price_text;
      if (location.hours_text) edits.hours_text = location.hours_text;
      return Object.keys(edits).length > 0 ? edits : null;
    }
    default:
      return null;
  }
}

export function BdrQueueView({ locations, practiceRecord }: { locations: SourcedParkingLocation[]; practiceRecord: SourcedParkingLocation | null }) {
  const router = useRouter();

  // Fresh per mount (so a new tab/session doesn't land on the identical
  // top-of-queue record as everyone else) and bumped on every explicit
  // refresh (bumpSeed, below) so ties visibly reshuffle instead of the
  // queue looking frozen. Only reorders records tied on priority — see
  // buildBdrQueue's seed param.
  const [seed, setSeed] = useState(() => Math.random());
  const bumpSeed = () => setSeed(Math.random());

  // ODD-only by default (Brad's hard filters aren't the only thing that
  // matters — a lot outside the Waymo service area isn't worth a BDR's time
  // right now) — same "lens by default, never a hard delete" convention as
  // charging-sites' limitToOdd (ChargingSitesClient.tsx). The toggle reveals
  // a confirmed-outside lot AND one with no coords yet (isInWaymoOdd
  // returns undefined) together — there's no separate view for "only
  // unknown".
  const [showOutsideOdd, setShowOutsideOdd] = useState(false);
  const oddFilteredLocations = useMemo(
    () => filterByOdd(locations, showOutsideOdd),
    [locations, showOutsideOdd],
  );

  const orderedQueue = useMemo(() => buildBdrQueue(oddFilteredLocations, seed), [oddFilteredLocations, seed]);
  const [passedIds, setPassedIds] = useState<Set<string>>(new Set());
  const [warmUpUsed, setWarmUpUsed] = useState(false);

  // Prepend practice record as optional warm-up if it exists and hasn't been
  // used — also gated by the ODD filter, since practiceRecord is computed
  // server-side (getWorkspaceData.ts) independent of this client toggle.
  const warmUpRecord =
    practiceRecord && !warmUpUsed && !passedIds.has(practiceRecord.id) && (showOutsideOdd || isInWaymoOdd(practiceRecord) === true)
      ? practiceRecord
      : null;
  // practiceRecord IS orderedQueue[0] (see getWorkspaceData.ts) — while it's
  // active as the prepended warm-up card, exclude it here too, or it shows
  // up twice (inflating "N remaining" and duplicating it in the queue list).
  // Once used, warmUpRecord goes null and passedIds (set by handleSkip/
  // handleDone below) takes over excluding it, same as any other record.
  const baseRemaining = useMemo(
    () => orderedQueue.filter((l) => !passedIds.has(l.id) && l.id !== warmUpRecord?.id),
    [orderedQueue, passedIds, warmUpRecord],
  );
  const remaining = useMemo(() => warmUpRecord ? [warmUpRecord, ...baseRemaining] : baseRemaining, [warmUpRecord, baseRemaining]);

  // Pin the shown card to whatever record is actually on screen, so a later
  // `remaining` recompute (e.g. after router.refresh() reorders the queue
  // post-edit) re-renders the SAME card with fresh fields instead of
  // silently swapping it out — while "Skip"/"Done" (which remove the
  // current id from `remaining` via passedIds) naturally fall through to
  // the next-highest-priority card. Adjusting state during render (React's
  // documented pattern for "derived state that needs to persist across a
  // prop/dependency change") rather than in a useEffect — no extra render
  // pass, and no setState-in-effect lint violation.
  const [pinnedId, setPinnedId] = useState<string | undefined>(undefined);
  const current = remaining.find((l) => l.id === pinnedId) ?? remaining[0];
  if (current?.id !== pinnedId) setPinnedId(current?.id);

  const [doneCount, setDoneCount] = useState(0);
  const [isPending, startTransition] = useTransition();

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  function handleSkip() {
    if (!current) return;
    if (current.id === warmUpRecord?.id) setWarmUpUsed(true);
    setPassedIds((prev) => new Set(prev).add(current.id));
  }

  function handleDone() {
    if (!current) return;
    const id = current.id;
    const isWarmUp = current.id === warmUpRecord?.id;
    startTransition(async () => {
      try {
        await setSourcingStatus(id, 'saved');
        // Client-side pointer advance — no need to refetch the whole queue,
        // same "optimistic, roll forward" pattern as SourcingReviewTable's
        // status toggle.
        setPassedIds((prev) => new Set(prev).add(id));
        if (!isWarmUp) setDoneCount((c) => c + 1);
        if (isWarmUp) setWarmUpUsed(true);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to mark done' });
      }
    });
  }

  const total = doneCount + remaining.length;
  const pct = total === 0 ? 100 : Math.round((doneCount / total) * 100);

  return (
    <div className="w-full">
      <div className="mb-5">
        <p className="text-sm text-[#0e1c36]/70 mb-1.5">
          Today: <span className="font-semibold">{doneCount} done</span> · {remaining.length} remaining in your queue
        </p>
        <div className="h-1.5 w-full max-w-md bg-[#0e1c36]/10 rounded-full overflow-hidden">
          <div className="h-full bg-[#1a5a2a] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <label className="flex items-center gap-1.5 mt-2 text-xs text-[#0e1c36]/60 cursor-pointer">
          <input
            type="checkbox"
            checked={showOutsideOdd}
            onChange={(e) => setShowOutsideOdd(e.target.checked)}
          />
          Outside Waymo ODD — show lots outside the Waymo service area too
        </label>
      </div>

      {remaining.length > 1 && (
        <div className="mb-4 border border-[#0e1c36]/12 bg-white max-h-48 overflow-y-auto">
          {remaining.map((l) => (
            <button
              key={l.id}
              onClick={() => setPinnedId(l.id)}
              className={cn(
                'w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm border-b border-[#0e1c36]/8 last:border-b-0 hover:bg-[#0e1c36]/[.03]',
                l.id === current?.id && 'bg-[#afcbff]/20',
              )}
            >
              <span className="truncate text-[#0e1c36]">
                {l.id === warmUpRecord?.id && <span className="text-[10px] text-[#8a6d1a] mr-1">[warm-up]</span>}
                {l.name}
                {l.claimed_by && <span className="text-[#0e1c36]/40"> · claimed by {l.claimed_by}</span>}
              </span>
              <ChecklistDots location={l} />
            </button>
          ))}
        </div>
      )}

      {!current ? (
        <div className="border border-[#0e1c36]/12 bg-white p-10 text-center text-sm text-[#0e1c36]/50">
          {doneCount > 0
            ? `Nice work — you cleared ${doneCount} lot${doneCount === 1 ? '' : 's'} today. Nothing left in your queue.`
            : 'Nothing in your queue right now — every draft lot has already been worked.'}
        </div>
      ) : (
        <BdrCard
          key={current.id}
          location={current}
          onDone={handleDone}
          onSkipLot={handleSkip}
          isPending={isPending}
          isWarmUp={current.id === warmUpRecord?.id}
          showToast={showToast}
          refresh={() => { bumpSeed(); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ProgressRail({ statuses, currentIndex }: { statuses: WizardStatus[]; currentIndex: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {statuses.map((s, i) => {
        const active = i === currentIndex;
        const captured = s.status === 'captured';
        const skipped = s.status === 'skipped';
        return (
          <span
            key={s.key}
            title={fieldLabel(s.key)}
            className={cn(
              'px-2 py-1 text-[10px] font-mono uppercase tracking-wide rounded border whitespace-nowrap',
              active && 'border-[#1a3a7a] bg-[#afcbff]/20 text-[#1a3a7a] font-semibold',
              !active && captured && 'border-[#c8ecc9] bg-[#dff5e1] text-[#1a5a2a]',
              !active && skipped && 'border-[#0e1c36]/15 bg-[#0e1c36]/5 text-[#0e1c36]/35 line-through',
              !active && !captured && !skipped && 'border-[#0e1c36]/10 text-[#0e1c36]/30',
            )}
          >
            {captured ? '✓ ' : ''}
            {i + 1}. {fieldLabel(s.key)}
          </span>
        );
      })}
    </div>
  );
}

function BdrCard({
  location,
  onDone,
  onSkipLot,
  isPending,
  isWarmUp,
  showToast,
  refresh,
}: {
  location: SourcedParkingLocation;
  onDone: () => void;
  onSkipLot: () => void;
  isPending: boolean;
  isWarmUp?: boolean;
  showToast: (t: Toast) => void;
  refresh: () => void;
}) {
  const flood = floodBanner(location);
  const maps = mapsUrl(location);

  // Session-only wizard state for THIS record — reset for free whenever the
  // parent swaps `location` (BdrQueueView keys BdrCard by location.id, so a
  // new lot remounts this component entirely; a router.refresh() of the
  // SAME lot mid-wizard does NOT remount, since the key is unchanged).
  const [stepIndex, setStepIndex] = useState<number>(() => {
    const initial: WizardStatus[] = WIZARD_FIELD_KEYS.map((key) => ({
      key,
      status: wizardFieldState(location, key).captured ? 'captured' : 'unresolved',
    }));
    const idx = nextOpenStepIndex(initial, 0);
    return idx === -1 ? WIZARD_FIELD_KEYS.length : idx;
  });
  // Session overrides for this record's fields — a key absent here falls
  // back to the record-derived captured/unresolved state (see statusFor).
  // Replaces what used to be three separate Sets (skipped/wrong/captured
  // override) with one status per field.
  const [fieldStatusOverride, setFieldStatusOverride] = useState<Record<string, FieldStatus>>({});
  const [fieldPending, startFieldTransition] = useTransition();

  // Who's currently working this lot — separate from added_by (whoever
  // originally created the record via Hunt/+Add Location). Editable here
  // any time, on any lot (including scraped ones that never had an
  // added_by), unlike added_by which is only ever set once at creation.
  const [claimed_byInput, setClaimedByInput] = useState(location.claimed_by ?? '');
  const [claimPending, startClaimTransition] = useTransition();

  function handleSaveClaim() {
    const trimmed = claimed_byInput.trim();
    if (trimmed === (location.claimed_by ?? '')) return;
    startClaimTransition(async () => {
      try {
        await updateSourcedLocation(location.id, { claimed_by: trimmed || undefined });
        showToast({ type: 'success', message: trimmed ? 'Claimed' : 'Claim cleared' });
        refresh();
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  }

  // Property name — editable inline (same on-blur-save pattern as
  // claimed_byInput above). A blank/whitespace-only name is silently
  // rejected and reverted rather than written, matching the +Add Location
  // form's "name is required" rule.
  const [nameInput, setNameInput] = useState(location.name);
  const [namePending, startNameTransition] = useTransition();

  function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed === location.name) return;
    if (!trimmed) {
      setNameInput(location.name);
      return;
    }
    startNameTransition(async () => {
      try {
        await updateSourcedLocation(location.id, { name: trimmed });
        showToast({ type: 'success', message: 'Name updated' });
        refresh();
      } catch (err) {
        setNameInput(location.name);
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save name' });
      }
    });
  }

  function statusFor(key: string): FieldStatus {
    return fieldStatusOverride[key] ?? (wizardFieldState(location, key).captured ? 'captured' : 'unresolved');
  }

  // Reopens an already-resolved (captured or skipped) field for editing —
  // forcing the override back to 'unresolved' takes precedence over the
  // record-derived 'captured' state in statusFor, so BdrCard's render
  // switch below shows WizardStep again instead of RecapStep. WizardStep
  // itself pre-fills the manual input from the record's current value
  // whenever wizardFieldState still reports captured:true (see its own
  // comment) — this is the only path that does, since a fresh/skipped/wrong
  // field has no confirmed value worth pre-filling.
  function handleReopenField(key: string) {
    setFieldStatusOverride((prev) => ({ ...prev, [key]: 'unresolved' }));
  }

  const statuses: WizardStatus[] = WIZARD_FIELD_KEYS.map((key) => ({ key, status: statusFor(key) }));
  const summary = summarizeWizard(statuses);

  function advanceAfterResolve(resolvedKey: string, resolvedStatus: FieldStatus) {
    const next = statuses.map((s) => (s.key === resolvedKey ? { ...s, status: resolvedStatus } : s));
    const idx = nextOpenStepIndex(next, stepIndex);
    setStepIndex(idx === -1 ? WIZARD_FIELD_KEYS.length : idx);
  }

  function handleSaveField(key: string, edits: SourcedLocationEdits) {
    startFieldTransition(async () => {
      try {
        await updateSourcedLocation(location.id, edits);
        setFieldStatusOverride((prev) => ({ ...prev, [key]: 'captured' }));
        showToast({ type: 'success', message: 'Saved' });
        advanceAfterResolve(key, 'captured');
        refresh();
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  }

  function handleConfirmField(key: string) {
    const edits = buildConfirmEdits(location, key);
    if (!edits) return;
    handleSaveField(key, edits);
  }

  function handleSkipField(key: string) {
    setFieldStatusOverride((prev) => ({ ...prev, [key]: 'skipped' }));
    advanceAfterResolve(key, 'skipped');
  }

  function handleMarkWrong(key: string) {
    // Stays on this step (no advance) — 'wrong' is still open, forcing
    // manual entry instead of the one-tap confirm.
    setFieldStatusOverride((prev) => ({ ...prev, [key]: 'wrong' }));
  }

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNextLinear = () => setStepIndex((i) => Math.min(WIZARD_FIELD_KEYS.length, i + 1));

  const currentKey = stepIndex < WIZARD_FIELD_KEYS.length ? WIZARD_FIELD_KEYS[stepIndex] : undefined;
  const currentStatus = currentKey ? statuses[stepIndex] : undefined;

  return (
    <div className="border border-[#0e1c36]/12 bg-white p-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={handleSaveName}
          disabled={namePending}
          aria-label="Lot name"
          className="text-lg font-bold text-[#0e1c36] flex-1 min-w-0 border border-transparent rounded px-1 -mx-1 hover:border-[#0e1c36]/15 focus:border-[#1a3a7a] focus:outline-none disabled:opacity-50"
        />
        {isWarmUp && (
          <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide rounded-full border bg-[#fdf3d8] border-[#f0dfa0] text-[#8a6d1a] shrink-0">
            Warm-up
          </span>
        )}
      </div>
      <p className="text-xs text-[#0e1c36]/50 mb-3">{contextStripLabel(location)}</p>

      <div className="flex items-center gap-2 mb-4">
        <label htmlFor={`claimed-by-${location.id}`} className="text-xs font-medium text-[#0e1c36]/70 shrink-0">
          Working this:
        </label>
        <input
          id={`claimed-by-${location.id}`}
          value={claimed_byInput}
          onChange={(e) => setClaimedByInput(e.target.value)}
          onBlur={handleSaveClaim}
          disabled={claimPending}
          placeholder="Your name — claim this lot"
          className="flex-1 px-2 py-1 text-sm border border-[#0e1c36]/20 rounded disabled:opacity-50"
        />
      </div>

      <OutreachPanel lotId={location.id} showToast={showToast} refresh={refresh} />

      <div className="flex flex-wrap gap-2 mb-5">
        <a
          href={location.source_url}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1.5 text-xs font-mono uppercase tracking-[.06em] border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
        >
          Open operator page ↗
        </a>
        {maps && (
          <a
            href={maps}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-[.06em] border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
          >
            Open in Maps ↗
          </a>
        )}
      </div>

      {hasConflictNote(location) && (
        <div className="mb-4 px-3 py-2 rounded bg-[#fdf3d8] border border-[#f0dfa0] text-xs text-[#8a6d1a]">
          {CONFLICT_LABEL}
        </div>
      )}

      {flood ? (
        <>
          <div className="mb-5 px-4 py-3 rounded bg-[#ffe1e1] border border-[#ffcccc] text-sm text-[#7a1a1a] font-medium">
            {flood}
          </div>
          <div className="flex flex-wrap gap-2 pt-4 border-t border-[#0e1c36]/10">
            <button
              onClick={onDone}
              disabled={isPending}
              className="px-4 py-2 text-sm bg-[#1a5a2a] text-white rounded hover:bg-[#144a22] disabled:opacity-50"
            >
              Done — next lot →
            </button>
            <button
              onClick={onSkipLot}
              className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
            >
              Skip this lot
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-[#0e1c36]/50 mb-2">
            Step {Math.min(stepIndex + 1, WIZARD_FIELD_KEYS.length)} of {WIZARD_FIELD_KEYS.length} · {summary.captured} captured · {summary.skipped} skipped
          </p>
          <ProgressRail statuses={statuses} currentIndex={stepIndex} />

          {currentKey && currentStatus ? (
            currentStatus.status === 'captured' || currentStatus.status === 'skipped' ? (
              <RecapStep
                fieldKey={currentKey}
                status={currentStatus.status}
                onBack={goBack}
                onNext={goNextLinear}
                onEdit={() => handleReopenField(currentKey)}
                canGoBack={stepIndex > 0}
              />
            ) : (
              <WizardStep
                key={`${location.id}:${currentKey}`}
                location={location}
                fieldKey={currentKey}
                status={currentStatus.status}
                onMarkWrong={() => handleMarkWrong(currentKey)}
                onConfirm={() => handleConfirmField(currentKey)}
                onSave={(edits) => handleSaveField(currentKey, edits)}
                onSkip={() => handleSkipField(currentKey)}
                onBack={goBack}
                canGoBack={stepIndex > 0}
                isPending={fieldPending}
              />
            )
          ) : (
            <SummaryStep
              summary={summary}
              onDone={onDone}
              onSkipLot={onSkipLot}
              isPending={isPending}
              onBack={goBack}
              canGoBack={stepIndex > 0}
            />
          )}
        </>
      )}
    </div>
  );
}

function RecapStep({
  fieldKey,
  status,
  onBack,
  onNext,
  onEdit,
  canGoBack,
}: {
  fieldKey: string;
  status: FieldStatus;
  onBack: () => void;
  onNext: () => void;
  /** Reopens this field as an editable WizardStep — see BdrCard's
   * handleReopenField. The only way to change a value once it's captured
   * or skipped; without this there's no path back into the manual input. */
  onEdit: () => void;
  canGoBack: boolean;
}) {
  const captured = status === 'captured';
  return (
    <div className="mb-2">
      <p className="text-sm font-semibold text-[#0e1c36] mb-1">{fieldLabel(fieldKey)}</p>
      <p className={cn('text-sm mb-3', captured ? 'text-[#1a5a2a]' : 'text-[#0e1c36]/50')}>
        {captured ? '✓ Already captured — a human confirmed this field.' : '— Skipped for now, left empty.'}
      </p>
      <div className="flex flex-wrap gap-2 pt-3 border-t border-[#0e1c36]/10">
        {canGoBack && (
          <button onClick={onBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        )}
        <button onClick={onEdit} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
          {captured ? 'Change answer' : 'Fill this in now'}
        </button>
        <button onClick={onNext} className="px-4 py-2 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]">
          Next →
        </button>
      </div>
    </div>
  );
}

function SummaryStep({
  summary,
  onDone,
  onSkipLot,
  isPending,
  onBack,
  canGoBack,
}: {
  summary: { captured: number; skipped: number; unknown: number };
  onDone: () => void;
  onSkipLot: () => void;
  isPending: boolean;
  onBack: () => void;
  canGoBack: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-[#0e1c36] mb-1">All 7 fields worked</p>
      <p className="text-sm text-[#0e1c36]/70 mb-4">
        {summary.captured} captured · {summary.skipped} skipped
        {summary.unknown > 0 ? ` · ${summary.unknown} unresolved` : ''}
      </p>
      <div className="flex flex-wrap gap-2 pt-4 border-t border-[#0e1c36]/10">
        {canGoBack && (
          <button onClick={onBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        )}
        <button
          onClick={onDone}
          disabled={isPending}
          className="px-4 py-2 text-sm bg-[#1a5a2a] text-white rounded hover:bg-[#144a22] disabled:opacity-50"
        >
          Done — next lot →
        </button>
        <button onClick={onSkipLot} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
          Skip this lot
        </button>
      </div>
    </div>
  );
}

function WizardStep({
  location,
  fieldKey,
  status,
  onMarkWrong,
  onConfirm,
  onSave,
  onSkip,
  onBack,
  canGoBack,
  isPending,
}: {
  location: SourcedParkingLocation;
  fieldKey: string;
  status: FieldStatus;
  onMarkWrong: () => void;
  onConfirm: () => void;
  onSave: (edits: SourcedLocationEdits) => void;
  onSkip: () => void;
  onBack: () => void;
  canGoBack: boolean;
  isPending: boolean;
}) {
  const state = wizardFieldState(location, fieldKey);
  const showConfirm = state.scrapedValue !== null && status !== 'wrong';
  const ladder = FIELD_SOURCE_LADDERS[fieldKey as FillTrackFieldKey] ?? [];

  // Manual-input local state — declared unconditionally (not per field kind)
  // so hook order stays fixed; only the relevant one is ever read. Blank
  // unless this step is REOPENING an already-verified field (BdrCard's
  // "Change answer" — state.captured true means fieldStatusOverride forced
  // this WizardStep open again over what would otherwise be a RecapStep) —
  // then pre-fill with the record's current value so there's something to
  // edit instead of retype from scratch. Still blank for a fresh field
  // (there's a confirm block for that) and for a just-rejected scrape
  // ("Wrong" — status: 'wrong', state.captured false — we deliberately don't
  // pre-fill the rejected value back in).
  const [numberRaw, setNumberRaw] = useState(() =>
    state.captured && typeof location.stall_count === 'number' ? String(location.stall_count) : '',
  );
  const [triValue, setTriValue] = useState<boolean | null | undefined>(() => {
    if (!state.captured) return undefined;
    if (fieldKey === 'open247') return location.is_24_7;
    if (fieldKey === 'is_fenced') return location.is_fenced;
    if (fieldKey === 'is_lit') return location.is_lit;
    return undefined;
  });
  const [textValue, setTextValue] = useState(() => {
    if (!state.captured) return '';
    if (fieldKey === 'ingress_egress') return location.ingress_egress ?? '';
    if (fieldKey === 'clearance') return location.clearance_text ?? '';
    return '';
  });
  const [priceValue, setPriceValue] = useState(() => (state.captured ? location.price_text ?? '' : ''));
  const [hoursValue, setHoursValue] = useState(() => (state.captured ? location.hours_text ?? '' : ''));

  let manualInput: React.ReactNode;
  let canSave: boolean;
  let buildEdits: () => SourcedLocationEdits;

  if (fieldKey === 'capacity') {
    const n = numberRaw.trim() === '' ? undefined : Number(numberRaw);
    canSave = n !== undefined && !Number.isNaN(n);
    buildEdits = () => ({ stall_count: n });
    manualInput = (
      <div>
        <label htmlFor="wizard-stall_count" className="text-xs font-medium text-[#0e1c36]/70">Stall count</label>
        <input
          id="wizard-stall_count"
          type="number"
          min={0}
          value={numberRaw}
          onChange={(e) => setNumberRaw(e.target.value)}
          placeholder="e.g. 200"
          className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
        />
        <p className="text-[10px] text-[#0e1c36]/40 mt-0.5">Only if a source states an exact number — never estimate.</p>
        {location.capacity_text && (
          <p className="text-xs text-[#0e1c36]/50 mt-1">Scraped text (not a confirmed number): &ldquo;{location.capacity_text}&rdquo;</p>
        )}
      </div>
    );
  } else if (fieldKey === 'open247' || fieldKey === 'is_fenced' || fieldKey === 'is_lit') {
    canSave = triValue !== undefined;
    buildEdits = () => {
      if (fieldKey === 'open247') return { is_24_7: triValue };
      if (fieldKey === 'is_fenced') return { is_fenced: triValue };
      return { is_lit: triValue };
    };
    manualInput = (
      <TriStateControl id={`wizard-${fieldKey}`} label={fieldLabel(fieldKey)} value={triValue} onChange={setTriValue} />
    );
  } else if (fieldKey === 'ingress_egress' || fieldKey === 'clearance') {
    canSave = textValue.trim() !== '';
    buildEdits = () => (fieldKey === 'ingress_egress' ? { ingress_egress: textValue.trim() } : { clearance_text: textValue.trim() });
    manualInput = (
      <div>
        <label htmlFor={`wizard-${fieldKey}`} className="text-xs font-medium text-[#0e1c36]/70">{fieldLabel(fieldKey)}</label>
        <input
          id={`wizard-${fieldKey}`}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={fieldKey === 'ingress_egress' ? 'e.g. one-way in, separate exit on SE 2nd St' : 'e.g. 6\'8"'}
          className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
        />
      </div>
    );
  } else {
    // ratesHours — combined price + hours, matches the doc's single "Rates
    // & hours" section and the checklist row that requires both.
    canSave = priceValue.trim() !== '' || hoursValue.trim() !== '';
    buildEdits = () => ({
      ...(priceValue.trim() ? { price_text: priceValue.trim() } : {}),
      ...(hoursValue.trim() ? { hours_text: hoursValue.trim() } : {}),
    });
    manualInput = (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="wizard-price_text" className="text-xs font-medium text-[#0e1c36]/70">Price</label>
          <input
            id="wizard-price_text"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder="e.g. $10/day"
            className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
          />
        </div>
        <div>
          <label htmlFor="wizard-hours_text" className="text-xs font-medium text-[#0e1c36]/70">Hours</label>
          <input
            id="wizard-hours_text"
            value={hoursValue}
            onChange={(e) => setHoursValue(e.target.value)}
            placeholder="e.g. 24/7"
            className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-semibold text-[#0e1c36] mb-1">{fieldLabel(fieldKey)}</p>
      <p className="text-xs text-[#0e1c36]/60 mb-3">{WHY_IT_MATTERS[fieldKey]}</p>

      <div className="p-3 bg-[#0e1c36]/[.03] border border-[#0e1c36]/10 rounded mb-4">
        <p className="text-xs font-semibold text-[#0e1c36]/70 mb-1.5">For this field, specifically:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 text-[#0e1c36]/80">
          {ladder.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      {showConfirm ? (
        <div className="mb-4 p-3 rounded bg-[#fdf3d8] border border-[#f0dfa0]">
          <p className="text-sm text-[#0e1c36]">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[#8a6d1a]">{sourceLabel(location)} says</span>
            {': '}
            <strong>{state.scrapedValue}</strong>
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="px-4 py-2 text-sm bg-[#1a5a2a] text-white rounded hover:bg-[#144a22] disabled:opacity-50"
            >
              ✓ Confirm
            </button>
            <button
              onClick={onMarkWrong}
              className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
            >
              ✗ Wrong
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4">{manualInput}</div>
      )}

      <div className="flex flex-wrap gap-2 pt-4 border-t border-[#0e1c36]/10">
        {canGoBack && (
          <button onClick={onBack} className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            ← Back
          </button>
        )}
        {!showConfirm && (
          <>
            <button
              onClick={onSkip}
              className="px-4 py-2 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
            >
              Skip this field
            </button>
            <button
              onClick={() => onSave(buildEdits())}
              disabled={!canSave || isPending}
              className="px-4 py-2 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
            >
              Save & next →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
