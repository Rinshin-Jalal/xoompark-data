'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { SourcedParkingLocation } from '@/lib/sourcing/types';
import { applyReviewFilters, EMPTY_REVIEW_FILTERS, type ReviewFilters } from '@/lib/sourcing/reviewFilters';
import { AddLocationButton } from './AddLocationButton';
import type { CrossSourceCandidate } from './CrossSourceMatchesTable';
import { CrossSourceMatchesTable } from './CrossSourceMatchesTable';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LocalitiesTracker } from './LocalitiesTracker';
import { PasteHtmlButton } from './PasteHtmlButton';
import { PasteUrlButton } from './PasteUrlButton';
import { SourcingFilterBar } from './SourcingFilterBar';
import { SourcingReviewTable } from './SourcingReviewTable';

// Query param names, one per ReviewFilters dimension. A param is omitted
// entirely from the URL when it's at its default ('all'/null/'') to keep
// shared links clean.
const PARAM_KEYS = ['search', 'locality', 'status', 'source', 'flood', 'residential', 'addedBy', 'odd', 'hasCoords'] as const;

function filtersFromSearchParams(params: URLSearchParams): ReviewFilters {
  return {
    search: params.get('search') ?? '',
    locality: params.get('locality'),
    status: (params.get('status') as ReviewFilters['status']) ?? 'all',
    source: (params.get('source') as ReviewFilters['source']) ?? 'all',
    flood: (params.get('flood') as ReviewFilters['flood']) ?? 'all',
    residential: (params.get('residential') as ReviewFilters['residential']) ?? 'all',
    addedBy: params.get('addedBy'),
    odd: (params.get('odd') as ReviewFilters['odd']) ?? 'in',
    hasCoords: (params.get('hasCoords') as ReviewFilters['hasCoords']) ?? 'all',
  };
}

function ParkingSourcingModeViewContent({
  locations,
  sortedLocations,
  crossSourceCandidates,
}: {
  /** Raw, unsorted — LocalitiesTracker's stats always reflect every locality. */
  locations: SourcedParkingLocation[];
  /** Hard-fail-sunk, createdAt-desc — exactly what the admin table has always used. */
  sortedLocations: SourcedParkingLocation[];
  crossSourceCandidates: CrossSourceCandidate[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const addedByOptions = useMemo(
    () => [...new Set(locations.map((l) => l.addedBy).filter((v): v is string => !!v))].sort(),
    [locations],
  );

  function updateFilters(patch: Partial<ReviewFilters>) {
    const next: ReviewFilters = { ...filters, ...patch };
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PARAM_KEYS) {
      const value = next[key];
      const isDefault = value === EMPTY_REVIEW_FILTERS[key];
      if (isDefault) params.delete(key);
      else params.set(key, String(value));
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  const filteredLocations = applyReviewFilters(sortedLocations, filters);
  // key remount on filter change: SourcingReviewTable seeds its own editable
  // `locations` state from `initialLocations` once (for optimistic
  // status-toggle/edit updates) and won't re-derive it from a changed prop
  // on its own.
  const filterSignature = PARAM_KEYS.map((k) => filters[k] ?? '').join('|');

  // Add-lot actions are record creation, not table operations — one "+ Add"
  // menu above the table unit with the three entry points under it. The
  // three components are driven controlled (open/onOpenChange) so a menu
  // item opens their dialog; Work Queue/Hunt keep their own buttons since
  // they don't pass these props.
  const [addOpen, setAddOpen] = useState<'location' | 'url' | 'html' | null>(null);
  const openDialog = (which: 'location' | 'url' | 'html') => () => setAddOpen(which);
  const closeDialog = () => setAddOpen(null);

  return (
    <div className="w-full">
      {/* The three add-lot dialogs, driven controlled by the menu in the
          table's status strip — no trigger buttons render in this mode. */}
      <AddLocationButton open={addOpen === 'location'} onOpenChange={closeDialog} />
      <PasteUrlButton open={addOpen === 'url'} onOpenChange={closeDialog} />
      <PasteHtmlButton open={addOpen === 'html'} onOpenChange={closeDialog} />

      {/* One table unit: Filters popover + count + triage chips + view
          toggle + Add menu form the single status strip, so the whole thing
          reads as one attached table. Locality summary and cross-source
          review are secondary/reference panels below. */}
      <SourcingReviewTable
        key={filterSignature}
        initialLocations={filteredLocations}
        totalCount={sortedLocations.length}
        filters={filters}
        onFilterPatch={updateFilters}
        toolbar={
          <SourcingFilterBar
            filters={filters}
            onChange={updateFilters}
            locations={sortedLocations}
            addedByOptions={addedByOptions}
          />
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-[.08em] border border-[#0e1c36]/30 text-[#0e1c36] bg-transparent rounded transition-colors hover:border-[#0e1c36] hover:bg-[#afcbff]"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openDialog('location')}>Add lot manually</DropdownMenuItem>
              <DropdownMenuItem onSelect={openDialog('url')}>Paste a listing URL</DropdownMenuItem>
              <DropdownMenuItem onSelect={openDialog('html')}>Paste listing HTML</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <LocalitiesTracker
        locations={locations}
        selected={filters.locality}
        onSelect={(locality) => updateFilters({ locality })}
      />

      <CrossSourceMatchesTable initialCandidates={crossSourceCandidates} />
    </div>
  );
}

export function ParkingSourcingModeView(
  props: Parameters<typeof ParkingSourcingModeViewContent>[0],
) {
  return (
    <Suspense fallback={null}>
      <ParkingSourcingModeViewContent {...props} />
    </Suspense>
  );
}
