'use client';

// Filter bar for the admin sourcing review table. Controlled by the parent
// (ParkingSourcingModeView), which owns the URL-synced `filters` state so
// these dropdowns and LocalitiesTracker's row-click filter (the one place
// locality is picked now — the dropdown was removed; the tracker shows
// per-locality counts, so it's a dashboard, not just a control) can never
// disagree — one source of truth, passed down to both.
//
// Search gets local state + a debounced onChange call (typing shouldn't spam
// a URL update on every keystroke); the dropdowns are discrete and
// propagate immediately.
//
// Legibility comes from two cheap things, no extra chrome:
// 1. Non-default selects are tinted in place — the eye finds the applied
//    filters in a row of identical boxes without reading labels. (A token
//    strip was tried and cut: it duplicated what every select already
//    displays as its own value.)
// 2. Facet counts — every non-"all" dropdown option shows how many records
//    it would match, computed from the full unfiltered set, so choices
//    preview their effect before you commit. The Waymo ODD lens (default
//    'in', silently hides out-of-ODD and coordinate-less records) is visible
//    for the same reason: "in (1128)" / "outside (376)" in the control.
import { useEffect, useMemo, useState } from 'react';
import { isInWaymoOdd, type SourcedParkingLocation } from '@/lib/sourcing/types';
import { hasActiveReviewFilters, type ReviewFilters } from '@/lib/sourcing/reviewFilters';
import { cn } from '@/lib/utils';

const SEARCH_DEBOUNCE_MS = 300;

// Tinted variant flags a non-default control; the default boxes stay quiet.
// Same accent-wash language as FilterChip's active state — #afcbff wash,
// ink text, never a solid navy pill.
const selectCls =
  'px-2 py-1.5 text-xs font-mono uppercase tracking-[.04em] border rounded bg-white focus:outline-none focus:border-[#1a3a7a]';
const selectQuiet = 'border-[#0e1c36]/15 text-[#0e1c36]';
const selectActive = 'border-[#0e1c36]/40 bg-[#afcbff]/20 text-[#0e1c36] font-semibold';

// Sources with their own filter option — anything else buckets to 'other'
// (mirrors KNOWN_SOURCES in reviewFilters.ts).
const KNOWN_SOURCES = new Set(['spothero', 'parkopedia', 'laz', 'manual']);

