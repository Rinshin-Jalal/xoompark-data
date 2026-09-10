'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { updateSiteStatus, promoteSiteToProspect, updateSiteManualFields, saveFinderResults } from '../actions';
import { cn } from '@/lib/utils';
import type { MetroCode } from '@/lib/types';

interface Site {
  id: string;
  osmId: string;
  lat: number;
  lon: number;
  name: string;
  type: string;
  capacity?: number;
  capacityActual?: number;
  clearanceHeight?: string;
  powerAvailable?: boolean;
  notesInternal?: string;
  storageScore: number;
  stagingScore: number;
  status?: 'new' | 'walk-list' | 'walked' | 'contacted' | 'rejected' | 'signed';
  address?: string;
  owner?: string;
  ownerMailing?: string;
  landUse?: string;
  parcelId?: string;
  zoning?: string;
  ownerDirectCandidate?: boolean;
  nearestAnchor?: string;
  depotMi?: number;
  access?: string;
  fee?: string;
  walkList?: boolean;
  residentialFlag?: string;
  closedAtNight?: boolean;
  openingHours?: string;
  metro: string;
}

type Toast = { type: 'success' | 'error'; message: string };

const statuses = ['new', 'walk-list', 'walked', 'contacted', 'rejected', 'signed'] as const;
type SiteStatus = Site['status'];
type FlagFilter = 'all' | 'surface' | 'ownerDirect' | 'walked' | 'residential' | 'closedAtNight';

const OVERLAY = 'fixed inset-0 bg-white/30 backdrop-blur-md flex items-center justify-center z-50';
const PANEL = 'bg-white rounded-lg shadow-xl border border-[#0e1c36]/10';

interface RowEditFields {
  name: string;
  type: string;
  capacity?: number;
  status: SiteStatus;
  capacityActual?: number;
  clearanceHeight?: string;
  powerAvailable?: boolean;
  notesInternal?: string;
  address?: string;
  owner?: string;
  ownerMailing?: string;
  landUse?: string;
  parcelId?: string;
  zoning?: string;
}

interface RowEditPopupProps {
  site: Site;
  onSave: (fields: RowEditFields) => void;
  onCancel: () => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}

