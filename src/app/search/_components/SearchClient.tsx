'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Map as MapIcon, List, ArrowUp, Loader2, Ruler, X, ChevronDown, SlidersHorizontal, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { slugifyCity } from '@/lib/citySlug';
import type { PublicSite } from '@/lib/publicNetwork';
import type { ServiceType, ResourceType } from '@/lib/types';
import { SearchMap } from './SearchMap';
import { LocationSearch } from './LocationSearch';
import { SiteCard, NoResultsCard } from './SiteCard';

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const SERVICE_TYPES: ServiceType[] = ['STAGE', 'CHARGE', 'PUDO', 'WASH', 'SERVICE'];
const RESOURCE_TYPES: ResourceType[] = ['PARKING_STALL', 'EV_CONNECTOR', 'CURB_BERTH', 'WASH_BAY', 'SERVICE_BAY'];

// Rows shown when a city expands, before "Show all" — rows are compact
// (~36px), so a few dozen fit per screen without becoming a wall.
const CITY_PREVIEW_COUNT = 30;

const SERVICE_LABELS: Record<ServiceType, string> = {
  STAGE: 'Staging',
  CHARGE: 'Charging',
  PUDO: 'Pick-up / Drop-off',
  WASH: 'Wash',
  SERVICE: 'Service',
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
  PARKING_STALL: 'Parking Stall',
  EV_CONNECTOR: 'EV Connector',
  CURB_BERTH: 'Curb Berth',
  WASH_BAY: 'Wash Bay',
  SERVICE_BAY: 'Service Bay',
};

function parseListParam(value: string | null): Set<string> {
  return new Set(value ? value.split(',').filter(Boolean) : []);
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[.06em] transition-all duration-150',
        'active:scale-95',
        active
          ? 'border-[#0e1c36]/70 bg-[#0e1c36]/90 text-[#f9fbf2]'
          : 'border-[#0e1c36]/15 bg-transparent text-[#0e1c36]/55 hover:border-[#0e1c36]/40 hover:text-[#0e1c36]'
      )}
    >
      {children}
    </button>
  );
}

/** Active-filter summary chip — shows what's filtering the list, removes on click. */
function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="flex items-center gap-1 border border-[#0e1c36]/70 bg-[#0e1c36]/90 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[.06em] text-[#f9fbf2] transition-transform active:scale-95"
      aria-label={`Remove filter: ${label}`}
    >
      {label}
      <X className="h-2.5 w-2.5" aria-hidden="true" />
    </button>
  );
}

