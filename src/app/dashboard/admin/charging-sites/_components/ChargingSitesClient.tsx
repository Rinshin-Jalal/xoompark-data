'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { FilterChip } from '@/components/shared/FilterChip';
import type { ChargingSite, ClearanceStatus, SavedChargingLocation } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  bulkImportClearance,
  deleteSavedChargingLocation,
  findChargingSites,
  saveChargingLocation,
  updateChargingLocationClearance,
  updateChargingLocationNotes,
  updateChargingLocationOwnerName,
} from '../actions';
import { clearanceFit, formatClearance, parseClearanceCsv } from '../lib/clearance';
import { FLEET_LABEL, FLEET_OPERATORS, isInOdd, isTeslaNetwork, type FleetOperator } from '@/lib/odd/odd';
import { assessorLookupUrl, linkedInSearchUrl, pitchTemplate } from '../lib/outreach';
import { ChargingSitesMap } from './ChargingSitesMap';

// Anchor coordinates already used by the Pit Stop Finder's metro configs —
// reused here as quick-pick search centers instead of re-deriving new ones.
const METRO_PRESETS = [
  { name: 'San Francisco', lat: 37.7793, lng: -122.4194 },
  { name: 'San Diego', lat: 32.7157, lng: -117.1611 },
  { name: 'Miami', lat: 25.7617, lng: -80.1918 },
  { name: 'Austin', lat: 30.2672, lng: -97.7431 },
  { name: 'Dallas', lat: 32.7767, lng: -96.797 },
  { name: 'Phoenix', lat: 33.4484, lng: -112.074 },
  { name: 'Las Vegas', lat: 36.1699, lng: -115.1398 },
];

type Toast = { type: 'success' | 'error'; message: string };

const savedColumnHelper = createColumnHelper<SavedChargingLocation>();

function badgeClasses(kind: 'fits' | 'too-low' | 'unverified') {
  if (kind === 'fits') return 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]';
  if (kind === 'too-low') return 'bg-[#ffe1e1] border-[#ffcccc] text-[#7a1a1a]';
  return 'bg-[#0e1c36]/5 border-[#0e1c36]/15 text-[#0e1c36]/50';
}

const OVERLAY = 'fixed inset-0 bg-white/30 backdrop-blur-md flex items-center justify-center z-50';
const PANEL = 'bg-white rounded-lg shadow-xl border border-[#0e1c36]/10';

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">{label}</div>
      <div className="text-sm text-[#0e1c36]">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-[#0e1c36]/40 mt-5 mb-2 first:mt-0">{children}</div>;
}