function Field({ label, value, onChange, type = 'text', placeholder }: FieldProps) {
  return (
    <div>
      <label className="text-xs font-medium text-[#0e1c36]/70">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-[#0e1c36]/40 mt-5 mb-2 first:mt-0">{children}</div>;
}

function RowEditPopup({ site, onSave, onCancel }: RowEditPopupProps) {
  const [name, setName] = useState(site.name ?? '');
  const [type, setType] = useState(site.type ?? '');
  const [capacity, setCapacity] = useState(String(site.capacity ?? ''));
  const [status, setStatus] = useState<SiteStatus>(site.status || 'new');
  const [capacityActual, setCapacityActual] = useState(String(site.capacityActual ?? ''));
  const [clearanceHeight, setClearanceHeight] = useState(site.clearanceHeight ?? '');
  const [powerAvailable, setPowerAvailable] = useState(!!site.powerAvailable);
  const [notesInternal, setNotesInternal] = useState(site.notesInternal ?? '');
  const [address, setAddress] = useState(site.address ?? '');
  const [owner, setOwner] = useState(site.owner ?? '');
  const [ownerMailing, setOwnerMailing] = useState(site.ownerMailing ?? '');
  const [landUse, setLandUse] = useState(site.landUse ?? '');
  const [parcelId, setParcelId] = useState(site.parcelId ?? '');
  const [zoning, setZoning] = useState(site.zoning ?? '');

  const handleSave = () => {
    onSave({
      name,
      type,
      capacity: capacity === '' ? undefined : parseFloat(capacity),
      status,
      capacityActual: capacityActual === '' ? undefined : parseFloat(capacityActual),
      clearanceHeight: clearanceHeight || undefined,
      powerAvailable,
      notesInternal: notesInternal || undefined,
      address: address || undefined,
      owner: owner || undefined,
      ownerMailing: ownerMailing || undefined,
      landUse: landUse || undefined,
      parcelId: parcelId || undefined,
      zoning: zoning || undefined,
    });
  };

  return (
    <div className={OVERLAY} onClick={onCancel}>
      <div className={cn(PANEL, 'p-5 w-[28rem] max-h-[85vh] overflow-y-auto')} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[#0e1c36] mb-1">Edit Site</h3>
        <p className="text-xs text-[#0e1c36]/50 mb-4">{site.name}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5 p-3 bg-[#0e1c36]/[.03] rounded border border-[#0e1c36]/8">
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Storage / Staging</div>
            <div className="text-sm font-mono font-semibold text-[#0e1c36]">{site.storageScore} / {site.stagingScore}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Depot distance</div>
            <div className="text-sm text-[#0e1c36]">{site.depotMi ? `${site.depotMi}mi` : '—'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Nearest anchor</div>
            <div className="text-sm text-[#0e1c36]">{site.nearestAnchor || '—'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Owner-direct</div>
            <div className="text-sm text-[#0e1c36]">{site.ownerDirectCandidate ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Access</div>
            <div className="text-sm text-[#0e1c36]">{site.access || '—'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Fee</div>
            <div className="text-sm text-[#0e1c36]">{site.fee || '—'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Walk-list</div>
            <div className="text-sm text-[#0e1c36]">{site.walkList ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Residential</div>
            <div className="text-sm text-[#0e1c36]">{site.residentialFlag || 'No'}</div>
          </div>
          <div className="col-span-2">
            <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Coords</div>
            <div className="text-sm font-mono text-[#0e1c36]">{site.lat?.toFixed(4)}, {site.lon?.toFixed(4)}</div>
          </div>
          {site.openingHours && (
            <div className="col-span-2">
              <div className="text-[9px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Hours</div>
              <div className="text-sm text-[#0e1c36]">{site.openingHours}</div>
            </div>
          )}
        </div>
        <p className="text-[10px] text-[#0e1c36]/35 -mt-3 mb-4">
          Scores and location fields above are recalculated on every &quot;Redo search&quot; and can&apos;t be edited directly.
        </p>

        <SectionLabel>Site Info</SectionLabel>
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Address" value={address} onChange={setAddress} placeholder="Reverse-geocoded, or fill in manually" />
          <Field label="Type" value={type} onChange={setType} placeholder="surface, multi-storey, ..." />
          <Field label="Capacity (estimated)" value={capacity} onChange={setCapacity} type="number" />
        </div>

        <SectionLabel>Owner &amp; Parcel</SectionLabel>
        <div className="space-y-3">
          <Field label="Owner" value={owner} onChange={setOwner} />
          <Field label="Owner mailing address" value={ownerMailing} onChange={setOwnerMailing} />
          <Field label="Land use" value={landUse} onChange={setLandUse} />
          <Field label="Zoning" value={zoning} onChange={setZoning} />
          <Field label="Parcel ID" value={parcelId} onChange={setParcelId} />
        </div>

        <SectionLabel>Workflow</SectionLabel>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SiteStatus)}
              className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm bg-white"
            >
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <Field label="Capacity (actual)" value={capacityActual} onChange={setCapacityActual} type="number" />
          <Field label="Clearance height" value={clearanceHeight} onChange={setClearanceHeight} placeholder={`e.g. 6'8"`} />

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={powerAvailable}
              onChange={(e) => setPowerAvailable(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-[#0e1c36]">Power available</span>
          </label>

          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Notes</label>
            <textarea
              value={notesInternal}
              onChange={(e) => setNotesInternal(e.target.value)}
              rows={3}
              className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromotePopupProps {
  siteName: string;
  defaultCompany: string;
  onSave: (companyName: string, contactName: string, contactEmail: string) => void;
  onCancel: () => void;
}

function PromotePopup({ siteName, defaultCompany, onSave, onCancel }: PromotePopupProps) {
  const [companyName, setCompanyName] = useState(defaultCompany);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const canSave = companyName.trim() && contactName.trim() && contactEmail.trim();

  return (
    <div className={OVERLAY} onClick={onCancel}>
      <div className={cn(PANEL, 'p-5 w-96')} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[#0e1c36] mb-1">Promote to Prospect</h3>
        <p className="text-xs text-[#0e1c36]/50 mb-4">{siteName}</p>
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Company name</label>
            <input
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Contact name</label>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#0e1c36]/70">Contact email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
            Cancel
          </button>
          <button
            onClick={() => canSave && onSave(companyName, contactName, contactEmail)}
            disabled={!canSave}
            className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
          >
            Promote
          </button>
        </div>
      </div>
    </div>
  );
}

const columnHelper = createColumnHelper<Site>();

function matchesFlag(s: Site, flag: FlagFilter): boolean {
  switch (flag) {
    case 'surface':
      return s.type === 'surface';
    case 'ownerDirect':
      return !!s.ownerDirectCandidate;
    case 'walked':
      return s.status === 'walked' || s.status === 'walk-list';
    case 'residential':
      return !!s.residentialFlag;
    case 'closedAtNight':
      return s.closedAtNight === true;
    default:
      return true;
  }
}

interface ResultsTableProps {
  sites: Site[];
  metro: MetroCode;
}

export function ResultsTable({ sites, metro }: ResultsTableProps) {
  const [isPending, startTransition] = useTransition();
  const [editSiteId, setEditSiteId] = useState<string | null>(null);
  const [promoteSiteId, setPromoteSiteId] = useState<string | null>(null);
  const [localSites, setLocalSites] = useState(sites);
  const [prevSites, setPrevSites] = useState(sites);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [flagFilter, setFlagFilter] = useState<FlagFilter>('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'storageScore', desc: true }]);
  const hasUnsaved = localSites.some((s) => !s.id);

  // sites is refetched server-side after a save (revalidatePath in
  // refreshFinderResults) - without this, localSites would keep showing
  // the pre-save (id-less) rows since useState only reads its initial value once.
  // Adjusted during render (React's documented pattern for resetting state when
  // a prop changes) instead of an effect, so it doesn't cost an extra render pass.
  if (sites !== prevSites) {
    setPrevSites(sites);
    setLocalSites(sites);
  }

  const showToast = (t: Toast) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  const handleQuickStatus = (site: Site, status: SiteStatus) => {
    if (!site.id || !status || site.status === status) return;
    setLocalSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, status } : s)));
    startTransition(async () => {
      try {
        await updateSiteStatus(site.id, status);
      } catch (err) {
        setLocalSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, status: site.status } : s)));
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update status' });
      }
    });
  };

  const handleRowSave = (siteId: string, fields: RowEditFields) => {
    const prevSite = localSites.find((s) => s.id === siteId);
    setLocalSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, ...fields } : s)));
    setEditSiteId(null);

    startTransition(async () => {
      try {
        if (fields.status && fields.status !== prevSite?.status) {
          await updateSiteStatus(siteId, fields.status);
        }
        await updateSiteManualFields(siteId, {
          name: fields.name || null,
          type: fields.type || null,
          capacity: fields.capacity ?? null,
          capacityActual: fields.capacityActual ?? null,
          clearanceHeight: fields.clearanceHeight ?? null,
          powerAvailable: fields.powerAvailable ?? null,
          notesInternal: fields.notesInternal ?? null,
          address: fields.address ?? null,
          owner: fields.owner ?? null,
          ownerMailing: fields.ownerMailing ?? null,
          landUse: fields.landUse ?? null,
          parcelId: fields.parcelId ?? null,
          zoning: fields.zoning ?? null,
        });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  };

  const handlePromote = (siteId: string, companyName: string, contactName: string, contactEmail: string) => {
    startTransition(async () => {
      try {
        await promoteSiteToProspect(siteId, companyName, contactName, contactEmail);
        setLocalSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, status: 'contacted' } : s)));
        showToast({ type: 'success', message: 'Site promoted to prospect' });
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to promote' });
      }
    });
    setPromoteSiteId(null);
  };

  const handleSaveAll = () => {
    startTransition(async () => {
      try {
        await saveFinderResults(metro, localSites);
      } catch (err) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
      }
    });
  };

  const handleStatusCell = (site: Site) => (
    <select
      value={site.status || 'new'}
      disabled={!site.id || isPending}
      onChange={(e) => { e.stopPropagation(); handleQuickStatus(site, e.target.value as SiteStatus); }}
      onClick={(e) => e.stopPropagation()}
      title={site.id ? 'Set status' : 'Save results first to edit status'}
      className={cn(
        'text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        site.status === 'signed' && 'text-[#1a5a2a] border-[#c8ecc9] bg-[#dff5e1]',
        site.status === 'rejected' && 'text-[#7a1a1a] border-[#ffcccc] bg-[#ffe1e1]',
        site.status === 'contacted' && 'text-[#1a3a7a] border-[#afcbff]/50 bg-[#afcbff]/20',
        (site.status === 'walk-list' || site.status === 'walked') && 'text-[#7a3a1a] border-[#ffede1] bg-[#ffede1]/60',
        (!site.status || site.status === 'new') && 'text-[#0e1c36]/60 border-[#0e1c36]/15 bg-[#0e1c36]/5',
      )}
    >
      {statuses.map((st) => (
        <option key={st} value={st}>
          {st}
        </option>
      ))}
    </select>
  );

  const handleFlagsCell = (site: Site) => (
    <span className="flex items-center gap-1">
      {site.ownerDirectCandidate && (
        <span className="text-[9px] font-mono uppercase tracking-wide text-[#1a3a7a] bg-[#afcbff]/20 border border-[#afcbff]/50 px-1.5 py-0.5 rounded-full">
          owner-direct
        </span>
      )}
      {site.walkList && (
        <span className="text-[9px] font-mono uppercase tracking-wide text-[#7a3a1a] bg-[#ffede1]/60 border border-[#ffede1] px-1.5 py-0.5 rounded-full">
          walk
        </span>
      )}
      {site.residentialFlag && (
        <span className="text-[9px] font-mono uppercase tracking-wide text-[#7a1a1a] bg-[#ffe1e1]/60 border border-[#ffcccc] px-1.5 py-0.5 rounded-full">
          adjacent
        </span>
      )}
    </span>
  );

  // Lean column set — everything cut here (owner/parcel/zoning/clearance/
  // hours/coords/…) is already in the RowEditPopup's read-only snapshot,
  // one double-click away. Add a column back only when it earns the width.
  const columns = useMemo(
    () => [
      columnHelper.accessor('storageScore', { header: 'Storage' }),
      columnHelper.accessor('stagingScore', { header: 'Staging' }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ row }) => handleStatusCell(row.original),
      }),
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('address', {
        header: 'Address',
        cell: ({ getValue }) => (
          <span className="text-xs text-[#0e1c36]/60 max-w-[16rem] truncate block" title={getValue() ?? ''}>
            {getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.accessor('type', { header: 'Type' }),
      columnHelper.accessor((s) => s.capacityActual ?? s.capacity, {
        id: 'capacity',
        header: 'Cap.',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[#0e1c36]/50">
            {row.original.capacityActual ?? row.original.capacity ?? '—'}
            {row.original.capacityActual != null && row.original.capacity != null && row.original.capacityActual !== row.original.capacity && (
              <span className="text-[#0e1c36]/35" title={`estimated ${row.original.capacity}`}> ({row.original.capacity})</span>
            )}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'flags',
        header: 'Flags',
        cell: ({ row }) => handleFlagsCell(row.original),
      }),
      columnHelper.accessor('notesInternal', {
        header: 'Notes',
        cell: ({ getValue }) => (
          <span className="text-xs text-[#0e1c36]/60 max-w-[12rem] truncate block" title={getValue() ?? ''}>
            {getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const s = row.original;
          if (!s.id) return null;
          return (
            <span className="flex gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setEditSiteId(s.id); }}
                disabled={isPending}
                className="px-2 py-1 text-[#0e1c36] bg-[#0e1c36]/5 border border-[#0e1c36]/15 rounded text-[9px] hover:bg-[#0e1c36]/10 disabled:opacity-50"
              >
                Edit
              </button>
              {s.status !== 'contacted' && s.status !== 'signed' && s.status !== 'rejected' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPromoteSiteId(s.id); }}
                  disabled={isPending}
                  className="px-2 py-1 text-[#1a3a7a] bg-[#afcbff]/20 border border-[#afcbff]/50 rounded text-[9px] hover:bg-[#afcbff]/40 disabled:opacity-50"
                >
                  Promote
                </button>
              )}
            </span>
          );
        },
      }      ),
      // Cell helpers referenced above only close over stable setters (plus
      // isPending, in deps), so the memoized defs stay correct across renders.
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPending],
  );

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase();
    return localSites.filter((s) => {
      if (statusFilter !== 'all' && (s.status || 'new') !== statusFilter) return false;
      if (flagFilter !== 'all' && !matchesFlag(s, flagFilter)) return false;
      if (q) {
        const hay = `${s.name ?? ''} ${s.address ?? ''} ${s.owner ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [localSites, search, statusFilter, flagFilter]);

  const table = useReactTable({
    data: filteredSites,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // The old dead-text stats line, now clickable — each count filters the
  // table to that slice (same FilterChip the sourcing review table uses).
  const flagCount = (flag: FlagFilter) => localSites.filter((s) => matchesFlag(s, flag)).length;
  const statusCount = (st: SiteStatus) => localSites.filter((s) => (s.status || 'new') === st).length;

  const editSite = editSiteId ? localSites.find((s) => s.id === editSiteId) : null;
  const promoteSite = promoteSiteId ? localSites.find((s) => s.id === promoteSiteId) : null;

  return (
    <>
    {editSite && (
      <RowEditPopup
        site={editSite}
        onSave={(fields) => handleRowSave(editSite.id, fields)}
        onCancel={() => setEditSiteId(null)}
      />
    )}
    {promoteSite && (
      <PromotePopup
        siteName={promoteSite.name}
        defaultCompany={promoteSite.owner || ''}
        onSave={(companyName, contactName, contactEmail) =>
          handlePromote(promoteSite.id, companyName, contactName, contactEmail)
        }
        onCancel={() => setPromoteSiteId(null)}
      />
    )}

    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <FilterChip active={flagFilter === 'surface'} onClick={() => setFlagFilter(flagFilter === 'surface' ? 'all' : 'surface')}>
        {flagCount('surface')} surface
      </FilterChip>
      <FilterChip active={flagFilter === 'ownerDirect'} onClick={() => setFlagFilter(flagFilter === 'ownerDirect' ? 'all' : 'ownerDirect')}>
        {flagCount('ownerDirect')} owner-direct
      </FilterChip>
      <FilterChip active={flagFilter === 'walked'} onClick={() => setFlagFilter(flagFilter === 'walked' ? 'all' : 'walked')}>
        {flagCount('walked')} walked/walk-list
      </FilterChip>
      <FilterChip active={flagFilter === 'residential'} onClick={() => setFlagFilter(flagFilter === 'residential' ? 'all' : 'residential')}>
        {flagCount('residential')} residential-adjacent
      </FilterChip>
      <FilterChip active={flagFilter === 'closedAtNight'} onClick={() => setFlagFilter(flagFilter === 'closedAtNight' ? 'all' : 'closedAtNight')}>
        {flagCount('closedAtNight')} closed at night
      </FilterChip>

      <span className="ml-auto flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, address, owner…"
          className="px-2.5 py-1.5 text-xs border border-[#0e1c36]/15 rounded bg-white text-[#0e1c36] placeholder:text-[#0e1c36]/30 focus:outline-none focus:border-[#1a3a7a] min-w-[12rem]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | SiteStatus)}
          className="px-2 py-1.5 text-xs font-mono uppercase tracking-[.04em] border border-[#0e1c36]/15 rounded bg-white text-[#0e1c36] focus:outline-none focus:border-[#1a3a7a]"
        >
          <option value="all">All statuses</option>
          {statuses.map((st) => (
            <option key={st} value={st}>
              {statusCount(st)} {st}
            </option>
          ))}
        </select>
      </span>
    </div>

    <p className="mb-2 text-xs text-[#0e1c36]/40">
      {filteredSites.length} of {localSites.length} sites · click column headers to sort · double-click a row to edit · full details (owner, parcel, zoning, hours, coords) live in the edit popup
    </p>

    {hasUnsaved && (
      <p className="px-4 py-2 text-xs text-[#7a3a1a] bg-[#ffede1]/60 border-b border-[#ffede1] flex items-center gap-3">
        <span>These results aren&apos;t saved yet — save them to unlock status edits and promoting.</span>
        <button
          onClick={handleSaveAll}
          disabled={isPending}
          className="px-2 py-1 text-[#1a5a2a] bg-[#dff5e1] border border-[#c8ecc9] rounded text-[9px] hover:bg-[#c8ecc9] disabled:opacity-50 ml-auto"
        >
          {isPending ? 'Saving…' : 'Save all results'}
        </button>
      </p>
    )}

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
            className={cn(
              'transition-colors',
              row.original.id ? 'hover:bg-[#0e1c36]/[.02] cursor-pointer' : 'cursor-not-allowed',
            )}
            onDoubleClick={() => row.original.id && setEditSiteId(row.original.id)}
            title={row.original.id ? 'Double-click to edit' : 'Save results first to edit'}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                {cell.column.id === 'storageScore' || cell.column.id === 'stagingScore' ? (
                  <span className="font-mono font-semibold tabular-nums text-[#0e1c36]">{String(cell.getValue())}</span>
                ) : cell.column.id === 'name' ? (
                  <span className="block max-w-[16rem] truncate text-xs text-[#0e1c36]" title={String(cell.getValue() ?? '')}>
                    {String(cell.getValue() ?? '')}
                  </span>
                ) : (
                  flexRender(cell.column.columnDef.cell, cell.getContext())
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
