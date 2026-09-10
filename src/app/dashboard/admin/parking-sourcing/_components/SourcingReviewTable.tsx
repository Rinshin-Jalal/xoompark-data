'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ListFilter } from 'lucide-react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { FilterChip } from '@/components/shared/FilterChip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { parseGoogleMapsCoords } from '@/lib/sourcing/googleMapsLink';
import { evaluateHardFilter, HARD_FILTERS } from '@/lib/sourcing/hardFilters';
import { isInWaymoOdd } from '@/lib/sourcing/types';
import type { FieldProvenanceValue, OutreachRecord, SourcedParkingLocation, SourcingStatus } from '@/lib/sourcing/types';
import { OUTREACH_STATE_LABELS } from '@/lib/sourcing/types';
import { MIAMI_DEMAND_ZONES } from '@/lib/sourcing/demandZones';
import { EMPTY_REVIEW_FILTERS, type ReviewFilters } from '@/lib/sourcing/reviewFilters';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { setSourcingStatus, updateSourcedLocation, type SourcedLocationEdits } from '../actions';
import { getOutreachBatch, exportOutreachCsv } from '../actions';
import { ParkingSourcingMap } from './ParkingSourcingMap';

// Fields shown in the per-field provenance summary — the "soft" descriptive
// fields a source snapshot can populate. Order matches display priority.
const PROVENANCE_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'address', label: 'Address' },
  { key: 'priceText', label: 'Price' },
  { key: 'hoursText', label: 'Hours' },
  { key: 'capacityText', label: 'Capacity' },
  { key: 'surfaceType', label: 'Surface' },
  { key: 'gateType', label: 'Gate' },
];

type Toast = { type: 'success' | 'error'; message: string };

function provenanceDotClasses(value: FieldProvenanceValue | undefined) {
  const v = value ?? 'unknown';
  if (v === 'verified') return 'bg-[#1a5a2a]';
  if (v === 'self-reported') return 'bg-[#b8860b]';
  return 'bg-[#0e1c36]/20';
}

// Dot-per-field provenance summary — reused in both the table row (compact)
// and the Edit popup's details section (same component, same meaning: hover
// a dot for which field and what state).
function ProvenanceSummary({ location }: { location: SourcedParkingLocation }) {
  return (
    <div className="flex items-center gap-1.5">
      {PROVENANCE_FIELDS.map((f) => (
        <span
          key={f.key}
          title={`${f.label}: ${location.fieldProvenance[f.key] ?? 'unknown'}`}
          className={cn('inline-block h-2 w-2 rounded-full', provenanceDotClasses(location.fieldProvenance[f.key]))}
        />
      ))}
    </div>
  );
}

// Filter result states — three REAL pills so the matrix scans without
// reading words: YES pale green, NO pale red, UNVERIFIED pale warm gray.
// All three are status, not text, so none of them whisper.
function HardFilterBadge({ location, filterKey }: { location: SourcedParkingLocation; filterKey: string }) {
  const { result, detail } = evaluateHardFilter(location, filterKey);
  if (result === 'unknown') {
    return (
      <span className="text-[11px] font-mono font-semibold tracking-wide px-1.5 py-0.5 rounded bg-[#EDEFF2] text-[#8B96A6] whitespace-nowrap">
        unverified
      </span>
    );
  }
  return (
    <span
      title={detail}
      className={cn(
        'text-[11px] font-mono font-bold tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap',
        result === 'pass' ? 'bg-[#EAF7F0] text-[#16805A]' : 'bg-[#ffe1e1] text-[#7a1a1a]',
      )}
    >
      {result === 'pass' ? 'yes' : 'no'}
    </span>
  );
}

// Summary counts for the two hard filters that now have real data —
// computed from the exact records the table renders, not a separate query.
function summarizeFilter(locations: SourcedParkingLocation[], key: string) {
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  for (const l of locations) {
    const { result } = evaluateHardFilter(l, key);
    if (result === 'pass') pass++;
    else if (result === 'fail') fail++;
    else unknown++;
  }
  return { pass, fail, unknown };
}

