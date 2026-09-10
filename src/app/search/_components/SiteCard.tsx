'use client';

import { Ruler, Clock, Lightbulb, Fence, Layers, SearchX, Sparkles, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PublicSite } from '@/lib/publicNetwork';
import { DEMO_SITE_ID, LockedValue } from './locked';

const SERVICE_LABELS: Record<string, string> = {
  STAGE: 'Staging',
  CHARGE: 'Charging',
  PUDO: 'Pick-up / Drop-off',
  WASH: 'Wash',
  SERVICE: 'Service',
};

const RESOURCE_LABELS: Record<string, string> = {
  PARKING_STALL: 'Parking Stall',
  EV_CONNECTOR: 'EV Connector',
  CURB_BERTH: 'Curb Berth',
  WASH_BAY: 'Wash Bay',
  SERVICE_BAY: 'Service Bay',
};

// Chip labels for derived service badges — shorter than SERVICE_LABELS
// ("Pick-up / Drop-off" doesn't fit a chip).
const SERVICE_CHIP: Record<string, string> = {
  STAGE: 'Stage',
  CHARGE: 'Charge',
  PUDO: 'PUDO',
  WASH: 'Wash',
  SERVICE: 'Service',
};

function formatRate(rate: PublicSite['resources'][number]['offerings'][number]['rate']): string {
  const parts: string[] = [];
  if (rate.perMinute) parts.push(`${rate.currency} ${rate.perMinute}/min`);
  if (rate.perHour) parts.push(`${rate.currency} ${rate.perHour}/hr`);
  if (rate.perKwh) parts.push(`${rate.currency} ${rate.perKwh}/kWh`);
  return parts.length > 0 ? parts.join(' · ') : 'Contact for pricing';
}

