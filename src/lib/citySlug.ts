// Pure, no server-only imports - safe to use from client components (the
// /search "Browse by city" links) as well as the server-only publicNetwork
// module, which re-exports this for /search/[city].
export function slugifyCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
