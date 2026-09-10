/**
 * Property-owner outreach path (Greg's playbook): county assessor lookup by
 * address -> owner name -> LinkedIn search -> pitch. We never carry the
 * owner name or a per-county assessor site in our data, so both lookup
 * steps are generic search links rather than a guessed deep link into a
 * specific assessor site (a wrong county-CAD URL is worse than a search
 * box) — the researcher picks the right result and types the owner name in.
 */

export function assessorLookupUrl(site: { streetAddress: string | null; city: string | null; state: string | null }): string {
  const address = [site.streetAddress, site.city, site.state].filter(Boolean).join(', ');
  const q = address ? `county assessor property search ${address}` : 'county assessor property search';
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function linkedInSearchUrl(ownerName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${ownerName}"`)}`;
}

export function pitchTemplate(city: string | null): string {
  return `XoomPark turns idle overnight parking into net-new revenue. We connect commercial owners with autonomous fleets for 11 PM–6 AM staging and L3 charging block-leases. Zero impact on daytime retail — just extra NOI from your existing lots. Let's pilot your ${city || 'your'} sites.`;
}
