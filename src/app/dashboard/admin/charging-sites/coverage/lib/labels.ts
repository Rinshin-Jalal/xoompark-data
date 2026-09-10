// Operator color/label mapping and slug parsing, ported from
// scripts/build-charging-report.mjs so the PDF and this page read identically.

export const OPERATOR_COLOR: Record<string, string> = {
  waymo: '#2a78d6',
  tesla: '#eb6834',
  zoox: '#1baf7a',
  'may-mobility': '#eda100',
  avride: '#e87ba4',
};

export const OPERATOR_LABEL: Record<string, string> = {
  waymo: 'Waymo',
  tesla: 'Tesla',
  zoox: 'Zoox',
  'may-mobility': 'May Mobility',
  avride: 'Avride',
};

// Slugs are "operator-metro" (e.g. "tesla-bay-area", "may-mobility-atlanta") —
// operator can be multi-word, so split on the known operator keys rather than the
// first hyphen.
const MULTI_WORD_OPERATORS = ['apollo-go', 'may-mobility'];

export function splitSlug(slug: string): { operator: string; metro: string } {
  const operator = MULTI_WORD_OPERATORS.find((op) => slug === op || slug.startsWith(op + '-')) ?? slug.split('-')[0];
  return { operator, metro: slug.slice(operator.length + 1) };
}

export function slugLabel(slug: string): string {
  const { operator, metro } = splitSlug(slug);
  const metroTitled = metro.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${OPERATOR_LABEL[operator] ?? operator} (${metroTitled})`;
}

// When every slug in a group names the same metro (the common case), collapse to
// "Tesla + Waymo + Zoox (San Francisco)" instead of repeating the metro per operator.
export function groupLabel(slugs: string[]): string {
  const parsed = slugs.map(splitSlug);
  const metros = new Set(parsed.map((p) => p.metro));
  if (metros.size === 1) {
    const metroTitled = parsed[0].metro.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `${parsed.map((p) => OPERATOR_LABEL[p.operator] ?? p.operator).join(' + ')} (${metroTitled})`;
  }
  return slugs.map(slugLabel).join(' + ');
}