// One popup covers both cases: a live AFDC search result the user hasn't
// saved yet (read-only snapshot + a Save button) and an already-saved
// location (same snapshot, plus our own editable clearance/notes - the two
// fields AFDC doesn't carry and a refresh must never overwrite).
function LocationDetailPopup({
  site,
  location,
  onSave,
  onClearanceSave,
  onNotesSave,
  onOwnerNameSave,
  onDelete,
  onClose,
}: {
  site?: ChargingSite;
  location?: SavedChargingLocation;
  onSave?: () => void;
  onClearanceSave?: (v: { inches: number; status: ClearanceStatus; measuredBy?: string; measuredAt?: string } | null) => void;
  onNotesSave?: (notes: string) => void;
  onOwnerNameSave?: (ownerName: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const existing = location?.clearance;
  const [feet, setFeet] = useState(existing ? String(Math.floor(existing.inches / 12)) : '');
  const [inches, setInches] = useState(existing ? String(existing.inches % 12) : '');
  const [status, setStatus] = useState<ClearanceStatus>(existing?.status ?? 'measured');
  const [measuredBy, setMeasuredBy] = useState(existing?.measuredBy ?? '');
  const [measuredAt, setMeasuredAt] = useState(existing?.measuredAt ?? '');
  const [notes, setNotes] = useState(location?.notes ?? '');
  const [ownerName, setOwnerName] = useState(location?.ownerName ?? '');

  const name = site?.name ?? location?.name ?? '';
  const network = site?.network ?? location?.network ?? null;
  const streetAddress = site?.streetAddress ?? location?.streetAddress ?? null;
  const city = site?.city ?? location?.city ?? null;
  const state = site?.state ?? location?.state ?? null;
  const dcFastPorts = site?.dcFastPorts ?? location?.dcFastPorts ?? 0;
  const maxPowerKw = site?.maxPowerKw ?? location?.maxPowerKw ?? null;

  const handleClearanceSave = () => {
    const ft = feet === '' ? 0 : Number.parseInt(feet, 10);
    const inch = inches === '' ? 0 : Number.parseInt(inches, 10);
    const totalInches = ft * 12 + inch;
    onClearanceSave?.(
      !Number.isFinite(totalInches) || totalInches <= 0
        ? null
        : { inches: totalInches, status, measuredBy: measuredBy || undefined, measuredAt: measuredAt || undefined },
    );
  };

  return (
    <div className={OVERLAY} onClick={onClose}>
      <div className={cn(PANEL, 'p-5 w-[28rem] max-h-[85vh] overflow-y-auto')} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[#0e1c36] mb-1">{name}</h3>
        <p className="text-xs text-[#0e1c36]/50 mb-4">
          {[streetAddress, city, state].filter(Boolean).join(', ') || 'No address on file'}
        </p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-2 p-3 bg-[#0e1c36]/[.03] rounded border border-[#0e1c36]/8">
          <DetailRow label="Network" value={network || '—'} />
          <DetailRow label="AFDC ID" value={String(site?.afdcId ?? location?.afdcId ?? '—')} />
          <DetailRow label="DC fast ports" value={String(dcFastPorts)} />
          <DetailRow label="Max power" value={maxPowerKw !== null ? `${maxPowerKw} kW` : '—'} />
          {site && (
            <>
              <DetailRow label="Level 2 ports" value={String(site.level2Ports)} />
              <DetailRow label="Connectors" value={site.connectors.join(', ') || '—'} />
              <DetailRow label="Access" value={site.access} />
              <DetailRow label="Hours" value={site.is247 ? '24/7' : site.accessHours || '—'} />
              <DetailRow label="Pricing" value={site.pricing || '—'} />
              <DetailRow label="Facility type" value={site.facilityType || '—'} />
              <DetailRow label="Distance" value={site.distanceMiles !== null ? `${site.distanceMiles.toFixed(1)} mi` : '—'} />
            </>
          )}
          <div className="col-span-2">
            <DetailRow label="Coords" value={`${(site?.lat ?? location?.lat)?.toFixed(4)}, ${(site?.lng ?? location?.lng)?.toFixed(4)}`} />
          </div>
        </div>
        <p className="text-[10px] text-[#0e1c36]/35 mb-4">
          Snapshot from AFDC — refreshed on save, not editable here.
        </p>

        {location && (
          <>
            <SectionLabel>Clearance</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#0e1c36]/70">Feet</label>
                  <input
                    type="number"
                    min={0}
                    value={feet}
                    onChange={(e) => setFeet(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#0e1c36]/70">Inches</label>
                  <input
                    type="number"
                    min={0}
                    max={11}
                    value={inches}
                    onChange={(e) => setInches(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ClearanceStatus)}
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm bg-white"
                >
                  <option value="measured">Measured (physically checked)</option>
                  <option value="signposted">Signposted (from posted sign only)</option>
                  <option value="unknown">Unknown — clear the value</option>
                </select>
                <p className="text-[11px] text-[#0e1c36]/40 mt-1">
                  &quot;Unknown&quot; excludes this site from any vehicle-fit filter — it never reads as passable.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Measured by</label>
                <input
                  value={measuredBy}
                  onChange={(e) => setMeasuredBy(e.target.value)}
                  placeholder="Name"
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Date</label>
                <input
                  type="date"
                  value={measuredAt}
                  onChange={(e) => setMeasuredAt(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                />
              </div>
              <button
                onClick={handleClearanceSave}
                className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5"
              >
                Save clearance
              </button>
            </div>

            <SectionLabel>Notes</SectionLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => onNotesSave?.(notes)}
              rows={3}
              className="w-full px-3 py-2 border border-[#0e1c36]/20 rounded text-sm resize-none"
            />
          </>
        )}

        <SectionLabel>Outreach path (Greg&apos;s playbook)</SectionLabel>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-[#0e1c36]/70 mb-1">1. County assessor → property owner</div>
            <a
              href={assessorLookupUrl({ streetAddress, city, state })}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#1a3a7a] underline"
            >
              Search county assessor for this address ↗
            </a>
          </div>

          {location && (
            <div>
              <label className="text-xs font-medium text-[#0e1c36]/70">Owner name (from assessor)</label>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                onBlur={() => onOwnerNameSave?.(ownerName)}
                placeholder="Not looked up yet"
                className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
              />
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-[#0e1c36]/70 mb-1">2. LinkedIn — pick the best profile to pitch</div>
            {ownerName ? (
              <a href={linkedInSearchUrl(ownerName)} target="_blank" rel="noreferrer" className="text-xs text-[#1a3a7a] underline">
                Search LinkedIn for &quot;{ownerName}&quot; ↗
              </a>
            ) : (
              <p className="text-xs text-[#0e1c36]/35">Fill in the owner name from step 1 first.</p>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-[#0e1c36]/70 mb-1">3. Pitch</div>
            <textarea
              readOnly
              value={pitchTemplate(city)}
              rows={4}
              className="w-full px-3 py-2 border border-[#0e1c36]/20 rounded text-xs text-[#0e1c36]/70 resize-none"
            />
            <button
              onClick={() => navigator.clipboard.writeText(pitchTemplate(city))}
              className="mt-1.5 px-2 py-1 text-[9px] font-mono uppercase tracking-wide border border-[#0e1c36]/15 rounded hover:bg-[#0e1c36]/5"
            >
              Copy pitch
            </button>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5">
          {onDelete && (
            <button
              onClick={onDelete}
              className="mr-auto px-3 py-1.5 text-sm text-[#7a1a1a] bg-[#ffe1e1]/60 border border-[#ffcccc] rounded hover:bg-[#ffe1e1]"
            >
              Remove
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            Close
          </button>
          {onSave && (
            <button onClick={onSave} className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]">
              Save location
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChargingSitesClient({ initialSaved }: { initialSaved: SavedChargingLocation[] }) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('25');
  const [results, setResults] = useState<ChargingSite[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [saved, setSaved] = useState(initialSaved);
  const [detailSite, setDetailSite] = useState<ChargingSite | null>(null);
  const [detailSaved, setDetailSaved] = useState<SavedChargingLocation | null>(null);
  const [requiredFeet, setRequiredFeet] = useState('');
  const [requiredInches, setRequiredInches] = useState('');
  const [isPending, startTransition] = useTransition();
  // Triage lens for the saved table — clearance-unverified is the daily BD
  // task ("go measure these"), so it gets a chip, not a column full of nulls.
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [savedSorting, setSavedSorting] = useState<SortingState>([]);

  // ODD is a lens by default (filters out-of-ODD stations), not a hard
  // delete — limitToOdd starts true but "outreachOnly" is the one combo BD
  // actually wants (non-Tesla, in ODD, 4+ DC ports); it implies the other two.
  // ODD boundaries are fleet-specific (real service-area polygons per
  // provider, see lib/robotaxiServiceAreas.ts) — Waymo is the default since
  // that's who this whole finder is built for, but Tesla/Zoox operate
  // different, non-overlapping footprints (e.g. Vegas is Zoox-only).
  const [fleet, setFleet] = useState<FleetOperator>('waymo');
  const [limitToOdd, setLimitToOdd] = useState(true);
  const [showOddOverlay, setShowOddOverlay] = useState(false);
  const [excludeTesla, setExcludeTesla] = useState(false);
  const [outreachOnly, setOutreachOnly] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.afdcId)), [saved]);

  const filteredResults = useMemo(() => {
    const effLimitToOdd = limitToOdd || outreachOnly;
    const effExcludeTesla = excludeTesla || outreachOnly;
    const minDcPorts = outreachOnly ? 4 : 0;
    return results
      .filter((s) => (effLimitToOdd ? isInOdd(s.lat, s.lng, fleet) : true))
      .filter((s) => (effExcludeTesla ? !isTeslaNetwork(s.network) : true))
      .filter((s) => s.dcFastPorts >= minDcPorts)
      .sort((a, b) => b.dcFastPorts - a.dcFastPorts);
  }, [results, fleet, limitToOdd, excludeTesla, outreachOnly]);

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  const requiredHeightInches = useMemo(() => {
    const ft = requiredFeet === '' ? 0 : Number.parseInt(requiredFeet, 10);
    const inch = requiredInches === '' ? 0 : Number.parseInt(requiredInches, 10);
    const total = ft * 12 + inch;
    return Number.isFinite(total) && total > 0 ? total : null;
  }, [requiredFeet, requiredInches]);

  const runSearch = (searchLat: number, searchLng: number) => {
    setSearching(true);
    setSearchError(null);
    startTransition(async () => {
      try {
        const stations = await findChargingSites({ lat: searchLat, lng: searchLng, radiusMiles: Number(radius) || 25 });
        setResults(stations);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    });
  };

  const handleSearch = () => {
    const la = Number.parseFloat(lat);
    const ln = Number.parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setSearchError('Enter a valid latitude and longitude.');
      return;
    }
    runSearch(la, ln);
  };

  const handleSave = (site: ChargingSite) => {
    startTransition(async () => {
      try {
        await saveChargingLocation(site.afdcId, {
          name: site.name,
          lat: site.lat,
          lng: site.lng,
          network: site.network,
          streetAddress: site.streetAddress,
          city: site.city,
          state: site.state,
          dcFastPorts: site.dcFastPorts,
          maxPowerKw: site.maxPowerKw,
        });
        setSaved((prev) => {
          const next = prev.filter((s) => s.afdcId !== site.afdcId);
          next.push({
            id: String(site.afdcId),
            afdcId: site.afdcId,
            name: site.name,
            lat: site.lat,
            lng: site.lng,
            network: site.network,
            streetAddress: site.streetAddress,
            city: site.city,
            state: site.state,
            dcFastPorts: site.dcFastPorts,
            maxPowerKw: site.maxPowerKw,
            clearance: prev.find((s) => s.afdcId === site.afdcId)?.clearance ?? null,
            portMounting: prev.find((s) => s.afdcId === site.afdcId)?.portMounting ?? null,
            notes: prev.find((s) => s.afdcId === site.afdcId)?.notes ?? null,
            ownerName: prev.find((s) => s.afdcId === site.afdcId)?.ownerName ?? null,
            savedBy: '',
            createdAt: undefined as never,
            updatedAt: undefined as never,
          });
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        showToast({ type: 'success', message: `Saved ${site.name}` });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  };

  const handleClearanceSave = (
    afdcId: number,
    value: { inches: number; status: ClearanceStatus; measuredBy?: string; measuredAt?: string } | null,
  ) => {
    setSaved((prev) => prev.map((s) => (s.afdcId === afdcId ? { ...s, clearance: value } : s)));
    setDetailSaved((prev) => (prev && prev.afdcId === afdcId ? { ...prev, clearance: value } : prev));
    startTransition(async () => {
      try {
        await updateChargingLocationClearance(afdcId, value);
        showToast({ type: 'success', message: 'Clearance saved' });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save clearance' });
      }
    });
  };

  const handleNotesBlur = (afdcId: number, notes: string) => {
    setSaved((prev) => prev.map((s) => (s.afdcId === afdcId ? { ...s, notes } : s)));
    setDetailSaved((prev) => (prev && prev.afdcId === afdcId ? { ...prev, notes } : prev));
    startTransition(async () => {
      try {
        await updateChargingLocationNotes(afdcId, notes);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save notes' });
      }
    });
  };

  const handleOwnerNameSave = (afdcId: number, ownerName: string) => {
    setSaved((prev) => prev.map((s) => (s.afdcId === afdcId ? { ...s, ownerName: ownerName || null } : s)));
    setDetailSaved((prev) => (prev && prev.afdcId === afdcId ? { ...prev, ownerName: ownerName || null } : prev));
    startTransition(async () => {
      try {
        await updateChargingLocationOwnerName(afdcId, ownerName);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save owner name' });
      }
    });
  };

  const handleDelete = (afdcId: number) => {
    setSaved((prev) => prev.filter((s) => s.afdcId !== afdcId));
    setDetailSaved(null);
    startTransition(async () => {
      try {
        await deleteSavedChargingLocation(afdcId);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete' });
      }
    });
  };

  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    const { rows, errors } = parseClearanceCsv(text);

    if (rows.length === 0) {
      showToast({ type: 'error', message: errors.length ? `No valid rows — ${errors.length} error(s)` : 'File was empty' });
      return;
    }

    startTransition(async () => {
      try {
        const { updated, skipped } = await bulkImportClearance(rows);
        const byId = new Map(rows.map((r) => [r.afdcId, r]));
        setSaved((prev) =>
          prev.map((s) => {
            const row = updated.includes(s.afdcId) ? byId.get(s.afdcId) : undefined;
            return row
              ? { ...s, clearance: { inches: row.inches, status: row.status, measuredBy: row.measuredBy, measuredAt: row.measuredAt } }
              : s;
          }),
        );
        const parts = [`${updated.length} updated`];
        if (skipped.length) parts.push(`${skipped.length} skipped (not saved yet)`);
        if (errors.length) parts.push(`${errors.length} row error(s)`);
        showToast({ type: skipped.length || errors.length ? 'error' : 'success', message: parts.join(', ') });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Import failed' });
      }
    });
  };

  // Saved table — TanStack for the same sortable headers the sourcing and
  // pitstop tables have (consistency beats a bespoke comparator here).
  const visibleSaved = useMemo(
    () => (unverifiedOnly ? saved.filter((s) => !s.clearance) : saved),
    [saved, unverifiedOnly],
  );
  const savedColumns = useMemo(
    () => [
      savedColumnHelper.accessor('name', { header: 'Name' }),
      savedColumnHelper.accessor('city', {
        header: 'City',
        cell: ({ getValue }) => <span className="text-xs text-[#0e1c36]/60">{getValue() || '—'}</span>,
      }),
      savedColumnHelper.accessor('dcFastPorts', {
        header: 'DC Ports',
        cell: ({ getValue }) => <span className="font-mono text-xs text-[#0e1c36]/60">{getValue()}</span>,
      }),
      savedColumnHelper.accessor('maxPowerKw', {
        header: 'Max kW',
        cell: ({ getValue }) => <span className="font-mono text-xs text-[#0e1c36]/60">{getValue() !== null ? `${getValue()} kW` : '—'}</span>,
      }),
      savedColumnHelper.accessor((s) => s.clearance?.inches ?? null, {
        id: 'clearance',
        header: 'Clearance',
        cell: ({ row }) => (
          <span className="text-xs text-[#0e1c36]/60">{formatClearance(row.original.clearance)}</span>
        ),
      }),
      savedColumnHelper.display({
        id: 'fit',
        header: 'Fit',
        cell: ({ row }) => {
          const fit = requiredHeightInches !== null ? clearanceFit(row.original.clearance, requiredHeightInches) : null;
          return fit ? (
            <span className={cn('text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border', badgeClasses(fit))}>
              {fit === 'fits' ? 'fits' : fit === 'too-low' ? 'too low' : 'unverified'}
            </span>
          ) : null;
        },
      }),
      savedColumnHelper.display({
        id: 'notes',
        header: 'Notes',
        cell: ({ row }) => (
          <input
            defaultValue={row.original.notes ?? ''}
            onBlur={(e) => handleNotesBlur(row.original.afdcId, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="—"
            className="w-full max-w-xs bg-transparent border-b border-transparent hover:border-[#0e1c36]/15 focus:border-[#0e1c36]/40 focus:outline-none text-xs"
          />
        ),
      }),
      savedColumnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row.original.afdcId);
            }}
            disabled={isPending}
            className="px-2 py-1 text-[#7a1a1a] bg-[#ffe1e1]/60 border border-[#ffcccc] rounded text-[9px] hover:bg-[#ffe1e1] disabled:opacity-50"
          >
            Remove
          </button>
        ),
      }),
    ],
    // Handlers above only close over stable setters; requiredHeightInches
    // and isPending are in deps because their cells render from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requiredHeightInches, isPending],
  );
  const savedTable = useReactTable({
    data: visibleSaved,
    columns: savedColumns,
    state: { sorting: savedSorting },
    onSortingChange: setSavedSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      {detailSite && !savedIds.has(detailSite.afdcId) && (
        <LocationDetailPopup
          site={detailSite}
          onSave={() => {
            handleSave(detailSite);
            setDetailSite(null);
          }}
          onClose={() => setDetailSite(null)}
        />
      )}
      {detailSaved && (
        <LocationDetailPopup
          location={detailSaved}
          onClearanceSave={(v) => handleClearanceSave(detailSaved.afdcId, v)}
          onNotesSave={(notes) => handleNotesBlur(detailSaved.afdcId, notes)}
          onOwnerNameSave={(ownerName) => handleOwnerNameSave(detailSaved.afdcId, ownerName)}
          onDelete={() => {
            handleDelete(detailSaved.afdcId);
            setDetailSaved(null);
          }}
          onClose={() => setDetailSaved(null)}
        />
      )}

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="border border-[#0e1c36]/12 bg-white p-4 mb-6">
        <div className="flex flex-wrap gap-2 mb-3">
          {METRO_PRESETS.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                setLat(String(m.lat));
                setLng(String(m.lng));
                runSearch(m.lat, m.lng);
              }}
              className="px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.1em] border border-[#0e1c36]/20 rounded-md hover:border-[#0e1c36]/50 bg-white text-[#0e1c36]/60"
            >
              {m.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Latitude</label>
            <input value={lat} onChange={(e) => setLat(e.target.value)} className="block mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm w-32" />
          </div>
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Longitude</label>
            <input value={lng} onChange={(e) => setLng(e.target.value)} className="block mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm w-32" />
          </div>
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Radius (mi)</label>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} className="block mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm w-24" />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Search AFDC'}
          </button>
        </div>
        {searchError && <p className="text-xs text-[#c1121f] mt-2">{searchError}</p>}

        {results.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#0e1c36]/70">
              <label className="flex items-center gap-1.5">
                Fleet ODD
                <select
                  value={fleet}
                  onChange={(e) => setFleet(e.target.value as FleetOperator)}
                  className="border border-[#0e1c36]/20 rounded px-1.5 py-0.5 bg-white text-xs"
                >
                  {FLEET_OPERATORS.map((f) => (
                    <option key={f} value={f}>
                      {FLEET_LABEL[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={limitToOdd} onChange={(e) => setLimitToOdd(e.target.checked)} />
                Limit to {FLEET_LABEL[fleet]} ODD
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showOddOverlay} onChange={(e) => setShowOddOverlay(e.target.checked)} />
                Show ODD on map
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={excludeTesla} onChange={(e) => setExcludeTesla(e.target.checked)} />
                Exclude Tesla network
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={outreachOnly} onChange={(e) => setOutreachOnly(e.target.checked)} />
                Outreach subset only (non-Tesla, in ODD, 4+ DC ports)
              </label>
              <label className="flex items-center gap-1.5 ml-auto">
                <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} />
                Show map
              </label>
            </div>
            <p className="mt-1 text-[10px] text-[#0e1c36]/35">
              {filteredResults.length} of {results.length} shown, sorted by DC ports descending. ODD is {FLEET_LABEL[fleet]}
              &apos;s real published service-area boundary (see lib/robotaxiServiceAreas.ts) — a lens, not a hard delete;
              uncheck &quot;Limit to {FLEET_LABEL[fleet]}{' '}ODD&quot; to include all.
            </p>

            {showMap && (
              <div className="mt-3">
                <ChargingSitesMap sites={filteredResults} showOdd={showOddOverlay} fleet={fleet} onSelect={(s) => setDetailSite(s)} />
              </div>
            )}

            <div className="mt-3 border border-[#0e1c36]/10 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
                    {['Name', 'Network', 'Address', 'City', 'DC Ports', 'Max kW', 'Distance', ''].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0e1c36]/8">
                  {filteredResults.map((s) => (
                    <tr
                      key={s.afdcId}
                      onClick={() => setDetailSite(s)}
                      className="cursor-pointer hover:bg-[#0e1c36]/[.02]"
                      title="Click to view full detail"
                    >
                      <td className="px-3 py-2 text-xs text-[#0e1c36] whitespace-nowrap">{s.name}</td>
                      <td className="px-3 py-2 text-xs text-[#0e1c36]/60 whitespace-nowrap">{s.network || '—'}</td>
                      <td className="px-3 py-2 text-xs text-[#0e1c36]/60 whitespace-nowrap">{s.streetAddress || '—'}</td>
                      <td className="px-3 py-2 text-xs text-[#0e1c36]/60 whitespace-nowrap">{s.city || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[#0e1c36]/60 whitespace-nowrap">{s.dcFastPorts}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[#0e1c36]/60 whitespace-nowrap">
                        {s.maxPowerKw !== null ? `${s.maxPowerKw} kW` : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[#0e1c36]/60 whitespace-nowrap">
                        {s.distanceMiles !== null ? `${s.distanceMiles.toFixed(1)} mi` : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {savedIds.has(s.afdcId) ? (
                          <span className="text-[9px] font-mono uppercase tracking-wide text-[#1a5a2a] bg-[#dff5e1] border border-[#c8ecc9] px-2 py-0.5 rounded-full">
                            saved
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSave(s);
                            }}
                            disabled={isPending}
                            className="px-2 py-1 text-[#0e1c36] bg-[#0e1c36]/5 border border-[#0e1c36]/15 rounded text-[9px] hover:bg-[#0e1c36]/10 disabled:opacity-50"
                          >
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Saved locations ────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[#0e1c36]/50">{saved.length} saved location{saved.length === 1 ? '' : 's'}</p>
          <div className="mt-1.5">
            <FilterChip
              active={unverifiedOnly}
              onClick={() => setUnverifiedOnly((v) => !v)}
            >
              {saved.filter((s) => !s.clearance).length} unverified clearance
            </FilterChip>
          </div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCsvFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={isPending}
            className="mt-1 px-2 py-1 text-[#0e1c36] bg-[#0e1c36]/5 border border-[#0e1c36]/15 rounded text-[10px] font-mono uppercase tracking-wide hover:bg-[#0e1c36]/10 disabled:opacity-50"
          >
            Import clearance CSV
          </button>
          <p className="text-[10px] text-[#0e1c36]/35 mt-1">
            Columns: afdcId,inches,status,measuredBy,measuredAt — only updates locations already saved below.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Required clearance — ft</label>
            <input
              type="number"
              min={0}
              value={requiredFeet}
              onChange={(e) => setRequiredFeet(e.target.value)}
              className="block mt-1 px-3 py-1.5 border border-[#0e1c36]/20 rounded text-sm w-20"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">in</label>
            <input
              type="number"
              min={0}
              max={11}
              value={requiredInches}
              onChange={(e) => setRequiredInches(e.target.value)}
              className="block mt-1 px-3 py-1.5 border border-[#0e1c36]/20 rounded text-sm w-16"
            />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-[#0e1c36]/40 mb-2">
        Named vehicle profiles (van, box truck, …) are on the roadmap once real fleet spec-sheet
        heights are available — enter the required height directly for now.
        {requiredHeightInches !== null && (
          <>
            {' '}Vehicle-fit column below is computed against a {Math.floor(requiredHeightInches / 12)}&apos;
            {requiredHeightInches % 12}&quot; requirement. Sites with no measured clearance always show
            &quot;unverified&quot; — they never count as a fit.
          </>
        )}
      </p>

      <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto">
        {saved.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-[#0e1c36]/40">No saved charging locations yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              {savedTable.getHeaderGroups().map((hg) => (
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
              {savedTable.getRowModel().rows.map((row) => {
                const s = row.original;
                const fit = requiredHeightInches !== null ? clearanceFit(s.clearance, requiredHeightInches) : null;
                return (
                  <tr
                    key={s.afdcId}
                    onClick={() => setDetailSaved(s)}
                    className="cursor-pointer hover:bg-[#0e1c36]/[.02]"
                    title="Click to view / edit"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                        {cell.column.id === 'fit' && fit === null ? (
                          <span className="text-[10px] text-[#0e1c36]/35" title="Enter the required clearance (top right) to compute vehicle fit">
                            — set height ↗
                          </span>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