function HardFilterSummaryStrip({
  locations,
  filters,
  onFilterPatch,
}: {
  locations: SourcedParkingLocation[];
  filters: ReviewFilters;
  onFilterPatch: (patch: Partial<ReviewFilters>) => void;
}) {
  const flood = summarizeFilter(locations, 'aboveFloodPlain');
  const residential = summarizeFilter(locations, 'notResidentialAdjacent');
  const chip = (key: 'flood' | 'residential', value: 'pass' | 'fail' | 'unknown', label: string, tone?: 'fail' | 'pass') => (
    <FilterChip
      active={filters[key] === value}
      tone={tone}
      onClick={() => onFilterPatch({ [key]: filters[key] === value ? 'all' : value } as Partial<ReviewFilters>)}
    >
      {label}
    </FilterChip>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-[#0e1c36]/40 mr-1">Flood</span>
      {chip('flood', 'pass', `${flood.pass} pass`, 'pass')}
      {chip('flood', 'fail', `${flood.fail} fail`, 'fail')}
      {chip('flood', 'unknown', `${flood.unknown} ?`)}
      <span className="font-mono text-[10px] uppercase tracking-wide text-[#0e1c36]/40 ml-3 mr-1">Residential</span>
      {chip('residential', 'pass', `${residential.pass} pass`, 'pass')}
      {chip('residential', 'fail', `${residential.fail} fail`, 'fail')}
      {chip('residential', 'unknown', `${residential.unknown} ?`)}
    </div>
  );
}

// The one hard-filters column — replaces the nine yes/no badge columns the
// table used to render (7 of 9 were "? unknown" noise). A count chip in the
// row; hover for the full per-filter verdict grid, exactly what the old
// columns showed, same HardFilterBadge component the Edit/View popups use.
function HardFiltersCell({ location }: { location: SourcedParkingLocation }) {
  const results = HARD_FILTERS.map((f) => ({ f, r: evaluateHardFilter(location, f.key).result }));
  const pass = results.filter((x) => x.r === 'pass').length;
  const fail = results.filter((x) => x.r === 'fail').length;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="font-mono text-[10px] tabular-nums px-2 py-0.5 rounded-full border whitespace-nowrap hover:border-[#0e1c36]/40">
          {pass}/{HARD_FILTERS.length}
          {fail > 0 && <span className="text-[#7a1a1a]"> · {fail}✗</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent className="bg-white text-[#0e1c36] border-[#0e1c36]/15 p-3 w-64">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {results.map(({ f }) => (
            <div key={f.key} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#0e1c36]/60">{f.label}</span>
              <HardFilterBadge location={location} filterKey={f.key} />
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Sort key for the hard-filters column — worst first (most fails, then most
// unknowns), the triage direction: "show me what's failing" up top.
function hardFilterTriageRank(l: SourcedParkingLocation): number {
  let fail = 0;
  let unknown = 0;
  for (const f of HARD_FILTERS) {
    const r = evaluateHardFilter(l, f.key).result;
    if (r === 'fail') fail++;
    else if (r === 'unknown') unknown++;
  }
  return fail * 100 + unknown;
}

function StatusBadge({ status }: { status: SourcingStatus }) {
  return (
    <span
      className={cn(
        'text-[11px] font-mono font-semibold tracking-wide px-2.5 py-1 rounded whitespace-nowrap',
        status === 'saved'
          ? 'bg-[#EAF7F0] text-[#16805A]'
          : 'bg-[#FFF5D9] text-[#9A6800]',
      )}
    >
      {status}
    </span>
  );
}

function OddBadge({ location }: { location: SourcedParkingLocation }) {
  const inOdd = isInWaymoOdd(location);
  if (inOdd === undefined) {
    return (
      <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/40">
        ? unknown
      </span>
    );
  }
  return (
    <span
      className={cn(
        'text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap',
        inOdd
          ? 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]'
          : 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60',
      )}
    >
      {inOdd ? 'in odd' : 'outside odd'}
    </span>
  );
}

function detailValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// Timestamps are stored as raw ISO — show humans a date, keep the full
// precision in the hover title.
function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Compact EV column: on-site DC-fast ports when the lot has them, else
// distance to the nearest DC-fast station (from evContext — see
// scripts/enrich_prod_ev_pitstop.ts).
function EvBadge({ location }: { location: SourcedParkingLocation }) {
  const ev = location.evContext;
  if (!ev) return <span className="text-[#0e1c36]/30">—</span>;
  if (ev.onSiteDcFastPorts) {
    return (
      <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]">
        ⚡ {ev.onSiteDcFastPorts} DC on-site
      </span>
    );
  }
  if (ev.nearestDcFastMi != null) {
    return (
      <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60" title={ev.nearestNetwork ?? undefined}>
        DC {ev.nearestDcFastMi}mi
      </span>
    );
  }
  return <span className="text-[#0e1c36]/30">—</span>;
}

// Compact demand column: nearest demand-zone anchor + straight-line miles
// (from geoContext.demand — see demandEnrich.ts). Rounded for display only;
// full precision lives in the doc. Straight-line (haversine), not driving
// distance — hover spells out the contract.
function DemandBadge({ location }: { location: SourcedParkingLocation }) {
  const demand = location.geoContext?.demand;
  if (!demand) return <span className="text-[#0e1c36]/30">—</span>;
  const zone = MIAMI_DEMAND_ZONES.find((z) => z.id === demand.nearestZoneId);
  const label = zone ? zone.name : demand.nearestZoneId;
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#afcbff]/20 border-[#0e1c36]/15 text-[#0e1c36]/60"
      title={`${label} — ${demand.nearestDistanceMi.toFixed(2)} mi straight-line (haversine), not driving distance`}
    >
      {label} {demand.nearestDistanceMi.toFixed(1)}mi
    </span>
  );
}

// Evidence URLs are long and meaningless on screen — the domain is the
// signal, the full URL stays on the link's title/href.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function fmtNum(n: number | null | undefined): string {
  return n != null ? n.toLocaleString('en-US') : '—';
}

function ContextDisclosure({ label, summary, children }: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left cursor-pointer select-none rounded-lg px-3 py-2 transition-colors hover:bg-[#0e1c36]/[.03]">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[#0e1c36]/30 transition-transform duration-200', open && 'rotate-90')} />
        <span className="text-[11px] font-mono font-semibold uppercase tracking-[.14em] text-[#0e1c36]/50">{label}</span>
        <span className="text-[12px] text-[#0e1c36]/35 truncate font-normal">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 duration-200">
        <div className="mt-1 mb-2 ml-6 rounded-lg border border-[#0e1c36]/8 bg-[#f9fbf2]/50 p-3.5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-4' : ''}>
      <div className="text-[10px] font-mono uppercase tracking-wide text-[#8B96A6]">{label}</div>
      <div className="text-[13px] text-[#17233A] mt-0.5 leading-snug">{children}</div>
    </div>
  );
}

const SourceLink = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noreferrer" className="text-[#1E477C] hover:underline">{hostOf(url)}</a>
);

function ParcelContextBlock({ ctx }: { ctx: NonNullable<SourcedParkingLocation['parcelContext']> }) {
  return (
    <ContextDisclosure label="Parcel" summary={ctx.ownerOfRecord}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
        <Field label="Owner" wide><span className="font-semibold text-[15px]">{ctx.ownerOfRecord}</span></Field>
        <Field label="Folio"><span className="font-mono">{detailValue(ctx.folio)}</span></Field>
        <Field label="Zone">{detailValue(ctx.primaryZone)}</Field>
        <Field label="Lot size">{fmtNum(ctx.lotSizeSqft)} sqft</Field>
        <Field label="DOR desc">{detailValue(ctx.dorDesc)}</Field>
        <Field label="Match">{ctx.matchMethod}{ctx.matchDistanceM != null ? `, ${fmtNum(ctx.matchDistanceM)}m` : ''}{ctx.ambiguous ? ' (ambiguous)' : ''}</Field>
        <Field label="Mailing address" wide>{detailValue(ctx.ownerMailingAddress)}</Field>
        <Field label="Source"><SourceLink url={ctx.sourceUrl} /></Field>
        <Field label="Checked">{formatWhen(ctx.checkedAt)}</Field>
      </div>
    </ContextDisclosure>
  );
}

function EntityContextBlock({ ctx }: { ctx: NonNullable<SourcedParkingLocation['entityContext']> }) {
  const persons = ctx.authorizedPersons ?? [];
  const shown = persons.slice(0, 3);
  const more = persons.length > 3 ? persons.length - 3 : 0;
  return (
    <ContextDisclosure label="Entity" summary={ctx.entityName}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
        <Field label="Entity" wide><span className="font-semibold text-[15px]">{ctx.entityName}</span></Field>
        <Field label="Type">
          {detailValue(ctx.entityType)}
          {ctx.status && (
            <span className={cn('ml-1.5 inline-block text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded', ctx.status === 'ACTIVE' ? 'bg-[#EAF7F0] text-[#16805A]' : 'bg-[#EDEFF2] text-[#8B96A6]')}>
              {ctx.status}
            </span>
          )}
        </Field>
        <Field label="Doc #"><span className="font-mono">{detailValue(ctx.documentNumber)}</span></Field>
        <Field label="Annual report">{formatWhen(ctx.lastAnnualReportFiled)}</Field>
        <Field label="Agent">{detailValue(ctx.registeredAgent)}</Field>
        <Field label="Address">{detailValue(ctx.principalAddress)}</Field>
        <Field label="Persons" wide>
          {shown.length > 0 ? `${shown.join(', ')}${more > 0 ? ` +${more}` : ''}` : '—'}
        </Field>
        <Field label="Source"><SourceLink url={ctx.sourceUrl} /></Field>
        <Field label="Checked">{formatWhen(ctx.checkedAt)}</Field>
      </div>
    </ContextDisclosure>
  );
}

function LbtContextBlock({ ctx }: { ctx: NonNullable<SourcedParkingLocation['lbtContext']> }) {
  return (
    <ContextDisclosure label="LBT" summary={ctx.businessName}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
        <Field label="Business" wide><span className="font-semibold text-[15px]">{ctx.businessName}</span></Field>
        <Field label="Owner">{detailValue(ctx.ownerName)}</Field>
        <Field label="Status">{detailValue(ctx.accountStatus)}</Field>
        <Field label="Year">{ctx.receiptYear ?? '—'}</Field>
        <Field label="Class">{detailValue(ctx.classDesc)}</Field>
        <Field label="Phone">{ctx.phone ? <a href={`tel:${ctx.phone}`} className="text-[#1E477C] hover:underline">{ctx.phone}</a> : '—'}</Field>
        <Field label="Email">{ctx.email ? <a href={`mailto:${ctx.email}`} className="text-[#1E477C] hover:underline">{ctx.email}</a> : '—'}</Field>
        <Field label="Source"><SourceLink url={ctx.sourceUrl} /></Field>
        <Field label="Checked">{formatWhen(ctx.checkedAt)}</Field>
      </div>
    </ContextDisclosure>
  );
}

function GateEvidenceBlock({ ctx }: { ctx: NonNullable<SourcedParkingLocation['gateEvidence']> }) {
  const summary = ctx.derivedGateType
    ? `${ctx.derivedGateType}, ${ctx.claims.length} claim${ctx.claims.length === 1 ? '' : 's'}`
    : `${ctx.claims.length} claim${ctx.claims.length === 1 ? '' : 's'}`;
  return (
    <ContextDisclosure label="Gate" summary={summary}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
        <Field label="Gate type"><span className="font-semibold">{detailValue(ctx.derivedGateType)}</span></Field>
        <Field label="Claims">{ctx.claims.length}</Field>
        <Field label="Source"><SourceLink url={ctx.sourceUrl} /></Field>
        <Field label="Checked">{formatWhen(ctx.checkedAt)}</Field>
      </div>
    </ContextDisclosure>
  );
}

function AmenityContextBlock({ ctx }: { ctx: NonNullable<SourcedParkingLocation['amenityContext']> }) {
  const wash = ctx.nearestCarWashM;
  const svc = ctx.nearestCarServiceM;
  return (
    <ContextDisclosure label="Amenity" summary={`wash ${wash != null ? `${wash}m` : '—'} · service ${svc != null ? `${svc}m` : '—'}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5">
        <Field label="Car wash">
          {wash != null ? (
            <span className={cn('font-mono', wash < 200 && 'font-semibold text-[#16805A]')}>{fmtNum(wash)}m</span>
          ) : '—'}
        </Field>
        <Field label="Car service">
          {svc != null ? (
            <span className={cn('font-mono', svc < 200 && 'font-semibold text-[#16805A]')}>{fmtNum(svc)}m</span>
          ) : '—'}
        </Field>
        <Field label="Checked">{formatWhen(ctx.checkedAt)}</Field>
      </div>
    </ContextDisclosure>
  );
}

// DETAILS section of ViewDetailsPopup — every captured field that has a
// value, as a tight label/value grid. Empty fields render NOTHING (a row
// of "—" is noise pretending to be data) — a record with nothing captured
// reads as a short record, not a wall of nulls.
function DetailsGrid({ location }: { location: SourcedParkingLocation }) {
  const geo = location.geoContext;
  const rows: { label: string; value: string }[] = [
    { label: 'Clearance', value: detailValue(location.clearanceText) },
    { label: 'Access', value: detailValue(location.ingressEgress) },
    { label: 'Locality', value: detailValue(location.locality) },
    { label: 'Capacity', value: detailValue(location.capacityText) },
    { label: 'Surface', value: detailValue(location.surfaceType) },
    { label: 'Gate', value: detailValue(location.gateType) },
    { label: 'Stalls total', value: detailValue(location.stallsTotal) },
    { label: 'Captured by', value: detailValue(location.capturedBy) },
    { label: 'Added by', value: detailValue(location.addedBy) },
  ].filter((r) => r.value !== '—');

  const geoRows = geo
    ? (
        [
          { label: 'Flood zone', value: detailValue(geo.floodZone) },
          { label: 'Flood hazard area', value: detailValue(geo.floodHazardArea) },
          { label: 'Residential adjacent', value: detailValue(geo.residentialAdjacent) },
          { label: 'Nearest demand zone', value: geo.demand ? detailValue(MIAMI_DEMAND_ZONES.find((z) => z.id === geo.demand!.nearestZoneId)?.name ?? geo.demand.nearestZoneId) : '—' },
          { label: 'Demand distance (mi)', value: geo.demand ? geo.demand.nearestDistanceMi.toFixed(2) : '—' },
          { label: 'Geo checked', value: formatWhen(geo.checkedAt) },
        ] as { label: string; value: string }[]
      ).filter((r) => r.value !== '—')
    : [];

  return (
    <div className="text-xs">
      {rows.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="text-[10px] font-mono uppercase tracking-wide text-[#8B96A6]">{r.label}</div>
              <div className="text-sm font-semibold text-[#17233A] mt-0.5">{r.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[#0e1c36]/40">
          Nothing captured beyond the snapshot yet — the hard facts live in the edit form.
        </p>
      )}

      {geoRows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5 mt-3 pt-3 border-t border-[#0e1c36]/8">
          {geoRows.map((r) => (
            <div key={r.label}>
              <div className="font-mono text-[9px] uppercase tracking-wide text-[#0e1c36]/40">{r.label}</div>
              <div className="mt-0.5">{r.value}</div>
            </div>
          ))}
        </div>
      )}

      {location.evContext && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mb-3 pt-2 border-t border-[#0e1c36]/10">
          <div><span className="text-[#0e1c36]/40">DC fast on-site</span><br />{detailValue(location.evContext.onSiteDcFastPorts)}</div>
          <div><span className="text-[#0e1c36]/40">Nearest DC fast</span><br />{location.evContext.nearestDcFastMi != null ? `${location.evContext.nearestDcFastMi} mi` : '—'}</div>
          <div><span className="text-[#0e1c36]/40">Nearest network</span><br />{detailValue(location.evContext.nearestNetwork)}</div>
          <div><span className="text-[#0e1c36]/40">EV checked</span><br />{detailValue(location.evContext.checkedAt)}</div>
        </div>
      )}

      {location.pitstopContext && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mb-3 pt-2 border-t border-[#0e1c36]/10">
          <div><span className="text-[#0e1c36]/40">Storage score</span><br />{detailValue(location.pitstopContext.storageScore)}</div>
          <div><span className="text-[#0e1c36]/40">Staging score</span><br />{detailValue(location.pitstopContext.stagingScore)}</div>
          <div><span className="text-[#0e1c36]/40">OSM capacity</span><br />{detailValue(location.pitstopContext.capacity)}</div>
          <div><span className="text-[#0e1c36]/40">Area (sqm)</span><br />{detailValue(location.pitstopContext.areaSqm)}</div>
          <div><span className="text-[#0e1c36]/40">Owner-direct candidate</span><br />{detailValue(location.pitstopContext.ownerDirectCandidate)}</div>
          <div><span className="text-[#0e1c36]/40">Owner</span><br />{detailValue(location.pitstopContext.owner)}</div>
          {location.pitstopContext.osmId && (
            <div className="col-span-2">
              <span className="text-[#0e1c36]/40">OSM</span><br />
              <a href={`https://www.openstreetmap.org/${location.pitstopContext.osmId}`} target="_blank" rel="noreferrer" className="text-[#1a3a7a] hover:underline">
                {location.pitstopContext.osmId}
              </a>
            </div>
          )}
        </div>
      )}

      {location.notes && (
        <div className="mt-3 pt-3 border-t border-[#0e1c36]/8">
          <div className="font-mono text-[9px] uppercase tracking-wide text-[#0e1c36]/40">Notes</div>
          <p className="mt-0.5 text-[#0e1c36]/80">{location.notes}</p>
        </div>
      )}
    </div>
  );
}

