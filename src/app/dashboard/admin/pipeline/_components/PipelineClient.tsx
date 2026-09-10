'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Search, X, ChevronRight, Building2, Car, Copy, Loader2, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Prospect, ProspectStage, ProspectSide } from '../types';
import { STAGE_LABELS, STAGE_COLORS, PROSPECT_STAGES, SOURCE_LABELS } from '../types';
import { duplicateProspect } from '../actions';

interface Props {
  prospects: Prospect[];
}

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StagePill({ stage }: { stage: ProspectStage }) {
  return (
    <span className={cn(
      'inline-flex items-center border font-mono text-[9px] font-semibold uppercase tracking-[.1em] px-2 py-0.5 rounded-full',
      STAGE_COLORS[stage],
    )}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

function SidePill({ side }: { side: ProspectSide }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-[.1em] px-2 py-0.5 rounded-full border',
      side === 'provider'
        ? 'bg-[#afcbff]/20 text-[#1a3a7a] border-[#afcbff]/50'
        : 'bg-[#ffede1]/60 text-[#7a3a1a] border-[#ffede1]',
    )}>
      {side === 'provider' ? <Building2 className="h-2.5 w-2.5" /> : <Car className="h-2.5 w-2.5" />}
      {side}
    </span>
  );
}

type Filters = {
  side: ProspectSide | '';
  stage: ProspectStage | '';
  city: string;
  assignedTo: string;
  source: string;
};

const EMPTY_FILTERS: Filters = { side: '', stage: '', city: '', assignedTo: '', source: '' };