export function SearchClient({
  sites,
  cityLabel,
  cityLinks: cityLinksProp,
}: {
  sites: PublicSite[];
  /** Set on /search/[city] - narrows the hero copy to name the city instead of the generic pitch. */
  cityLabel?: string;
  /** Full cross-city list for the "Browse" row; on /search/[city] this must come from the unfiltered
   * site set (sites here is already scoped to one city), so the caller passes it explicitly. */
  cityLinks?: { slug: string; city: string; count: number }[];
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Local state is the single source of truth for all filter/search/map/
  // selection state - the URL is a write-only reflection of it, synced via
  // the effect below. Reading state back out of the URL (e.g. via
  // searchParams inside a toggle handler) is what causes rapid successive
  // toggles to race, since router.replace doesn't update the URL
  // synchronously - it waits on the RSC navigation to resolve.
  const [activeServices, setActiveServices] = useState(() => parseListParam(searchParams.get('service')));
  const [activeResources, setActiveResources] = useState(() => parseListParam(searchParams.get('resource')));
  const [clearance8ft, setClearance8ft] = useState(searchParams.get('clearance') === '8ft');
  // Services/resources chips are opt-in — collapsed by default so the
  // resting page shows one clearance toggle, not a wall of twelve chips.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Accordion: which city's cards are expanded. One at a time. On a city
  // page the requested city starts expanded (it's why the user is here).
  const [openCity, setOpenCity] = useState<string | null>(cityLabel ?? null);
  // Cities the user explicitly expanded past the preview cap.
  const [fullCities, setFullCities] = useState<Set<string>>(new Set());
  const [locationLabel, setLocationLabel] = useState(searchParams.get('q') ?? '');
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(searchParams.get('site'));
  const [mapTarget, setMapTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(() => {
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const z = searchParams.get('z');
    return lat && lng ? { lat: Number(lat), lng: Number(lng), zoom: z ? Number(z) : 11 } : null;
  });
  const [mobileMapOpen, setMobileMapOpen] = useState(false);

  // The list panel scrolls independently of the page (the page itself never
  // scrolls - h-screen/overflow-hidden below). That's not obvious on sight,
  // so a bottom fade signals "more below" and disappears once you've
  // actually reached the end, instead of leaving a dead-looking cutoff.
  const listRef = useRef<HTMLDivElement>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const checkListOverflow = () => {
    const el = listRef.current;
    if (!el) return;
    setListHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useEffect(checkListOverflow);
  useEffect(() => {
    window.addEventListener('resize', checkListOverflow);
    return () => window.removeEventListener('resize', checkListOverflow);
  }, []);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (activeServices.size > 0) params.set('service', Array.from(activeServices).join(','));
    if (activeResources.size > 0) params.set('resource', Array.from(activeResources).join(','));
    if (clearance8ft) params.set('clearance', '8ft');
    if (locationLabel) params.set('q', locationLabel);
    if (selectedSiteId) params.set('site', selectedSiteId);
    if (mapTarget) {
      params.set('lat', String(mapTarget.lat));
      params.set('lng', String(mapTarget.lng));
      params.set('z', String(mapTarget.zoom));
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServices, activeResources, clearance8ft, locationLabel, selectedSiteId, mapTarget]);

  function toggleService(type: ServiceType) {
    setActiveServices((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function toggleResource(type: ResourceType) {
    setActiveResources((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleLocationSelect(result: { label: string; lat: number; lng: number }) {
    setLocationLabel(result.label);
    setMapTarget({ lat: result.lat, lng: result.lng, zoom: 12 });
  }

  function resetFilters() {
    setActiveServices(new Set());
    setActiveResources(new Set());
    setClearance8ft(false);
  }

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      if (activeServices.size > 0 && !site.serviceTypes.some((s) => activeServices.has(s))) return false;
      if (activeResources.size > 0 && !site.resourceTypes.some((r) => activeResources.has(r))) return false;
      // 8' = 96". Unverified clearance (undefined) never passes — same
      // discipline as clearanceFit: unknown is not "fits".
      if (clearance8ft && (site.clearanceInches === undefined || site.clearanceInches < 96)) return false;
      return true;
    });
  }, [sites, activeServices, activeResources, clearance8ft]);

  const cityLinks = useMemo(() => {
    if (cityLinksProp) return cityLinksProp;
    const seen = new Map<string, { city: string; count: number }>();
    for (const site of sites) {
      const slug = slugifyCity(site.city);
      const prev = seen.get(slug);
      seen.set(slug, { city: site.city, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(seen, ([slug, { city, count }]) => ({ slug, city, count })).sort((a, b) => a.city.localeCompare(b.city));
  }, [sites, cityLinksProp]);

  // Browse row: top cities by inventory, biggest first — Miami leads
  // instead of "Bay Harbor Islands" winning by alphabet. The full list
  // runs 40+ deep with sourcing data - a wall of links is noise.
  const topCityLinks = useMemo(
    () => [...cityLinks].sort((a, b) => b.count - a.count).slice(0, 10),
    [cityLinks]
  );

  const filterCount = activeServices.size + activeResources.size;

  // Group the (potentially 1000+) results by city so the list reads as a
  // directory, not an endless wall. Within a city: clearance first (desc,
  // unverified last), then capacity, then id for stable order.
  const rank = (s: PublicSite) => (s.clearanceInches !== undefined && s.clearanceInches >= 96 ? 1 : 0);
  const byMatch = (a: PublicSite, b: PublicSite) =>
    rank(b) - rank(a) ||
    (b.clearanceInches ?? -1) - (a.clearanceInches ?? -1) ||
    (b.stallsTotal ?? 0) - (a.stallsTotal ?? 0) ||
    a.id.localeCompare(b.id);

  const groupedSites = useMemo(() => {
    // Metro page: ONE flat group under the requested city. Sub-city rows
    // read as "Miami has 628" when the page actually holds the whole metro;
    // each card's title still carries its real city.
    if (cityLabel) {
      return [{ city: cityLabel, sites: [...filteredSites].sort(byMatch) }];
    }
    const byCity = new Map<string, PublicSite[]>();
    for (const site of filteredSites) {
      const list = byCity.get(site.city) ?? [];
      list.push(site);
      byCity.set(site.city, list);
    }
    return Array.from(byCity, ([city, list]) => ({ city, sites: list.sort(byMatch) })).sort((a, b) =>
      a.city.localeCompare(b.city)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSites, cityLabel]);

  // Single-city view (city pages, or a filter that leaves one city): always
  // expanded — an accordion you must click open to see the only thing there
  // is to see is just an extra click.
  const singleCity = groupedSites.length === 1 ? groupedSites[0].city : null;

  // Popup state lives here so both entry points share it: map circle click
  // and sidebar card click. Card clicks also pan the map to the site.
  const [popupSiteId, setPopupSiteId] = useState<string | null>(null);

  function handleSelectSite(id: string) {
    setSelectedSiteId(id);
    setPopupSiteId(id);
  }

  // Card click: popup in the map + pan there — NOT a city accordion expand.
  function handleCardSelect(site: PublicSite) {
    handleSelectSite(site.id);
    setMapTarget({ lat: site.lat, lng: site.lng, zoom: 15 });
  }

  return (
    <APIProvider apiKey={GMAPS_KEY} libraries={['places']}>
      <div className="flex h-screen flex-col overflow-hidden bg-[#f9fbf2] text-[#0e1c36]">
        <div className={cn(mobileMapOpen && 'hidden md:block')}>
          <header className="border-b border-[#0e1c36]/12 bg-white px-5 py-4 sm:px-8">
            <nav className="flex items-center justify-between" aria-label="Main navigation">
              <Link href="/" className="xp-logo text-sm" aria-label="XoomPark home">
                XOOMPARK<span>®</span>
              </Link>
              {loading ? (
                <span role="status" aria-label="Loading">
                  <Loader2 className="h-4 w-4 animate-spin text-[#0e1c36]/50" />
                </span>
              ) : user ? (
                <Link href="/dashboard" className="xp-nav-link">DASHBOARD <ArrowUp /></Link>
              ) : (
                <Link href="/auth" className="xp-nav-link">FLEET ACCESS <ArrowUp /></Link>
              )}
            </nav>
          </header>

          <section className="border-b border-[#0e1c36]/10 bg-white px-5 py-6 sm:px-8">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="xp-eyebrow text-[9px]">{cityLabel ?? 'For AV, EV & delivery fleets'}</p>
                <h1 className="xp-display mt-2 text-[clamp(1.5rem,3.2vw,2.1rem)] leading-[.95] tracking-[-.03em]">
                  {cityLabel ? (
                    <>Available ground in <span>{cityLabel}.</span></>
                  ) : (
                    <>Find parking for your <span>fleet.</span></>
                  )}
                </h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#0e1c36]/60">
                  {cityLabel
                    ? 'Off-street parking, staging, charging, and vehicle prep. Exact addresses and access details are shared after qualification.'
                    : 'Off-street parking, staging, charging, and vehicle prep across the network. Locations are approximate by design — exact addresses after qualification.'}
                </p>
                <div className="mt-4 flex max-w-md items-stretch gap-2">
                  <div className="min-w-0 flex-1">
                    <LocationSearch defaultValue={locationLabel} onSelect={handleLocationSelect} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-label="Toggle filters"
                    aria-pressed={filtersOpen}
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-md border px-3 transition-colors',
                      filtersOpen || filterCount > 0
                        ? 'border-[#0e1c36]/60 bg-[#0e1c36]/90 text-[#f9fbf2]'
                        : 'border-[#0e1c36]/15 bg-white text-[#0e1c36]/50 hover:border-[#0e1c36]/40 hover:text-[#0e1c36]'
                    )}
                  >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {cityLinks.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11px] text-[#0e1c36]/40">Browse</span>
                    {cityLabel && (
                      <Link href="/search" className="text-[11px] text-[#1a3a7a] hover:underline">
                        All cities
                      </Link>
                    )}
                    {topCityLinks
                      .filter(({ city }) => city !== cityLabel)
                      .map(({ slug, city }) => (
                        <Link key={slug} href={`/search/${slug}`} className="text-[11px] text-[#1a3a7a] hover:underline">
                          {city}
                        </Link>
                      ))}
                  </div>
                )}
              </div>

              {/* Legend lives in the hero, not on the map — it's orientation,
                  answered before the user starts interacting with the map. */}
              <div className="hidden w-[240px] shrink-0 rounded-lg border border-[#0e1c36]/12 bg-[#f9fbf2] px-3 py-2.5 lg:block">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[.14em] text-[#0e1c36]/60">
                  What am I looking at?
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#0e1c36]/75">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full border border-[#1a3a7a] bg-[#1a3a7a]/15"
                  />
                  Approximate coverage areas
                </div>
                <p className="mt-1.5 border-t border-[#0e1c36]/10 pt-1.5 text-[10px] leading-snug text-[#0e1c36]/55">
                  Numbers on the map show how many areas are nearby. Locations are blurred on purpose — exact addresses after qualification.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          <div className={cn('flex w-full flex-col border-[#0e1c36]/12 md:w-[32%] md:min-w-[360px] md:border-r', mobileMapOpen && 'hidden md:flex')}>
            {/* Filter bar lives OUTSIDE the scroll area — controls stay put
                while the list scrolls, and the default view shows one toggle
                instead of a wall of twelve chips. */}
            <div className="border-b border-[#0e1c36]/10 bg-white px-5 py-3 sm:px-8">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-medium text-[#0e1c36]">Areas</h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  className={cn(
                    'flex items-center gap-1.5 border px-2 py-1 text-[11px] transition-colors',
                    filterCount > 0
                      ? 'border-[#0e1c36]/60 bg-[#0e1c36]/90 text-[#f9fbf2]'
                      : 'border-[#0e1c36]/15 text-[#0e1c36]/60 hover:border-[#0e1c36]/40 hover:text-[#0e1c36]'
                  )}
                >
                  Filters
                  {filterCount > 0 && <span className="font-mono text-[10px] font-bold">{filterCount}</span>}
                  <ChevronDown className={cn('h-3 w-3 transition-transform', filtersOpen && 'rotate-180')} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setClearance8ft((v) => !v)}
                aria-pressed={clearance8ft}
                className={cn(
                  'mt-2 flex w-full items-center justify-between gap-2 border px-2.5 py-2 transition-all duration-150',
                  'active:scale-[.98]',
                  clearance8ft
                    ? 'border-[#1a5a2a]/60 bg-[#1a5a2a]/10 text-[#0e1c36]'
                    : 'border-[#0e1c36]/15 bg-white text-[#0e1c36]/70 hover:border-[#0e1c36]/40 hover:text-[#0e1c36]'
                )}
              >
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Ruler className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  8&rsquo;+ garage clearance
                </span>
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 rounded-full transition-colors', clearance8ft ? 'bg-[#1a5a2a]' : 'bg-[#0e1c36]/15')}
                />
              </button>
              {(filterCount > 0 || clearance8ft) && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {((Array.from(activeServices)) as ServiceType[]).map((type) => (
                    <RemovableChip key={type} label={SERVICE_LABELS[type]} onRemove={() => toggleService(type)} />
                  ))}
                  {((Array.from(activeResources)) as ResourceType[]).map((type) => (
                    <RemovableChip key={type} label={RESOURCE_LABELS[type]} onRemove={() => toggleResource(type)} />
                  ))}
                  {clearance8ft && (
                    <RemovableChip label="8&rsquo;+ garage clearance" onRemove={() => setClearance8ft(false)} />
                  )}
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="ml-1 text-[11px] text-[#1a3a7a] underline-offset-2 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              )}
              {filtersOpen && (
                <div className="mt-3 space-y-2.5 border-t border-[#0e1c36]/10 pt-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#0e1c36]/35">Services</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {SERVICE_TYPES.map((type) => (
                        <ToggleChip key={type} active={activeServices.has(type)} onClick={() => toggleService(type)}>
                          {SERVICE_LABELS[type]}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#0e1c36]/35">Resources</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {RESOURCE_TYPES.map((type) => (
                        <ToggleChip key={type} active={activeResources.has(type)} onClick={() => toggleResource(type)}>
                          {RESOURCE_LABELS[type]}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              <div ref={listRef} onScroll={checkListOverflow} className="h-full overflow-y-auto px-5 py-2 sm:px-8">
                {/* Teaser CTA — the locked fields exist to make someone click
                    this. Sticky so it survives scrolling the list. */}
                <div className="sticky top-0 z-10 -mx-5 mb-2 bg-[#f9fbf2]/95 px-5 py-2 backdrop-blur-sm sm:-mx-8 sm:px-8">
                  <Link
                    href="/auth"
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#1a3a7a]/30 bg-white px-3.5 py-2.5 transition-colors hover:border-[#1a3a7a]"
                  >
                    <span className="flex items-center gap-2.5">
                      <Lock className="h-4 w-4 shrink-0 text-[#1a3a7a]" aria-hidden="true" />
                      <span className="text-[12.5px] leading-snug">
                        <strong className="font-semibold text-[#0e1c36]">Unlock full site data</strong>
                        <span className="block text-[11px] text-[#0e1c36]/50">Clearance, capacity, EV power, rates — verified per lot</span>
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 -rotate-90 shrink-0 text-[#1a3a7a]" aria-hidden="true" />
                  </Link>
                </div>
                {filteredSites.length === 0 ? (
                  <NoResultsCard onReset={resetFilters} />
                ) : (
                  /* Accordion: one city open at a time, and even then only a
                     preview of its cards — a city can hold hundreds of areas,
                     dumping them all is the wall we're trying to avoid. */
                  groupedSites.map(({ city, sites: citySites }) => {
                    const open = singleCity !== null ? true : openCity === city;
                    const full = fullCities.has(city);
                    const visible = full ? citySites : citySites.slice(0, CITY_PREVIEW_COUNT);
                    return (
                      <div key={city} className="border-b border-[#0e1c36]/10 last:border-b-0">
                        {singleCity !== null ? (
                          <div className="flex items-center justify-between gap-2 py-3">
                            <span className="text-[14px] font-medium text-[#0e1c36]">{city}</span>
                            <span className="rounded-full bg-[#0e1c36]/5 px-2 py-0.5 text-[11px] text-[#0e1c36]/50">
                              {citySites.length}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpenCity(open ? null : city)}
                            aria-expanded={open}
                            className="group flex w-full items-center justify-between gap-2 py-3 text-left"
                          >
                            <span className="text-[14px] font-medium text-[#0e1c36]">{city}</span>
                            <span className="flex items-center gap-2">
                              <span className="rounded-full bg-[#0e1c36]/5 px-2 py-0.5 text-[11px] text-[#0e1c36]/50">
                                {citySites.length}
                              </span>
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 text-[#0e1c36]/30 transition-transform group-hover:text-[#0e1c36]/60',
                                  open && 'rotate-180'
                                )}
                                aria-hidden="true"
                              />
                            </span>
                          </button>
                        )}
                        {open && (
                          <div className="grid grid-cols-2 gap-1.5 pb-3">
                            {visible.map((site) => (
                              <SiteCard key={site.id} site={site} selected={site.id === selectedSiteId} onSelect={() => handleCardSelect(site)} />
                            ))}
                            {citySites.length > visible.length && (
                              <button
                                type="button"
                                onClick={() => setFullCities((prev) => new Set(prev).add(city))}
                                className="col-span-2 border border-dashed border-[#0e1c36]/20 py-2 text-[12px] text-[#0e1c36]/60 transition-colors hover:border-[#0e1c36]/40 hover:text-[#0e1c36]"
                              >
                                Show all {citySites.length} areas in {city}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#f9fbf2] to-transparent transition-opacity',
                  listHasMore ? 'opacity-100' : 'opacity-0'
                )}
              />
            </div>

            <div className="border-t border-[#0e1c36]/12 p-4 md:hidden">
              <button
                type="button"
                onClick={() => setMobileMapOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0e1c36] px-4 py-2.5 text-sm font-medium text-white transition-transform active:scale-[.98]"
              >
                <MapIcon className="h-4 w-4" /> View map
              </button>
            </div>
          </div>

          <div className={cn('relative flex-1', !mobileMapOpen && 'hidden md:block')} style={{ minHeight: 480 }}>
            {mobileMapOpen && (
              <button
                type="button"
                onClick={() => setMobileMapOpen(false)}
                className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-[#0e1c36]/12 bg-white px-3 py-2 text-xs font-medium shadow-sm md:hidden"
              >
                <List className="h-3.5 w-3.5" /> List
              </button>
            )}
            <SearchMap
              sites={filteredSites}
              selectedSiteId={selectedSiteId}
              popupSiteId={popupSiteId}
              onClosePopup={() => setPopupSiteId(null)}
              onSelectSite={handleSelectSite}
              center={mapTarget}
              zoom={mapTarget?.zoom ?? null}
            />
          </div>
        </div>

        <div className="hidden items-center justify-between gap-3 border-t border-[#0e1c36]/10 bg-white px-5 py-2 sm:px-8 md:flex">
          <p className="text-[11px] text-[#0e1c36]/50">Fleet operator or property owner — put ground to work.</p>
          <div className="flex gap-5">
            <Link href="/auth" className="text-[11px] font-medium text-[#1a3a7a] hover:underline">
              Get fleet access
            </Link>
            <Link href="/auth" className="text-[11px] font-medium text-[#1a3a7a] hover:underline">
              Host a pit stop
            </Link>
          </div>
        </div>
      </div>
    </APIProvider>
  );
}
