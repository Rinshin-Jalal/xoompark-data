import type { AreaResult, PowerTiers, Station } from './types';

export interface MetroRow {
  metro: string;
  boundariesMerged: number;
  sqmi: number;
  stationCount: number;
  ports: number;
  per100: number;
  dailyVehicleCapacity: number;
  powerTiers: PowerTiers;
  networkBreakdown: Record<string, number>;
  internalOverlap: number;
  areas: AreaResult[];
}

/**
 * Aggregates one row per operator+metro boundary into one row per metro name,
 * unioning station sets so a station shared by two operators in the same metro is
 * counted once. Area uses the largest single boundary in the group as a floor, not
 * a true polygon union — boundaries in a shared metro typically nest/overlap
 * rather than sit disjoint. Ported from scripts/build-charging-report.mjs so both
 * the PDF and this page compute "combined" the same way.
 */
export function mergeByMetro(perArea: AreaResult[], fastTierKw: number, sessionsPerPortPerDay: number): MetroRow[] {
  const groups = new Map<string, { metro: string; areas: AreaResult[]; sqmi: number; stations: Map<number, Station> }>();
  for (const a of perArea) {
    const key = a.metro.toLowerCase();
    const g = groups.get(key) ?? { metro: a.metro, areas: [], sqmi: 0, stations: new Map<number, Station>() };
    g.areas.push(a);
    g.sqmi = Math.max(g.sqmi, a.sqmi);
    for (const s of a.stations) g.stations.set(s.id, s);
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => {
      const stations = [...g.stations.values()];
      const ports = stations.reduce((s, x) => s + x.dcFastPorts, 0);
      const powerTiers: PowerTiers = { fast150Plus: 0, under150: 0, unknownPower: 0 };
      const networkBreakdown: Record<string, number> = {};
      for (const s of stations) {
        if (s.maxPowerKw == null) powerTiers.unknownPower++;
        else if (s.maxPowerKw >= fastTierKw) powerTiers.fast150Plus++;
        else powerTiers.under150++;
        const net = s.network ?? 'Non-Networked / Unknown';
        networkBreakdown[net] = (networkBreakdown[net] ?? 0) + 1;
      }
      const idCounts = new Map<number, number>();
      for (const a of g.areas) for (const s of a.stations) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
      const internalOverlap = [...idCounts.values()].filter((c) => c > 1).length;

      // A single-boundary metro needs no recomputation — reuse its original per100
      // exactly. data.json only stores sqmi pre-rounded to 1 decimal, so deriving
      // per100 from it here (stations/sqmi*100) drifts from the source value by a
      // few tenths on small areas; only truly merged (multi-boundary) metros have
      // no better option than recomputing from the rounded figure.
      const per100 = g.areas.length === 1 ? g.areas[0].per100 : g.sqmi > 0 ? Number(((stations.length / g.sqmi) * 100).toFixed(1)) : 0;

      return {
        metro: g.metro,
        boundariesMerged: g.areas.length,
        sqmi: Math.round(g.sqmi * 10) / 10,
        stationCount: stations.length,
        ports,
        per100,
        dailyVehicleCapacity: ports * sessionsPerPortPerDay,
        powerTiers,
        networkBreakdown,
        internalOverlap,
        areas: g.areas,
      };
    })
    .sort((a, b) => a.per100 - b.per100);
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