export function SourcingFilterBar({
  filters,
  onChange,
  locations,
  addedByOptions,
}: {
  filters: ReviewFilters;
  onChange: (patch: Partial<ReviewFilters>) => void;
  /** The FULL unfiltered set — facet counts must not shrink as filters
   * narrow the rows (same rationale as addedByOptions below). */
  locations: SourcedParkingLocation[];
  /** Distinct addedBy values actually present across all locations (not
   * just the currently-filtered set) — computed once by the parent so this
   * dropdown's options don't shrink to nothing as soon as a filter narrows
   * the visible rows. Empty/omitted hides the dropdown — most installs have
   * no manually-attributed records yet. */
  addedByOptions?: string[];
}) {
  const [searchInput, setSearchInput] = useState(filters.search);
  // Render-time reconciliation (React's recommended "adjusting state when a
  // prop changes" pattern, not an effect) — keeps the local input in sync
  // when filters.search changes from outside (e.g. "Clear filters", or
  // landing on a URL that already has ?search=...) without a setState-in-effect
  // cascade.
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search);
    setSearchInput(filters.search);
  }

  useEffect(() => {
    if (searchInput === filters.search) return;
    const t = setTimeout(() => onChange({ search: searchInput }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-debounce on input change
  }, [searchInput]);

  const active = hasActiveReviewFilters(filters);

  // Facet counts from the full set — each dropdown option previews how many
  // records it matches.
  const facets = useMemo(() => {
    const status = { draft: 0, saved: 0 };
    const source: Record<string, number> = {};
    const owner: Record<string, number> = {};
    const odd = { in: 0, out: 0 };
    const coords = { yes: 0, no: 0 };
    for (const l of locations) {
      status[l.status === 'saved' ? 'saved' : 'draft']++;
      const bucket = KNOWN_SOURCES.has(l.source) ? l.source : 'other';
      source[bucket] = (source[bucket] ?? 0) + 1;
      if (l.addedBy) owner[l.addedBy] = (owner[l.addedBy] ?? 0) + 1;
      const inOdd = isInWaymoOdd(l);
      if (inOdd === true) odd.in++;
      else if (inOdd === false) odd.out++;
      if (l.lat !== undefined && l.lng !== undefined) coords.yes++;
      else coords.no++;
    }
    return { status, source, owner, odd, coords };
  }, [locations]);

  // No card chrome of its own — this renders as the table's toolbar strip
  // inside SourcingReviewTable's bordered unit (see its `toolbar` slot).
  return (
    <div className="w-full flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search name or address…"
        className={cn(
          'px-2.5 py-1.5 text-xs border rounded bg-white placeholder:text-[#0e1c36]/30 focus:outline-none focus:border-[#1a3a7a] min-w-[12rem]',
          filters.search.trim() ? selectActive : 'border-[#0e1c36]/15 text-[#0e1c36]',
        )}
      />

      <select
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as ReviewFilters['status'] })}
        className={cn(selectCls, filters.status === 'all' ? selectQuiet : selectActive)}
      >
        <option value="all">Status: all</option>
        <option value="draft">Needs work ({facets.status.draft})</option>
        <option value="saved">Finished ({facets.status.saved})</option>
      </select>

      <select
        value={filters.source}
        onChange={(e) => onChange({ source: e.target.value as ReviewFilters['source'] })}
        className={cn(selectCls, filters.source === 'all' ? selectQuiet : selectActive)}
      >
        <option value="all">Source: all</option>
        <option value="spothero">SpotHero ({facets.source.spothero ?? 0})</option>
        <option value="parkopedia">Parkopedia ({facets.source.parkopedia ?? 0})</option>
        <option value="laz">LAZ ({facets.source.laz ?? 0})</option>
        <option value="manual">Manual ({facets.source.manual ?? 0})</option>
        <option value="other">Other ({facets.source.other ?? 0})</option>
      </select>

      <select
        value={filters.odd}
        onChange={(e) => onChange({ odd: e.target.value as ReviewFilters['odd'] })}
        className={cn(selectCls, filters.odd === 'in' ? selectQuiet : selectActive)}
      >
        <option value="all">Waymo ODD: all</option>
        <option value="in">Waymo ODD: in ({facets.odd.in})</option>
        <option value="out">Waymo ODD: outside ({facets.odd.out})</option>
      </select>

      <select
        value={filters.hasCoords}
        onChange={(e) => onChange({ hasCoords: e.target.value as ReviewFilters['hasCoords'] })}
        className={cn(selectCls, filters.hasCoords === 'all' ? selectQuiet : selectActive)}
      >
        <option value="all">Coordinates: all</option>
        <option value="yes">Has lat/lng ({facets.coords.yes})</option>
        <option value="no">Missing lat/lng ({facets.coords.no})</option>
      </select>

      <select
        value={filters.flood}
        onChange={(e) => onChange({ flood: e.target.value as ReviewFilters['flood'] })}
        className={cn(selectCls, filters.flood === 'all' ? selectQuiet : selectActive)}
      >
        <option value="all">Flood: all</option>
        <option value="pass">Flood: pass</option>
        <option value="fail">Flood: fail</option>
        <option value="unknown">Flood: unknown</option>
      </select>

      <select
        value={filters.residential}
        onChange={(e) => onChange({ residential: e.target.value as ReviewFilters['residential'] })}
        className={cn(selectCls, filters.residential === 'all' ? selectQuiet : selectActive)}
      >
        <option value="all">Residential: all</option>
        <option value="pass">Residential: pass</option>
        <option value="fail">Residential: fail</option>
        <option value="unknown">Residential: unknown</option>
      </select>

      {addedByOptions && addedByOptions.length > 0 && (
        <select
          value={filters.addedBy ?? ''}
          onChange={(e) => onChange({ addedBy: e.target.value || null })}
          className={cn(selectCls, filters.addedBy ? selectActive : selectQuiet)}
        >
          <option value="">Owner: all</option>
          {addedByOptions.map((name) => (
            <option key={name} value={name}>
              {name} ({facets.owner[name] ?? 0})
            </option>
          ))}
        </select>
      )}

      <button
        onClick={() =>
          onChange({
            search: '',
            locality: null,
            status: 'all',
            source: 'all',
            flood: 'all',
            residential: 'all',
            addedBy: null,
            odd: 'in',
            hasCoords: 'all',
          })
        }
        disabled={!active}
        className={cn(
          'px-2.5 py-1.5 text-xs font-mono uppercase tracking-[.06em] border rounded',
          active
            ? 'border-[#0e1c36]/20 text-[#0e1c36] hover:bg-[#0e1c36]/5'
            : 'border-[#0e1c36]/10 text-[#0e1c36]/30 cursor-not-allowed',
        )}
      >
        Clear filters
      </button>
    </div>
  );
}
