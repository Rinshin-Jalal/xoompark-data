import 'server-only';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicNetworkSites, slugifyCity } from '@/lib/publicNetwork';
import { SearchClient } from '../_components/SearchClient';

// force-dynamic, not revalidate=300: ISR served stale HTML next to a fresh
// client bundle during deploys/dev (hydration mismatch), and the sourcing
// data changes continuously. Perf is covered by the in-memory TTL cache in
// getPublicNetworkSites, so the page itself can render per-request.
export const dynamic = 'force-dynamic';

async function getCityData(citySlug: string) {
  const sites = await getPublicNetworkSites();
  const cityLinks = Array.from(
    sites.reduce((map, s) => map.set(slugifyCity(s.city), { city: s.city, count: (map.get(slugifyCity(s.city))?.count ?? 0) + 1 }), new Map<string, { city: string; count: number }>()),
    ([slug, { city, count }]) => ({ slug, city, count })
  ).sort((a, b) => a.city.localeCompare(b.city));
  const citySites = sites.filter((s) => slugifyCity(s.city) === citySlug);
  const cityLabel = citySites[0]?.city ?? cityLinks.find((c) => c.slug === citySlug)?.city;
  if (citySites.length === 0 || !cityLabel) return { citySites, cityLinks, cityLabel };

  // Metro scope: everything within 50km of the city's centroid. /miami shows
  // the full metro (Miami Beach, Hialeah, Kendall, ...) — matching what the
  // map cluster advertises — not just city-proper.
  const centroid = {
    lat: citySites.reduce((s, x) => s + x.lat, 0) / citySites.length,
    lng: citySites.reduce((s, x) => s + x.lng, 0) / citySites.length,
  };
  const toRad = (d: number) => (d * Math.PI) / 180;
  const within50km = (s: (typeof sites)[number]) => {
    const dLat = toRad(s.lat - centroid.lat);
    const dLng = toRad(s.lng - centroid.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(centroid.lat)) * Math.cos(toRad(s.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a)) <= 50;
  };
  return { citySites: sites.filter(within50km), cityLinks, cityLabel };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: citySlug } = await params;
  const { citySites, cityLabel } = await getCityData(citySlug);
  if (citySites.length === 0 || !cityLabel) return {};

  const title = `Pit Stops in ${cityLabel} — AV Charging, Wash & Service`;
  const description = `Browse ${citySites.length} approximate service ${citySites.length === 1 ? 'area' : 'areas'} in ${cityLabel} offering charging, cleaning, and light service capacity for autonomous vehicle fleets.`;
  const url = `/search/${citySlug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { title, description },
  };
}

export default async function CitySearchPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const { citySites, cityLinks, cityLabel } = await getCityData(citySlug);
  if (citySites.length === 0 || !cityLabel) notFound();

  const serviceTypes = Array.from(new Set(citySites.flatMap((s) => s.serviceTypes)));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Autonomous vehicle pit stop network',
    provider: { '@type': 'Organization', name: 'XoomPark', url: 'https://xoompark.co' },
    areaServed: { '@type': 'City', name: cityLabel },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${cityLabel} pit stop capacity`,
      itemListElement: serviceTypes.map((type) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: type },
      })),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Suspense>
        <SearchClient sites={citySites} cityLabel={cityLabel} cityLinks={cityLinks} />
      </Suspense>
    </>
  );
}
