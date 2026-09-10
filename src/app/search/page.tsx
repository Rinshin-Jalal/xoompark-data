import 'server-only';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getPublicNetworkSites, slugifyCity } from '@/lib/publicNetwork';
import { SearchClient } from './_components/SearchClient';

// Cached/prerendered by default (revalidate alone still renders once at
// build time), but the Admin SDK credential is RUNTIME-only - it isn't in
// the build environment. Forcing dynamic moves the Firestore read to
// request time, where the credential exists.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search the Live Network — Charging, Wash & Service by City',
  description:
    'Browse XoomPark pit stop capacity by city. Approximate staging, charging, wash, and service areas for autonomous vehicle fleets, searchable by location.',
  alternates: { canonical: '/search' },
  openGraph: {
    title: 'Search the XoomPark Network',
    description: 'Browse pit stop capacity by city — charging, wash, and service for AV fleets.',
    url: '/search',
    type: 'website',
  },
};

export default async function SearchPage() {
  const sites = await getPublicNetworkSites();
  const cityLinks = Array.from(
    sites.reduce((map, s) => map.set(slugifyCity(s.city), { city: s.city, count: (map.get(slugifyCity(s.city))?.count ?? 0) + 1 }), new Map<string, { city: string; count: number }>()),
    ([slug, { city, count }]) => ({ slug, city, count })
  ).sort((a, b) => a.city.localeCompare(b.city));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'XoomPark network cities',
    itemListElement: cityLinks.map(({ slug, city }, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: city,
      url: `https://xoompark.co/search/${slug}`,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Suspense>
        <SearchClient sites={sites} cityLinks={cityLinks} />
      </Suspense>
    </>
  );
}