// EVIDENCE section — arguably the most important part of an operational
// record. One strong anchor per entry (the domain, 14px/600), date under
// it, source dataset far right in muted mono. Eye gets evidence → date →
// dataset. Full URL stays on the hover.
function EvidenceList({ location }: { location: SourcedParkingLocation }) {
  return (
    <div className="space-y-3">
      {location.evidence.length === 0 && (
        <p className="text-xs text-[#8B96A6]">None recorded.</p>
      )}
      {location.evidence.map((e, i) => (
        <div key={`${e.source}-${i}`} className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              title={e.url}
              className="text-sm font-semibold text-[#1E477C] hover:underline"
            >
              {hostOf(e.url)} ↗
            </a>
            <div className="text-[11px] text-[#8B96A6] mt-0.5" title={e.seenAt}>
              {formatWhen(e.seenAt)}
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wide text-[#8B96A6] shrink-0 pt-1">
            {e.source}
          </span>
        </div>
      ))}
    </div>
  );
}

// Section heading — strong enough to jump around the modal by: 11px bold
// mono uppercase in a real gray, not a decorative whisper.
function PopupSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-mono font-bold uppercase tracking-[.14em] text-[#687589]">
      {children}
    </div>
  );
}

// Read-only "View details" popup — the row's single click. Same layout
// language as EditPopup (sticky header, sectioned scroll body, sticky
// footer) so the two popups feel like one system. onEdit hands the record
// straight to the edit flow without a trip back to the table row.
// Read-only record inspector — the row's single click. Hierarchy per the
// spec: identity header (name → address → price/hours → quiet source row),
// then FILTER CHECK (no inner boxes), SOURCE CONFIDENCE (dots + legend),
// DETAILS, EVIDENCE, and one timestamp row in the footer. onEdit hands the
// record straight to the edit flow without a trip back to the table row.
function ViewDetailsPopup({
  location,
  onClose,
  onEdit,
}: {
  location: SourcedParkingLocation;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const passedFilters = HARD_FILTERS.filter(
    (f) => evaluateHardFilter(location, f.key).result === 'pass',
  ).length;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
        {/* Identity header — WHAT → WHERE → COST, each level one notch quieter */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[#0e1c36]/10 space-y-0">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle
                className="text-[22px] leading-tight font-bold text-[#17233A] truncate"
                title={location.name}
              >
                {location.name || 'Sourced location'}
              </DialogTitle>
              <p className="text-[15px] text-[#53627A] font-medium mt-1.5 leading-snug">
                {location.address || 'No address on file'}
              </p>
              <p className="text-[14px] text-[#53627A] font-medium mt-1">
                {location.priceText || '—'} · {location.hoursText || '—'}
              </p>
              {/* Ground-truth check straight from the record — official Maps
                  URL API, opens in a new tab. Only when coords exist. */}
              {location.lat !== undefined && location.lng !== undefined && (
                <div className="mt-2.5 flex items-center gap-4">
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.lat},${location.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono font-semibold uppercase tracking-wide text-[#1E477C] hover:underline"
                  >
                    street view ↗
                  </a>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono font-semibold uppercase tracking-wide text-[#1E477C] hover:underline"
                  >
                    google maps ↗
                  </a>
                </div>
              )}
            </div>
            <StatusBadge status={location.status} />
          </div>
          <div className="mt-3.5 flex items-center gap-4 flex-wrap text-[10px] font-mono uppercase tracking-wide text-[#8B96A6]">
            <span>
              source <span className="text-[#53627A] normal-case font-medium">{location.source}</span>
            </span>
            <span>
              captured <span className="text-[#53627A] font-medium">{formatWhen(location.createdAt)}</span>
            </span>
            <span className="ml-auto border border-[#0e1c36]/15 rounded px-1.5 py-0.5">read only</span>
          </div>
          <DialogDescription className="sr-only">
            Full record, read only — no changes can be made here.
          </DialogDescription>
        </DialogHeader>

        {/* Sections — hairline separators, density within, air between */}
        <div className="flex-1 overflow-y-auto">
          <section className="px-6 py-4 border-b border-[#0e1c36]/8">
            <div className="flex items-baseline justify-between gap-2">
              <PopupSectionLabel>Filter check</PopupSectionLabel>
              <span className="text-[11px] font-mono font-bold text-[#16805A]">
                {passedFilters} / {HARD_FILTERS.length} verified
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mt-3">
              {HARD_FILTERS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-[#53627A]">{f.label}</span>
                  <HardFilterBadge location={location} filterKey={f.key} />
                </div>
              ))}
            </div>
          </section>

          <section className="px-6 py-4 border-b border-[#0e1c36]/8">
            <PopupSectionLabel>Details</PopupSectionLabel>
            <div className="mt-3">
              <DetailsGrid location={location} />
            </div>
          </section>

          {(location.parcelContext || location.entityContext || location.lbtContext || location.gateEvidence || location.amenityContext) && (
            <section className="px-6 py-4 border-b border-[#0e1c36]/8">
              <PopupSectionLabel>Enrichment</PopupSectionLabel>
              <div className="mt-2 space-y-1">
                {location.parcelContext && <ParcelContextBlock ctx={location.parcelContext} />}
                {location.entityContext && <EntityContextBlock ctx={location.entityContext} />}
                {location.lbtContext && <LbtContextBlock ctx={location.lbtContext} />}
                {location.gateEvidence && <GateEvidenceBlock ctx={location.gateEvidence} />}
                {location.amenityContext && <AmenityContextBlock ctx={location.amenityContext} />}
              </div>
            </section>
          )}

          <section className="px-6 py-4">
            <PopupSectionLabel>Evidence · {location.evidence.length} source{location.evidence.length === 1 ? '' : 's'}</PopupSectionLabel>
            <div className="mt-3">
              <EvidenceList location={location} />
            </div>
          </section>
        </div>

        {/* One timestamp row, in the footer where it belongs */}
        <div className="px-6 py-3 border-t border-[#0e1c36]/10 bg-white flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono uppercase tracking-wide text-[#9AA3AF]">
            <span title={location.createdAt}>Created {formatWhen(location.createdAt)}</span>
            {' · '}
            <span title={location.updatedAt}>Updated {formatWhen(location.updatedAt)}</span>
            {location.enrichedAt && <span title={location.enrichedAt}> · Enriched {formatWhen(location.enrichedAt)}</span>}
            {location.mergedInto && ` · Merged into ${location.mergedInto}`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-[#0e1c36]/25 text-[#0e1c36] rounded transition-colors hover:border-[#0e1c36] hover:bg-[#afcbff]"
            >
              Close
            </button>
            {onEdit && (
              <button
                onClick={onEdit}
                className="px-4 py-1.5 text-sm bg-[#0e1c36] text-[#f9fbf2] rounded transition-colors hover:bg-[#1a3a7a]"
              >
                Edit this lot
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Exported so BdrQueueView's "Fill what you found" reuses the exact same
// edit form/write path instead of building a second one (no new write
// path — same rule AddLocationButton's overlay/panel reuse already set).
//
// Checklist row key -> input id in this form, so clicking a BDR checklist
// row can scroll/highlight the matching input (the checklist is the form's
// table of contents).
export const CHECKLIST_FIELD_TO_INPUT_ID: Record<string, string> = {
  capacity: 'edit-stallsTotal',
  open247: 'edit-access247',
  fenced: 'edit-fenced',
  lit: 'edit-lit',
  ingressEgress: 'edit-ingressEgress',
  clearance: 'edit-clearanceText',
  ratesHours: 'edit-priceText',
};

// Three-state segmented control for tri-state boolean fields. Untouched =
// nothing selected = unknown; "Can't tell" saves null; Yes/No are never
// pre-selected defaults — selection only ever reflects the record.
// Exported so BdrQueueView's field-at-a-time wizard reuses this exact
// Yes/No/Can't-tell control for the tri-state fields instead of rebuilding a
// second one.
export function TriStateControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const options: { label: string; v: boolean | null }[] = [
    { label: 'Yes', v: true },
    { label: 'No', v: false },
    { label: "Can't tell", v: null },
  ];
  return (
    <div id={id}>
      <label className="text-xs font-medium text-[#0e1c36]/70">{label}</label>
      <div className="flex gap-1 mt-1" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              'px-3 py-1.5 text-xs rounded border transition-colors',
              value === o.v
                ? 'bg-[#afcbff] text-[#0e1c36] border-[#0e1c36]/40 font-semibold'
                : 'border-[#0e1c36]/20 text-[#0e1c36]/70 hover:border-[#0e1c36]/50',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[#0e1c36]/40 mt-0.5">
        No only when a source states it outright (&ldquo;closed nights&rdquo;) — otherwise Can&rsquo;t tell or untouched.
      </p>
    </div>
  );
}

// Read-only "full details" strip inside EditPopup — the hard-filter results
// and per-field provenance used to be their own table columns; now that the
// table only shows the essentials, double-click (or the Edit button, same
// handler) is the one place to see everything, editable and computed alike.
function DetailsSummary({ location }: { location: SourcedParkingLocation }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
        {HARD_FILTERS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#0e1c36]/60">{f.label}</span>
            <HardFilterBadge location={location} filterKey={f.key} />
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-[#0e1c36]/8 flex items-center gap-3">
        <ProvenanceSummary location={location} />
      </div>
    </div>
  );
}

export function EditPopup({
  location,
  onSave,
  onClose,
  focusInputId,
}: {
  location: SourcedParkingLocation;
  onSave: (edits: SourcedLocationEdits) => void;
  onClose: () => void;
  focusInputId?: string;
}) {
  const [name, setName] = useState(location.name ?? '');
  const [address, setAddress] = useState(location.address ?? '');
  const [priceText, setPriceText] = useState(location.priceText ?? '');
  const [hoursText, setHoursText] = useState(location.hoursText ?? '');
  const [notes, setNotes] = useState(location.notes ?? '');
  const [clearanceText, setClearanceText] = useState(location.clearanceText ?? '');
  const [access247, setAccess247] = useState<boolean | null | undefined>(location.access247);
  const [fenced, setFenced] = useState<boolean | null | undefined>(location.fenced);
  const [lit, setLit] = useState<boolean | null | undefined>(location.lit);
  const [ingressEgress, setIngressEgress] = useState(location.ingressEgress ?? '');
  // ponytail: stallsTotal held as raw input text so an empty field means
  // "untouched"; parsed (invalid -> untouched) at save time.
  const [stallsTotalRaw, setStallsTotalRaw] = useState(
    location.stallsTotal === undefined || location.stallsTotal === null ? '' : String(location.stallsTotal),
  );
  const [surfaceType, setSurfaceType] = useState<'surface' | 'structured' | null | undefined>(
    location.surfaceType ?? undefined,
  );
  // Raw text like stallsTotalRaw above — empty means "untouched", parsed at
  // save time. mapsLink is scratch space only, never saved itself; parsing
  // it just fills the two coordinate fields for review before Save.
  const [latRaw, setLatRaw] = useState(location.lat === undefined ? '' : String(location.lat));
  const [lngRaw, setLngRaw] = useState(location.lng === undefined ? '' : String(location.lng));
  const [mapsLink, setMapsLink] = useState('');
  const [mapsLinkError, setMapsLinkError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleUseMapsLink() {
    const coords = parseGoogleMapsCoords(mapsLink);
    if (!coords) {
      setMapsLinkError(true);
      return;
    }
    setMapsLinkError(false);
    setLatRaw(String(coords.lat));
    setLngRaw(String(coords.lng));
  }

  // Checklist-row click → scroll to + briefly highlight the matching input.
  useEffect(() => {
    if (!focusInputId) return;
    const el = document.getElementById(focusInputId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-[#1a3a7a]');
    const t = setTimeout(() => el.classList.remove('ring-2', 'ring-[#1a3a7a]'), 2000);
    return () => clearTimeout(t);
  }, [focusInputId]);

  // Dirty tracking — Save stays disabled until something actually changed,
  // so the "only changed fields are sent" rule can't be triggered by accident
  // (an unchanged save would still re-stamp scraped fields as verified).
  const isDirty =
    name !== (location.name ?? '') ||
    address !== (location.address ?? '') ||
    priceText !== (location.priceText ?? '') ||
    hoursText !== (location.hoursText ?? '') ||
    notes !== (location.notes ?? '') ||
    clearanceText !== (location.clearanceText ?? '') ||
    ingressEgress !== (location.ingressEgress ?? '') ||
    latRaw !== (location.lat === undefined ? '' : String(location.lat)) ||
    lngRaw !== (location.lng === undefined ? '' : String(location.lng)) ||
    stallsTotalRaw !== (location.stallsTotal === undefined || location.stallsTotal === null ? '' : String(location.stallsTotal)) ||
    access247 !== location.access247 ||
    fenced !== location.fenced ||
    lit !== location.lit ||
    surfaceType !== (location.surfaceType ?? undefined);

  // Escape / X / overlay-click all route through here — a dirty form
  // confirms before dropping edits on the floor.
  function requestClose() {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  function buildEdits(): SourcedLocationEdits {
    const stalls = stallsTotalRaw.trim() === '' ? undefined : Number(stallsTotalRaw);
    const lat = latRaw.trim() === '' ? undefined : Number(latRaw);
    const lng = lngRaw.trim() === '' ? undefined : Number(lngRaw);
    return {
      name: name.trim() || undefined,
      address: address.trim() || undefined,
      priceText: priceText.trim() || undefined,
      hoursText: hoursText.trim() || undefined,
      notes: notes.trim() || undefined,
      // ponytail: text fields can't be cleared from here (same as
      // name/address above) — only overwritten with a new value.
      clearanceText: clearanceText.trim() || undefined,
      ingressEgress: ingressEgress.trim() || undefined,
      // Only send a field when it actually changed vs the record —
      // otherwise saving would re-stamp scraped values as verified.
      ...(access247 !== location.access247 ? { access247 } : {}),
      ...(fenced !== location.fenced ? { fenced } : {}),
      ...(lit !== location.lit ? { lit } : {}),
      ...(surfaceType !== (location.surfaceType ?? undefined) ? { surfaceType } : {}),
      ...(stalls !== undefined && stalls !== location.stallsTotal && !Number.isNaN(stalls)
        ? { stallsTotal: stalls }
        : {}),
      ...(lat !== undefined && lat !== location.lat && !Number.isNaN(lat) ? { lat } : {}),
      ...(lng !== undefined && lng !== location.lng && !Number.isNaN(lng) ? { lng } : {}),
    };
  }

  function handleSave() {
    if (!isDirty || submitted) return;
    setSubmitted(true);
    onSave(buildEdits());
  }

  const inputCls =
    'w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm focus:outline-none focus:border-[#1a3a7a] focus:ring-2 focus:ring-[#1a3a7a]/15';
  const labelCls = 'text-xs font-medium text-[#0e1c36]/70';
  return (
    <Dialog open onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="flex flex-col min-h-0 flex-1"
        >
          {/* Sticky header */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-[#0e1c36]/10 space-y-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-base">Edit sourced location</DialogTitle>
              <StatusBadge status={location.status} />
              <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
                {location.source}
              </span>
            </div>
            <DialogDescription className="text-xs">
              Saved fields are marked verified — a human confirmed them. Only changed fields are sent.
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            <details>
              <summary className="cursor-pointer select-none text-[10px] font-mono font-semibold uppercase tracking-[.14em] text-[#0e1c36]/40 hover:text-[#0e1c36]/70">
                Hard filters &amp; provenance (computed, read-only)
              </summary>
              <div className="mt-2">
                <DetailsSummary location={location} />
              </div>
            </details>

            <div className="space-y-3">
              <PopupSectionLabel>Identity</PopupSectionLabel>
              <div>
                <label htmlFor="edit-name" className={labelCls}>Name</label>
                <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="edit-address" className={labelCls}>Address</label>
                <input id="edit-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="space-y-3">
              <PopupSectionLabel>Location</PopupSectionLabel>
              <div className="p-3 bg-[#0e1c36]/[.03] border border-[#0e1c36]/10 rounded">
                <label htmlFor="edit-mapsLink" className={cn(labelCls, 'leading-snug block')}>
                  No coordinates? Look the address up on Google Maps, copy the place link, paste it here
                </label>
                <div className="flex gap-2 mt-1.5">
                  <input
                    id="edit-mapsLink"
                    value={mapsLink}
                    onChange={(e) => { setMapsLink(e.target.value); setMapsLinkError(false); }}
                    placeholder="https://www.google.com/maps/place/..."
                    className="flex-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm focus:outline-none focus:border-[#1a3a7a] focus:ring-2 focus:ring-[#1a3a7a]/15"
                  />
                  <button
                    type="button"
                    onClick={handleUseMapsLink}
                    className="px-3 py-2 text-xs font-mono uppercase tracking-[.06em] border border-[#0e1c36]/30 text-[#0e1c36] rounded transition-colors hover:border-[#0e1c36] hover:bg-[#afcbff] shrink-0"
                  >
                    Use link
                  </button>
                </div>
                {mapsLinkError && (
                  <p className="text-[10px] text-[#c1121f] mt-1">
                    Couldn’t find coordinates in that link — paste the full Google Maps URL from the address bar.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label htmlFor="edit-lat" className="text-[10px] text-[#0e1c36]/50">Latitude</label>
                    <input
                      id="edit-lat"
                      type="number"
                      step="any"
                      value={latRaw}
                      onChange={(e) => setLatRaw(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-lng" className="text-[10px] text-[#0e1c36]/50">Longitude</label>
                    <input
                      id="edit-lng"
                      type="number"
                      step="any"
                      value={lngRaw}
                      onChange={(e) => setLngRaw(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <PopupSectionLabel>Commercial</PopupSectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-priceText" className={labelCls}>Price</label>
                  <input id="edit-priceText" value={priceText} onChange={(e) => setPriceText(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-hoursText" className={labelCls}>Hours</label>
                  <input id="edit-hoursText" value={hoursText} onChange={(e) => setHoursText(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-stallsTotal" className={labelCls}>Stall count</label>
                  <input
                    id="edit-stallsTotal"
                    type="number"
                    min={0}
                    value={stallsTotalRaw}
                    onChange={(e) => setStallsTotalRaw(e.target.value)}
                    className={inputCls}
                  />
                  <p className="text-[10px] text-[#0e1c36]/40 mt-0.5">
                    Only if a source states a number — never estimate.
                  </p>
                </div>
                <div>
                  <label htmlFor="edit-clearanceText" className={labelCls}>Clearance</label>
                  <input
                    id="edit-clearanceText"
                    value={clearanceText}
                    onChange={(e) => setClearanceText(e.target.value)}
                    placeholder={'e.g. 6\'8"'}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="edit-ingressEgress" className={labelCls}>Ingress / egress</label>
                <input
                  id="edit-ingressEgress"
                  value={ingressEgress}
                  onChange={(e) => setIngressEgress(e.target.value)}
                  placeholder="e.g. one-way in, separate exit on SE 2nd St"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="space-y-3">
              <PopupSectionLabel>Site traits</PopupSectionLabel>
              <div>
                <label className={labelCls}>Surface type</label>
                <div className="flex gap-1 mt-1" role="group" aria-label="Surface type">
                  {([
                    { label: 'Surface', v: 'surface' as const },
                    { label: 'Structured', v: 'structured' as const },
                    { label: "Don't know", v: null },
                  ]).map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setSurfaceType(o.v)}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded border transition-colors',
                        surfaceType === o.v && o.v !== undefined
                          ? 'bg-[#afcbff] text-[#0e1c36] border-[#0e1c36]/40 font-semibold'
                          : 'border-[#0e1c36]/20 text-[#0e1c36]/70 hover:border-[#0e1c36]/50',
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <TriStateControl id="edit-access247" label="24/7 access" value={access247} onChange={setAccess247} />
                <TriStateControl id="edit-fenced" label="Fenced" value={fenced} onChange={setFenced} />
                <TriStateControl id="edit-lit" label="Lit" value={lit} onChange={setLit} />
              </div>
            </div>

            <div className="space-y-3">
              <PopupSectionLabel>Notes</PopupSectionLabel>
              <textarea
                id="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className={cn(inputCls, 'resize-none')}
              />
            </div>
          </div>

          {/* Sticky footer */}
          <div className="px-6 py-3 border-t border-[#0e1c36]/10 bg-white flex items-center justify-between gap-3">
            <p className={cn('text-[10px] font-mono uppercase tracking-wide', isDirty ? 'text-[#8a6d1a]' : 'text-[#0e1c36]/35')}>
              {isDirty ? '● Unsaved changes' : 'No changes'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="px-3 py-1.5 text-sm border border-[#0e1c36]/25 text-[#0e1c36] rounded transition-colors hover:border-[#0e1c36] hover:bg-[#afcbff]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isDirty || submitted}
                className="px-4 py-1.5 text-sm bg-[#0e1c36] text-[#f9fbf2] rounded transition-colors hover:bg-[#1a3a7a] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitted ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Column builder for the review table below — one place defining the lean
// column set (the 9 hard-filter badge columns collapsed into one chip col).
const columnHelper = createColumnHelper<SourcedParkingLocation>();

export function SourcingReviewTable({
  initialLocations,
  totalCount,
  filters,
  onFilterPatch,
  toolbar,
  actions,
}: {
  initialLocations: SourcedParkingLocation[];
  /** Unfiltered total, for "X of Y" — omit when there's nothing to compare against. */
  totalCount?: number;
  /** Current URL-synced filter state — drives the triage strip's active chips. */
  filters: ReviewFilters;
  /** Writes filter patches into the same URL-synced state the filter bar uses. */
  onFilterPatch: (patch: Partial<ReviewFilters>) => void;
  /** Slot for the filter controls — rendered inside the Filters popover. */
  toolbar?: React.ReactNode;
  /** Slot for page-level actions (e.g. the Add-lot menu) — rendered at the
   * far right of the status strip, after the view toggle. */
  actions?: React.ReactNode;
}) {
  const [locations, setLocations] = useState(initialLocations);
  const [editing, setEditing] = useState<SourcedParkingLocation | null>(null);
  const [viewing, setViewing] = useState<SourcedParkingLocation | null>(null);
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<'table' | 'map'>('table');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [outreachMap, setOutreachMap] = useState<Record<string, OutreachRecord>>({});

  // Single batch query for all outreach records — one Firestore read
  // instead of N individual server actions (was N+1, one per lot).
  useEffect(() => {
    let cancelled = false;
    const ids = locations.map((l) => l.id);
    getOutreachBatch(ids).then((map) => {
      if (cancelled) return;
      setOutreachMap(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [locations]);

  const showToast = useCallback((t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  }, []);

  // Only ever referenced from inside the columns memo below (the row-level
  // toggle button is a column cell now), so useCallback keeps its identity
  // stable and the memoized column defs stay valid across renders.
  const handleToggleStatus = useCallback((location: SourcedParkingLocation) => {
    const next: SourcingStatus = location.status === 'saved' ? 'draft' : 'saved';
    setLocations((prev) => prev.map((l) => (l.id === location.id ? { ...l, status: next } : l)));
    startTransition(async () => {
      try {
        await setSourcingStatus(location.id, next);
      } catch (err) {
        setLocations((prev) => prev.map((l) => (l.id === location.id ? { ...l, status: location.status } : l)));
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update status' });
      }
    });
  }, [showToast]);

  const handleSaveEdit = (edits: SourcedLocationEdits) => {
    if (!editing) return;
    const id = editing.id;
    startTransition(async () => {
      try {
        const updated = await updateSourcedLocation(id, edits);
        setLocations((prev) => prev.map((l) => (l.id === id ? updated : l)));
        showToast({ type: 'success', message: 'Saved' });
        setEditing(null);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  };

  // Type left to inference — columnHelper produces precisely-typed defs,
  // and an explicit ColumnDef<TData, unknown> annotation fights the
  // per-column TValue variance TanStack uses.
  const columns = useMemo(() => [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => (
        <a
          href={row.original.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title={row.original.name}
          className="block max-w-[16rem] truncate text-[#0e1c36] hover:text-[#1a3a7a] hover:underline"
        >
          {row.original.name}
        </a>
      ),
    }),
    columnHelper.accessor('source', {
      header: 'Source',
      cell: ({ getValue }) => (
        <span className="text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/60">
          {getValue()}
        </span>
      ),
    }),
    columnHelper.display({
      id: 'priceHours',
      header: 'Price / Hours',
      cell: ({ row }) => (
        <span
          className="text-xs text-[#0e1c36]/60 max-w-[10rem] truncate block"
          title={`${row.original.priceText || '—'} / ${row.original.hoursText || '—'}`}
        >
          {row.original.priceText || '—'} / {row.original.hoursText || '—'}
        </span>
      ),
    }),
    columnHelper.accessor('address', {
      header: 'Address',
      cell: ({ getValue }) => (
        <span className="text-xs text-[#0e1c36]/60 max-w-xs truncate block">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleToggleStatus(row.original); }}
          onDoubleClick={(e) => e.stopPropagation()}
          disabled={isPending}
          className="disabled:opacity-50"
          title="Click to toggle draft/saved"
        >
          <StatusBadge status={row.original.status} />
        </button>
      ),
    }),
    // One column replaces the nine yes/no badge columns; hover the chip for
    // the full verdict grid (HardFiltersCell). Worst-first on first sort.
    columnHelper.accessor((l) => hardFilterTriageRank(l), {
      id: 'hardFilters',
      header: 'Filters',
      sortDescFirst: true,
      sortingFn: (a, b) => Number(a.getValue('hardFilters')) - Number(b.getValue('hardFilters')),
      cell: ({ row }) => <HardFiltersCell location={row.original} />,
    }),
    columnHelper.display({
      id: 'odd',
      header: 'ODD',
      cell: ({ row }) => <OddBadge location={row.original} />,
    }),
    columnHelper.display({
      id: 'ev',
      header: 'EV',
      cell: ({ row }) => <EvBadge location={row.original} />,
    }),
    columnHelper.display({
      id: 'demand',
      header: 'Demand',
      cell: ({ row }) => <DemandBadge location={row.original} />,
    }),
    columnHelper.display({
      id: 'provenance',
      header: 'Provenance',
      cell: ({ row }) => <ProvenanceSummary location={row.original} />,
    }),
    columnHelper.display({
      id: 'outreach',
      header: 'Outreach',
      cell: ({ row }) => {
        const o = outreachMap[row.original.id];
        if (!o) return <span className="text-[#0e1c36]/30">—</span>;
        return (
          <span
            className="text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap bg-[#afcbff]/20 border-[#1a3a7a]/20 text-[#1a3a7a]"
            title={`State: ${OUTREACH_STATE_LABELS[o.outreachState]} · BDR: ${o.bdrOwner || '—'}`}
          >
            {OUTREACH_STATE_LABELS[o.outreachState]}
          </span>
        );
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(row.original); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="px-2 py-1 text-[#0e1c36] bg-[#0e1c36]/5 border border-[#0e1c36]/15 rounded text-[9px] hover:bg-[#0e1c36]/10"
        >
          Edit
        </button>
      ),
    }),
    // Handlers referenced above are defined before this memo; they only
    // close over stable setters, so the cached closures stay correct.
  ], [isPending, handleToggleStatus]);

  const table = useReactTable({
    data: locations,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedLocations = table.getRowModel().rows.map((r) => r.original);

  // How many filter dimensions are off-default right now — shown as a count
  // on the Filters trigger so applied state stays visible while collapsed.
  const activeFilterCount = (
    ['search', 'locality', 'status', 'source', 'flood', 'residential', 'addedBy', 'odd', 'hasCoords'] as const
  ).filter(
    (k) =>
      k === 'search'
        ? filters.search.trim() !== EMPTY_REVIEW_FILTERS.search
        : filters[k] !== EMPTY_REVIEW_FILTERS[k],
  ).length;

  // One status strip: Filters trigger (the full control set lives in its
  // popover — most visits are read/browse, not triage), count, triage chips,
  // view toggle. The popover stays open while controls are used; clicking
  // outside dismisses it.
  return (
    <TooltipProvider delayDuration={150}>
      {editing && <EditPopup location={editing} onSave={handleSaveEdit} onClose={() => setEditing(null)} />}
      {viewing && (
        <ViewDetailsPopup
          location={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
        />
      )}

      <div className="border border-[#0e1c36]/12 bg-white">
        <div className="px-3 py-2 border-b border-[#0e1c36]/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {toolbar && (
              <Popover>
                <PopoverTrigger
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-[.08em] border rounded transition-colors',
                    activeFilterCount > 0
                      ? 'border-[#0e1c36]/40 bg-[#afcbff]/20 text-[#0e1c36] font-semibold hover:bg-[#afcbff]/40'
                      : 'border-[#0e1c36]/30 text-[#0e1c36] bg-transparent hover:border-[#0e1c36] hover:bg-[#afcbff]',
                  )}
                >
                  <ListFilter className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[#0e1c36] text-[#f9fbf2] text-[9px] font-semibold">
                      {activeFilterCount}
                    </span>
                  )}
                </PopoverTrigger>
                <PopoverContent className="w-[min(44rem,calc(100vw-2rem))]">
                  {toolbar}
                </PopoverContent>
              </Popover>
            )}
            <p className="text-sm text-[#0e1c36]/50">
              {`${locations.length}${typeof totalCount === 'number' && totalCount !== locations.length ? ` of ${totalCount}` : ''} sourced location${locations.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <HardFilterSummaryStrip locations={locations} filters={filters} onFilterPatch={onFilterPatch} />
            <SegmentedToggle
              value={view}
              onChange={setView}
              options={[
                { value: 'table', label: 'Table' },
                { value: 'map', label: 'Map' },
              ]}
            />
            <button
              onClick={async () => {
                try {
                  const csv = await exportOutreachCsv();
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `outreach-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  showToast({ type: 'error', message: err instanceof Error ? err.message : 'Export failed' });
                }
              }}
              className="px-2 py-1 text-[10px] font-mono uppercase tracking-wide border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5 text-[#0e1c36]/60"
            >
              CSV ↗
            </button>
            {actions && <div className="flex items-center gap-2 ml-1">{actions}</div>}
          </div>
        </div>
        {view === 'map' ? (
          <div className="p-2">
            <ParkingSourcingMap locations={sortedLocations} onSelect={setViewing} />
          </div>
        ) : locations.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#0e1c36]/40">No sourced locations yet.</p>
        ) : (
          <div className="overflow-x-scroll">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
                    {hg.headers.map((header) => {
                      const sortable = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                          className={cn(
                            'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[.1em] whitespace-nowrap',
                            sortable && 'cursor-pointer select-none hover:text-[#1a3a7a]/70',
                            sorted ? 'text-[#1a3a7a]' : 'text-[#0e1c36]/40',
                          )}
                        >
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-[#0e1c36]/8">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    // Single click = view (the most common need on this row);
                    // double-click stays as the edit shortcut; the explicit
                    // Edit button covers everyone who never finds that.
                    onClick={() => setViewing(row.original)}
                    onDoubleClick={() => setEditing(row.original)}
                    title="Click to view details · double-click to edit"
                    className="hover:bg-[#0e1c36]/[.02] cursor-pointer"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