function formatClearance(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Quiet icon + text row for the expanded detail. */
function Meta({ icon: Icon, label, value }: { icon: typeof Ruler; label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 shrink-0 text-[#0e1c36]/35" aria-hidden="true" />
      <span className="text-[12px] text-[#0e1c36]/60">
        {label ? `${label} ` : null}
        <strong className="font-medium text-[#0e1c36]">{value}</strong>
      </span>
    </div>
  );
}

/**
 * Compact grid card — small tile with label + key attrs; the selected tile
 * spans the full grid row and expands its detail inline.
 */
export function SiteCard({
  site,
  selected,
  onSelect,
}: {
  site: PublicSite;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const sourced = site.source === 'sourcing';
  const totalCapacity = site.resources.reduce((sum, r) => sum + r.capacity, 0);
  // Teaser: one flagship demo site shows everything; every other sourced
  // site locks only the A-level fields (name, exact location, rates).
  const isDemo = site.id === DEMO_SITE_ID;
  const locked = sourced && !isDemo;

  const summary = sourced
    ? [
        site.surface_type === 'structured' ? 'Garage' : site.surface_type === 'surface' ? 'Surface lot' : null,
        site.clearanceInches !== undefined ? formatClearance(site.clearanceInches) : null,
        site.stall_count ? `${site.stall_count.toLocaleString()} stalls` : null,
        site.is_24_7 === true ? '24/7' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : site.serviceTypes.map((t) => SERVICE_LABELS[t] ?? t).join(' · ') || (totalCapacity > 0 ? `${totalCapacity} vehicle capacity` : '');

  const fits8ft = site.clearanceInches !== undefined && site.clearanceInches >= 96;
  const tileLabel = site.name ?? site.label ?? site.serviceTypes[0] ?? '—';

  return (
    <div
      className={cn(
        'flex flex-col border p-2.5 transition-colors',
        selected
          ? 'col-span-2 border-[#0e1c36]/50 bg-[#d7f9ff]/25'
          : 'border-[#0e1c36]/10 bg-white hover:border-[#1a3a7a]/40'
      )}
    >
      <button type="button" onClick={() => onSelect(site.id)} className="flex w-full flex-col items-start gap-1 text-left">
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-medium text-[#0e1c36]/45">{tileLabel}</span>
            {isDemo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1a3a7a]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#1a3a7a]">
                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> Sample location
              </span>
            )}
          </span>
          {fits8ft && (
            <span className="rounded-full bg-[#1a5a2a]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1a5a2a]">
              8&rsquo;+
            </span>
          )}
        </span>
        <span className="text-[12.5px] leading-snug text-[#0e1c36]/80">
          {summary || (sourced ? 'Parking area' : 'Operator site')}
        </span>
        {/* Derived service badges — only when tagged; untagged shows nothing. */}
        {sourced && site.serviceTypes.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {site.serviceTypes.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#1a3a7a]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#1a3a7a]"
              >
                {SERVICE_CHIP[t] ?? t}
              </span>
            ))}
          </span>
        )}
        {locked && (
          <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <LockedValue label="Name" />
            <LockedValue label="Exact location" />
            <LockedValue label="Rates" />
          </span>
        )}
      </button>

      {selected && (
        <div className="mt-2.5 space-y-2 border-t border-[#0e1c36]/10 pt-2.5">
          {sourced ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <Meta icon={Ruler} label="Clearance" value={site.clearanceInches !== undefined ? formatClearance(site.clearanceInches) : 'Unverified'} />
              <Meta icon={Clock} label="Hours" value={site.is_24_7 === true ? '24/7' : site.hours_text} />
              <Meta icon={Layers} label="" value={site.stall_count ? `${site.stall_count.toLocaleString()} stalls` : undefined} />
              {locked ? <LockedValue label="Rates" /> : <Meta icon={Layers} label="" value={site.price_text} />}
              <Meta icon={Fence} label="" value={site.is_fenced === true ? 'Fenced' : undefined} />
              <Meta icon={Lightbulb} label="" value={site.is_lit === true ? 'Lit' : undefined} />
              {/* Straight-line proximity to the nearest demand anchor — not
                  driving distance, not a demand score. Rounded for display. */}
              <Meta
                icon={MapPin}
                label=""
                value={site.nearestDemandZone && site.nearestDemandMi !== undefined ? `${site.nearestDemandMi.toFixed(1)} mi from ${site.nearestDemandZone}` : undefined}
              />
            </div>
          ) : site.resources.length === 0 ? (
            <p className="text-[12px] text-[#0e1c36]/40">No published resources.</p>
          ) : (
            site.resources.map((resource) => (
              <div key={resource.id}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[#0e1c36]/80">
                    {RESOURCE_LABELS[resource.resourceType] ?? resource.resourceType}
                  </span>
                  <span className="text-[11px] text-[#0e1c36]/40">cap. {resource.capacity}</span>
                </div>
                {resource.offerings.length > 0 && (
                  <div className="mt-1 space-y-1.5">
                    {resource.offerings.map((offering) => (
                      <div key={offering.id} className="border-l-2 border-[#afcbff] pl-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-[#0e1c36]">{offering.title}</span>
                          <span className="whitespace-nowrap text-[11px] text-[#1a3a7a]">{formatRate(offering.rate)}</span>
                        </div>
                        {offering.description && (
                          <p className="mt-0.5 text-[11.5px] leading-snug text-[#0e1c36]/55">{offering.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function NoResultsCard({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-lg border border-[#0e1c36]/10 bg-white p-8 text-center">
      <SearchX className="mx-auto h-6 w-6 text-[#0e1c36]/25" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-[#0e1c36]">No matching areas</p>
      <p className="mt-1 text-[12px] text-[#0e1c36]/50">Try clearing filters to see all listed capacity.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 border border-[#0e1c36]/20 px-3 py-1.5 text-[12px] font-medium text-[#0e1c36] transition-colors hover:bg-[#0e1c36] hover:text-[#f9fbf2] active:scale-95"
      >
        Reset filters
      </button>
    </div>
  );
}
