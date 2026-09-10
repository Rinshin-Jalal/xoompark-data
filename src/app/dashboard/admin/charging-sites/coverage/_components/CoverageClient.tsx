'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HBarChart, StackedBar, SparkBars, StatTile, type BarRow } from './charts';
import { OPERATOR_COLOR, OPERATOR_LABEL, groupLabel } from '../lib/labels';
import { titleCase, type MetroRow } from '../lib/mergeByMetro';
import type { CoverageData } from '../lib/types';

const MUTED = '#0e1c36';
const fmt = (n: number) => n.toLocaleString('en-US');

export function CoverageClient({ data, metros }: { data: CoverageData; metros: MetroRow[] }) {
  const [tab, setTab] = useState<'operator' | 'combined'>('operator');
  const h = data.headline;
  const genDate = data.meta.generatedAt.slice(0, 10);

  const footprintRows: BarRow[] = useMemo(
    () =>
      tab === 'operator'
        ? data.perOperator.map((o) => ({ label: OPERATOR_LABEL[o.operator] ?? o.operator, value: o.uniqueDcFastStations, color: OPERATOR_COLOR[o.operator] }))
        : metros.slice().sort((a, b) => b.stationCount - a.stationCount).map((m) => ({ label: titleCase(m.metro), value: m.stationCount })),
    [tab, data.perOperator, metros],
  );

  const capacityRows: BarRow[] = useMemo(
    () =>
      tab === 'operator'
        ? data.perOperator.map((o) => ({ label: OPERATOR_LABEL[o.operator] ?? o.operator, value: o.dailyVehicleCapacity, color: OPERATOR_COLOR[o.operator] }))
        : metros.slice().sort((a, b) => b.dailyVehicleCapacity - a.dailyVehicleCapacity).map((m) => ({ label: titleCase(m.metro), value: m.dailyVehicleCapacity })),
    [tab, data.perOperator, metros],
  );

  const topNetworks = Object.entries(h.networkBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const otherNetworks = Object.entries(h.networkBreakdown).sort((a, b) => b[1] - a[1]).slice(8).reduce((s, [, v]) => s + v, 0);
  const networkRows: BarRow[] = [...topNetworks.map(([k, v]) => ({ label: k, value: v })), ...(otherNetworks ? [{ label: 'Other networks', value: otherNetworks, color: MUTED }] : [])];

  const growthAreas = useMemo(() => data.perArea.filter((a) => a.growth.length > 1).sort((a, b) => b.growth.length - a.growth.length), [data.perArea]);
  const metroOccurrence = new Map<string, number>();
  for (const a of growthAreas) metroOccurrence.set(a.metro.toLowerCase(), (metroOccurrence.get(a.metro.toLowerCase()) ?? 0) + 1);

  const overlapRows: BarRow[] = useMemo(
    () =>
      tab === 'operator'
        ? data.overlapByGroup.map((g) => ({ label: groupLabel(g.sharedBy), value: g.dailyVehicleCapacity }))
        : metros.filter((m) => m.internalOverlap > 0).sort((a, b) => b.internalOverlap - a.internalOverlap).map((m) => ({ label: titleCase(m.metro), value: m.internalOverlap })),
    [tab, data.overlapByGroup, metros],
  );

  const gapRows = data.perArea.map((a) => ({ ...a, gapPct: a.gap.totalPoints ? (100 * a.gap.gapPoints) / a.gap.totalPoints : 0 })).filter((a) => a.gapPct > 0).sort((a, b) => b.gapPct - a.gapPct);

  return (
    <div className="space-y-6">
      {/* Headline stat tiles */}
      <div className="flex flex-wrap gap-3">
        <StatTile value={fmt(h.uniqueDcFastStations)} label="Unique DC-fast stations" sub={`across ${h.activeAreas} active service areas`} />
        <StatTile value={`${Math.round((100 * h.stationsSharedAcrossOperators) / h.uniqueDcFastStations)}%`} label="Stations shared by 2+ operators" sub={`${fmt(h.stationsSharedAcrossOperators)} of ${fmt(h.uniqueDcFastStations)}`} />
        <StatTile value={`${Math.round((100 * h.powerTiers.fast150Plus) / h.uniqueDcFastStations)}%`} label='150kW+ ("fleet-grade")' sub={`${fmt(h.powerTiers.fast150Plus)} of ${fmt(h.uniqueDcFastStations)} stations`} />
        <StatTile value={fmt(h.dailyVehicleCapacity)} label="Daily session ceiling" sub="shared with the public — see caveats" />
      </div>

      {/* Sources */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sources</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-[12.5px] text-[#0e1c36]/65 space-y-1.5">
          <p><strong className="text-[#0e1c36]">Boundaries</strong> — <a className="text-[#1a3a7a] underline" href={data.meta.avMapDataRepo} target="_blank" rel="noreferrer">github.com/path-avmap/av-map-data</a>. {data.meta.avMapDataNote}</p>
          <p><strong className="text-[#0e1c36]">Chargers</strong> — NREL AFDC, <a className="text-[#1a3a7a] underline" href="https://developer.nlr.gov" target="_blank" rel="noreferrer">developer.nlr.gov</a>, live query at run time.</p>
          <p><strong className="text-[#0e1c36]">Generated</strong> — {genDate}. Re-run <code className="bg-[#0e1c36]/5 px-1 rounded">./scripts/build-charging-report.sh</code> to refresh.</p>
        </CardContent>
      </Card>

      {/* Power tiers (shared) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Power tiers — does it actually turn a fleet around fast?</CardTitle>
          <CardDescription>150kW+ matters for fleet turnaround time. 3 stations report no power data — never counted as slow.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <StackedBar
            segments={[
              { label: '150kW+', value: h.powerTiers.fast150Plus, color: '#184f95' },
              { label: 'Under 150kW', value: h.powerTiers.under150, color: '#6da7ec' },
              { label: 'Unreported', value: h.powerTiers.unknownPower, color: MUTED },
            ]}
          />
          <div className="flex gap-5 text-[11.5px] text-[#0e1c36]/60 mt-3">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#184f95' }} />150kW+ — {fmt(h.powerTiers.fast150Plus)}</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#6da7ec' }} />Under 150kW — {fmt(h.powerTiers.under150)}</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: MUTED }} />Unreported — {fmt(h.powerTiers.unknownPower)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Networks (shared) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Which networks fleets actually depend on</CardTitle>
          <CardDescription>All {fmt(h.uniqueDcFastStations)} stations, by charging network.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <HBarChart rows={networkRows} />
        </CardContent>
      </Card>

      {/* Toggle: operator vs. combined */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'operator' | 'combined')}>
        <TabsList>
          <TabsTrigger value="operator">By operator</TabsTrigger>
          <TabsTrigger value="combined">Combined (by metro)</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} forceMount className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Charging footprint {tab === 'operator' ? 'by operator' : 'by metro'}</CardTitle>
                <CardDescription>Unique public DC-fast stations inside active service area(s){tab === 'combined' ? ', deduplicated where more than one boundary covers a metro' : ', deduplicated across metros'}.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <HBarChart rows={footprintRows} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Theoretical daily vehicle-charge capacity {tab === 'operator' ? 'by operator' : 'by metro'}</CardTitle>
                <CardDescription>Ports × {data.meta.capacityAssumptions.sessionsPerPortPerDay} sessions/port/day ({data.meta.capacityAssumptions.sessionMinutes}-min session, {data.meta.capacityAssumptions.operatingHoursPerDay} operating hrs/day). A ceiling on a public pool, not dedicated fleet capacity — see caveats.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <HBarChart rows={capacityRows} valueFmt={(n) => fmt(n) + '/day'} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Growth vs. charging density</CardTitle>
              <CardDescription>Every metro with more than one historical boundary. Bars are stations-per-100-sq-mi at each boundary date, holding today&apos;s charger snapshot constant (AFDC has no historical archive). Falling bars = expansion outpacing charging.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {growthAreas.map((a, i) => {
                  const first = a.growth[0];
                  const last = a.growth[a.growth.length - 1];
                  const trend = last.per100 < first.per100 ? 'down' : last.per100 > first.per100 ? 'up' : 'flat';
                  const isDup = (metroOccurrence.get(a.metro.toLowerCase()) ?? 0) > 1;
                  const nth = growthAreas.slice(0, i + 1).filter((x) => x.metro.toLowerCase() === a.metro.toLowerCase()).length;
                  const title = tab === 'operator' ? `${OPERATOR_LABEL[a.operator] ?? a.operator} — ${titleCase(a.metro)}` : `${titleCase(a.metro)}${isDup ? ` — boundary ${nth}` : ''}`;
                  const color = tab === 'operator' ? OPERATOR_COLOR[a.operator] : undefined;
                  return (
                    <div key={a.slug} className="rounded-md border border-[#0e1c36]/10 bg-white p-3">
                      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#0e1c36] mb-1.5">
                        {color && <span className="w-2 h-2 rounded-sm inline-block flex-shrink-0" style={{ background: color }} />}
                        {title}
                      </div>
                      <div className="flex items-center gap-3">
                        <SparkBars values={a.growth.map((g) => g.per100)} color={color} />
                        <div className="text-[10.5px] text-[#0e1c36]/55 leading-relaxed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <div>{first.date} → {last.date}</div>
                          <div>{first.sqmi} → {last.sqmi} sq mi</div>
                          <div className={trend === 'down' ? 'text-[#b4351f]' : trend === 'up' ? 'text-[#0ca30c]' : ''}>
                            {first.per100} → {last.per100} stations/100sqmi
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{tab === 'operator' ? 'Overlap: contended capacity between fleets' : 'Metros where service areas overlap'}</CardTitle>
                <CardDescription>
                  {tab === 'operator'
                    ? 'Daily session ceiling of the exact station pools shared by two or more operators’ service areas.'
                    : 'Stations that fall inside more than one active service boundary within the same metro.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <HBarChart rows={overlapRows} labelW={tab === 'operator' ? 190 : 110} valueFmt={tab === 'operator' ? (n) => fmt(n) + '/day' : fmt} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Coverage gaps</CardTitle>
                <CardDescription>Grid-sampled distance from {data.meta.gapThresholdMiles} miles to the nearest public DC-fast station, inside each boundary. Essentially none — the constraint is shared capacity, not distance.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#0e1c36]/45 text-[9.5px] uppercase tracking-wide">
                      {tab === 'operator' && <th className="pb-1.5 pr-3 font-semibold">Operator</th>}
                      <th className="pb-1.5 pr-3 font-semibold">Metro</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Beyond {data.meta.gapThresholdMiles}mi</th>
                      <th className="pb-1.5 font-semibold text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {gapRows.map((a) => (
                      <tr key={a.slug} className="border-t border-[#0e1c36]/8">
                        {tab === 'operator' && (
                          <td className="py-1.5 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: OPERATOR_COLOR[a.operator] }} />
                              {OPERATOR_LABEL[a.operator] ?? a.operator}
                            </span>
                          </td>
                        )}
                        <td className="py-1.5 pr-3">{titleCase(a.metro)}</td>
                        <td className="py-1.5 pr-3 text-right">{a.gap.gapAreaSqMiEst} sq mi</td>
                        <td className="py-1.5 text-right">{a.gapPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{tab === 'operator' ? 'Every service area' : 'Every metro'}</CardTitle>
              <CardDescription>Sorted by charger density (stations per 100 sq mi), sparsest first.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              {tab === 'operator' ? (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#0e1c36]/45 text-[9.5px] uppercase tracking-wide">
                      <th className="pb-1.5 pr-3 font-semibold">Operator</th>
                      <th className="pb-1.5 pr-3 font-semibold">Metro</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Sq mi</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">DC-fast</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Per 100sqmi</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">150kW+</th>
                      <th className="pb-1.5 font-semibold text-right">Daily capacity</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {data.perArea.slice().sort((a, b) => a.per100 - b.per100).map((a) => (
                      <tr key={a.slug} className="border-t border-[#0e1c36]/8">
                        <td className="py-1.5 pr-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: OPERATOR_COLOR[a.operator] }} />
                            {OPERATOR_LABEL[a.operator] ?? a.operator}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3">{titleCase(a.metro)}</td>
                        <td className="py-1.5 pr-3 text-right">{a.sqmi.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right">{a.insideCount}</td>
                        <td className="py-1.5 pr-3 text-right">{a.per100}</td>
                        <td className="py-1.5 pr-3 text-right">{a.powerTiers.fast150Plus}</td>
                        <td className="py-1.5 text-right">{fmt(a.dailyVehicleCapacity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#0e1c36]/45 text-[9.5px] uppercase tracking-wide">
                      <th className="pb-1.5 pr-3 font-semibold">Metro</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Boundaries merged</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Sq mi</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">DC-fast</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">Per 100sqmi</th>
                      <th className="pb-1.5 pr-3 font-semibold text-right">150kW+</th>
                      <th className="pb-1.5 font-semibold text-right">Daily capacity</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {metros.map((m) => (
                      <tr key={m.metro} className="border-t border-[#0e1c36]/8">
                        <td className="py-1.5 pr-3">{titleCase(m.metro)}</td>
                        <td className="py-1.5 pr-3 text-right">{m.boundariesMerged}</td>
                        <td className="py-1.5 pr-3 text-right">{m.sqmi.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right">{m.stationCount}</td>
                        <td className="py-1.5 pr-3 text-right">{m.per100}</td>
                        <td className="py-1.5 pr-3 text-right">{m.powerTiers.fast150Plus}</td>
                        <td className="py-1.5 text-right">{fmt(m.dailyVehicleCapacity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Method & caveats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Method &amp; caveats</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="text-[12px] text-[#0e1c36]/60 space-y-2 list-disc pl-4">
            <li><strong className="text-[#0e1c36]">Boundaries</strong> are a snapshot, not live. {data.meta.avMapDataNote}</li>
            <li><strong className="text-[#0e1c36]">Chargers</strong>: {data.meta.afdcNote}</li>
            <li><strong className="text-[#0e1c36]">Capacity ceiling</strong>: {data.meta.capacityAssumptions.note}</li>
            <li><strong className="text-[#0e1c36]">Missing power data is null, never 0</strong> — unreported-power stations are excluded from both power tiers, not folded into &quot;slow.&quot;</li>
            <li><strong className="text-[#0e1c36]">Cruise excluded</strong> — in the raw dataset (San Francisco, 2022 boundaries) but shut down December 2023.</li>
            <li><strong className="text-[#0e1c36]">Non-US areas excluded, not zeroed</strong> — Apollo Go, WeRide, and Moia service areas fall outside AFDC&apos;s US-only coverage.</li>
          </ul>
          <details className="mt-3">
            <summary className="text-[12px] text-[#1a3a7a] cursor-pointer">Excluded source files ({data.meta.excluded.length})</summary>
            <table className="w-full text-[11.5px] mt-2">
              <tbody>
                {data.meta.excluded.map((e) => (
                  <tr key={e.file} className="border-t border-[#0e1c36]/8">
                    <td className="py-1 pr-3 text-[#0e1c36]/70">{e.file.replace('geometries/', '')}</td>
                    <td className="py-1 text-[#0e1c36]/45">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
