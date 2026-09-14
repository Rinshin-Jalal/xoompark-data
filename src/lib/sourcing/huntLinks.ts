// Real, hand-verified search links for the Hunt track's step 2 (docs/
// bdr-workflow.md §0.5 "Aggregators first" + §4 "Finding NEW lots"). Pure
// data + one lookup function — Firestore-free, same split as locality.ts.
//
// VERIFIED_DEEP_LINKS below were checked live (Aug 2026) by actually loading
// each URL — the destination-page pattern each aggregator uses does NOT
// generalize cleanly to all 12 canonical localities (many guessed slugs
// 404 or silently fall back to the aggregator's homepage), so only entries
// confirmed to render that specific locality's real results are included.
// Every locality not covered here falls back to that aggregator's homepage/
// city page — never a fabricated per-locality URL. This matches the task's
// explicit instruction: verify or fall back, never guess-and-ship.
interface AggregatorConfig {
  name: string;
  /** locality name (locality.ts's LOCALITIES) -> confirmed-working deep link */
  verifiedLinks: Record<string, string>;
  /** Safe fallback when no verified deep link exists for the locality. */
  homepage: string;
}

const AGGREGATORS: AggregatorConfig[] = [
  {
    name: 'SpotHero',
    verifiedLinks: {
      Brickell: 'https://spothero.com/destination/miami/brickell-parking',
      'Downtown / Central Business District': 'https://spothero.com/destination/miami/downtown-miami-parking',
      'Wynwood / Design District': 'https://spothero.com/destination/miami/wynwood-parking',
      'South Beach': 'https://spothero.com/destination/miami/south-beach-parking',
      'Coconut Grove': 'https://spothero.com/destination/miami/coconut-grove-parking',
      'Airport / Miami Springs': 'https://spothero.com/airport/miami/mia-parking',
    },
    homepage: 'https://spothero.com/',
  },
  {
    name: 'Parkopedia',
    verifiedLinks: {
      'Downtown / Central Business District': 'https://en.parkopedia.com/parking/neighbourhood/Downtown-Miami-FL/',
      'Wynwood / Design District': 'https://en.parkopedia.com/parking/neighbourhood/Wynwood-Miami-FL/',
    },
    homepage: 'https://en.parkopedia.com/parking/miami/',
  },
  {
    name: 'Parking.com',
    verifiedLinks: {},
    homepage: 'https://www.parking.com/miami/',
  },
  {
    name: 'ParkWhiz',
    verifiedLinks: {
      Brickell: 'https://www.parkwhiz.com/p/brickell-miami-fl-parking/map/',
      'Downtown / Central Business District': 'https://www.parkwhiz.com/p/downtown-miami-miami-fl-parking/map/',
      'Wynwood / Design District': 'https://www.parkwhiz.com/p/wynwood-miami-fl-parking/map/',
    },
    homepage: 'https://www.parkwhiz.com/',
  },
  {
    name: 'BestParking',
    verifiedLinks: {},
    homepage: 'https://www.bestparking.com/miami-parking/neighborhoods/',
  },
  {
    name: 'Way.com',
    verifiedLinks: {},
    homepage: 'https://www.way.com/parking/miami/',
  },
  {
    name: 'ParkMe',
    verifiedLinks: {},
    homepage: 'https://www.parkme.com/miami-parking',
  },
  {
    name: 'SpotAngels',
    verifiedLinks: {},
    homepage: 'https://www.spotangels.com/miami',
  },
];

export interface HuntAggregatorLink {
  aggregator: string;
  url: string;
  /** true = confirmed real deep link straight to this locality's results.
   * false = homepage/city page — type the locality name into its search box. */
  verified: boolean;
}

/** The 5 aggregators from §0.5's "Aggregators first" sweep, each pointed at
 * `locality` when a verified deep link exists, else at a safe fallback. */
export function huntAggregatorLinks(locality: string): HuntAggregatorLink[] {
  return AGGREGATORS.map((a) => {
    const deep = a.verifiedLinks[locality];
    return deep
      ? { aggregator: a.name, url: deep, verified: true }
      : { aggregator: a.name, url: a.homepage, verified: false };
  });
}

/** §4 "Official Miami (highest value)" — city-wide, not locality-specific;
 * every URL confirmed live (Aug 2026). */
export const HUNT_OFFICIAL_LINKS: { label: string; url: string }[] = [
  { label: 'Miami Parking Authority — garages + rates', url: 'https://www.miamiparking.com/' },
  { label: 'Miami Beach city garage/lot directory', url: 'https://www.miamibeachfl.gov/' },
  { label: 'City of Miami parking portal', url: 'https://www.miami.gov/Transportation-Roadways/Parking' },
  { label: 'PortMiami parking', url: 'https://www.miamidade.gov/portmiami/parking-information.page' },
  { label: 'MIA airport parking', url: 'https://www.miami-airport.com/airport-parking.asp' },
];

/** §4 "Aggregators we don't ingest yet" — different indexes = new lots;
 * every URL confirmed live (Aug 2026). */
export const HUNT_UNINGESTED_AGGREGATOR_LINKS: { label: string; url: string }[] = [
  { label: 'parking.com/miami', url: 'https://www.parking.com/miami/' },
  { label: 'parkwhiz.com', url: 'https://www.parkwhiz.com/' },
  { label: 'bestparking.com', url: 'https://www.bestparking.com/miami-parking/neighborhoods/' },
  { label: 'parkmobile.io', url: 'https://www.parkmobile.io/' },
  { label: 'neighbor.com', url: 'https://www.neighbor.com/' },
];