function isActive(f: Filters, search: string) {
  return !!(f.side || f.stage || f.city || f.assignedTo || f.source || search);
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] text-[#0e1c36]/40 uppercase tracking-[.1em] whitespace-nowrap">
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 rounded-md border px-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-[#0e1c36]/20 cursor-pointer',
          value
            ? 'border-[#0e1c36]/50 bg-[#0e1c36]/5 text-[#0e1c36] font-semibold'
            : 'border-[#0e1c36]/20 bg-white text-[#0e1c36]',
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function PipelineClient({ prospects }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const providerCount = useMemo(() => prospects.filter((p) => p.side === 'provider').length, [prospects]);
  const operatorCount = useMemo(() => prospects.filter((p) => p.side === 'operator').length, [prospects]);

  // Unique filter option lists derived from live data
  const cities = useMemo(() => {
    const s = new Set<string>();
    prospects.forEach((p) => { if (p.city) s.add(p.city); });
    return Array.from(s).sort();
  }, [prospects]);

  const assignees = useMemo(() => {
    const s = new Set<string>();
    prospects.forEach((p) => { if (p.assignedTo) s.add(p.assignedTo); });
    return Array.from(s).sort();
  }, [prospects]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    prospects.forEach((p) => { if (p.source) s.add(p.source); });
    return Array.from(s).sort();
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return prospects.filter((p) => {
      if (filters.side && p.side !== filters.side) return false;
      if (filters.stage && p.stage !== filters.stage) return false;
      if (filters.city && p.city !== filters.city) return false;
      if (filters.assignedTo && p.assignedTo !== filters.assignedTo) return false;
      if (filters.source && p.source !== filters.source) return false;
      if (q) {
        const haystack = [
          p.companyName, p.contactName, p.contactEmail,
          p.contactPhone, p.city, p.assignedTo, p.description,
          p.source, ...p.tags,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [prospects, search, filters]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    setSearch('');
    setFilters(EMPTY_FILTERS);
  }

  async function handleDuplicate(p: Prospect) {
    if (duplicatingId) return;
    setDuplicatingId(p.id);
    try {
      const { newId } = await duplicateProspect(p.id);
      router.refresh();
      toast.success(`Duplicated "${p.companyName}"`, {
        action: {
          label: 'View copy',
          onClick: () => router.push(`/dashboard/admin/pipeline/${newId}`),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate');
    } finally {
      setDuplicatingId(null);
    }
  }

  const tabBase = 'px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.12em] border rounded-md transition-colors';
  const tabActive = 'bg-[#0e1c36] text-[#f9fbf2] border-[#0e1c36]';
  const tabInactive = 'bg-white text-[#0e1c36]/55 border-[#0e1c36]/20 hover:border-[#0e1c36]/50';

  const anyActive = isActive(filters, search);

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0e1c36]">BD Pipeline</h1>
          <p className="text-sm text-[#0e1c36]/50 mt-0.5">
            {prospects.length} total · {providerCount} providers · {operatorCount} operators
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/admin/pipeline/new">
            <Plus className="h-4 w-4" /> New Prospect
          </Link>
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#0e1c36]/30 pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, contact, city, email, tag…"
          className="pl-9 pr-9 h-10 font-mono text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0e1c36]/30 hover:text-[#0e1c36]/70 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Side tabs */}
        <button onClick={() => setFilter('side', '')} className={cn(tabBase, !filters.side ? tabActive : tabInactive)}>
          All
        </button>
        <button onClick={() => setFilter('side', 'provider')} className={cn(tabBase, filters.side === 'provider' ? tabActive : tabInactive)}>
          <Building2 className="inline h-3 w-3 mr-1" />Providers ({providerCount})
        </button>
        <button onClick={() => setFilter('side', 'operator')} className={cn(tabBase, filters.side === 'operator' ? tabActive : tabInactive)}>
          <Car className="inline h-3 w-3 mr-1" />Operators ({operatorCount})
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Stage"
            value={filters.stage}
            onChange={(v) => setFilter('stage', v as ProspectStage | '')}
            options={PROSPECT_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            placeholder="All stages"
          />

          {cities.length > 0 && (
            <FilterSelect
              label="City"
              value={filters.city}
              onChange={(v) => setFilter('city', v)}
              options={cities.map((c) => ({ value: c, label: c }))}
              placeholder="All cities"
            />
          )}

          {assignees.length > 0 && (
            <FilterSelect
              label="Assigned"
              value={filters.assignedTo}
              onChange={(v) => setFilter('assignedTo', v)}
              options={assignees.map((a) => ({ value: a, label: a.split('@')[0] }))}
              placeholder="Anyone"
            />
          )}

          {sources.length > 0 && (
            <FilterSelect
              label="Source"
              value={filters.source}
              onChange={(v) => setFilter('source', v)}
              options={sources.map((s) => ({ value: s, label: SOURCE_LABELS[s as keyof typeof SOURCE_LABELS] ?? s }))}
              placeholder="All sources"
            />
          )}

          {anyActive && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 font-mono text-[10px] text-[#0e1c36]/40 hover:text-red-500 transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Results count when filtered */}
      {anyActive && (
        <p className="font-mono text-[10px] text-[#0e1c36]/40 mb-3 uppercase tracking-[.08em]">
          {filtered.length === 0
            ? 'No results'
            : `${filtered.length} of ${prospects.length} prospects`}
        </p>
      )}

      {/* Table */}
      <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            {anyActive ? (
              <>
                <p className="text-sm text-[#0e1c36]/40">No prospects match your search or filters.</p>
                <button
                  onClick={clearAll}
                  className="mt-3 font-mono text-[11px] text-[#1a3a7a] hover:underline"
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[#0e1c36]/40">No prospects yet.</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href="/dashboard/admin/pipeline/new">
                    <Plus className="h-4 w-4" /> Add first prospect
                  </Link>
                </Button>
              </>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#0e1c36]/10">
                {['Company', 'Side', 'Stage', 'Contact', 'City', 'Assigned', 'Updated', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0e1c36]/8">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-[#0e1c36]/[.02] transition-colors group">
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm text-[#0e1c36]">{p.companyName}</p>
                    {p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="font-mono text-[9px] bg-[#0e1c36]/8 text-[#0e1c36]/55 px-1.5 py-0.5 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><SidePill side={p.side} /></td>
                  <td className="px-4 py-3"><StagePill stage={p.stage} /></td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-[#0e1c36]">{p.contactName || '—'}</p>
                    {p.contactEmail && (
                      <p className="font-mono text-[10px] text-[#0e1c36]/45 truncate max-w-[160px]">
                        {p.contactEmail}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0e1c36]/60">{p.city || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-[#0e1c36]/50">
                    {p.assignedTo ? p.assignedTo.split('@')[0] : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-[#0e1c36]/40 whitespace-nowrap">
                    {timeAgo(p.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => handleDuplicate(p)}
                        disabled={!!duplicatingId}
                        title="Duplicate prospect"
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#0e1c36]/30 hover:text-[#0e1c36]/70 hover:bg-[#0e1c36]/5 disabled:cursor-not-allowed"
                      >
                        {duplicatingId === p.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <Link
                        href={`/dashboard/admin/pipeline/${p.id}`}
                        className="flex items-center text-[#0e1c36]/30 group-hover:text-[#1a3a7a] transition-colors"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
