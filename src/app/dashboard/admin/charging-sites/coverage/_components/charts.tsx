'use client';

// Real chart components (Recharts, wrapped in the shadcn-style ChartContainer
// already used elsewhere in this design system) — replaces an earlier hand-rolled
// SVG version that looked cheap and didn't get hover/tooltip for free.

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';

const INK = '#0e1c36';
const SEQ = '#1a3a7a';

export interface BarRow {
  label: string;
  value: number;
  color?: string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function estimateLabelWidth(labels: string[]): number {
  const longest = Math.max(...labels.map((l) => l.length), 4);
  return Math.min(Math.max(longest * 6.2 + 14, 70), 280);
}

export function HBarChart({
  rows,
  barSize = 20,
  valueFmt = fmt,
  labelW,
}: {
  rows: BarRow[];
  barSize?: number;
  valueFmt?: (n: number) => string;
  labelW?: number;
}) {
  if (!rows.length) return null;
  const width = labelW ?? estimateLabelWidth(rows.map((r) => r.label));
  const height = rows.length * (barSize + 14) + 16;
  const config: ChartConfig = Object.fromEntries(rows.map((r) => [r.label, { label: r.label, color: r.color ?? SEQ }]));
  // The value label (e.g. "127,240/day") is drawn past the bar's end, inside this
  // margin — a fixed margin clips long formatted values, so size it to the longest one.
  const rightMargin = Math.max(...rows.map((r) => valueFmt(r.value).length), 4) * 6.5 + 12;

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: rightMargin, bottom: 4, left: 4 }} barSize={barSize}>
        <CartesianGrid horizontal={false} stroke={INK} strokeOpacity={0.08} />
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis
          type="category"
          dataKey="label"
          width={width}
          tickLine={false}
          axisLine={false}
          tick={{ fill: INK, fillOpacity: 0.65, fontSize: 12 }}
        />
        <Tooltip cursor={{ fill: INK, fillOpacity: 0.04 }} content={<ChartTooltip formatter={(v) => valueFmt(Number(v))} />} />
        <Bar dataKey="value" radius={4}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.color ?? SEQ} />
          ))}
          <LabelList dataKey="value" position="right" formatter={(v: unknown) => valueFmt(Number(v))} style={{ fill: INK, fontSize: 12, fontVariantNumeric: 'tabular-nums' }} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function StackedBar({ segments, height = 40 }: { segments: { label: string; value: number; color: string }[]; height?: number }) {
  const row: Record<string, number | string> = { name: 'total' };
  for (const s of segments) row[s.label] = s.value;
  const config: ChartConfig = Object.fromEntries(segments.map((s) => [s.label, { label: s.label, color: s.color }]));

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={[row]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barSize={height - 4} barGap={0} barCategoryGap={0}>
        <XAxis key="x" type="number" hide />
        <YAxis key="y" type="category" dataKey="name" hide width={0} />
        <Tooltip key="tooltip" cursor={false} content={<ChartTooltip formatter={(v) => fmt(Number(v))} />} />
        {segments.map((s, i) => (
          <Bar key={s.label} dataKey={s.label} stackId="a" fill={s.color} radius={i === 0 ? [4, 0, 0, 4] : i === segments.length - 1 ? [0, 4, 4, 0] : 0} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export function SparkBars({ values, color = SEQ, height = 56 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, value: v }));
  const config: ChartConfig = { value: { label: 'per100', color } };
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }} barSize={16}>
        <Tooltip cursor={{ fill: INK, fillOpacity: 0.04 }} content={<ChartTooltip formatter={(v) => `${v}/100sqmi`} />} />
        <Bar dataKey="value" radius={2} fill={color} />
      </BarChart>
    </ChartContainer>
  );
}

export function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[#0e1c36]/12 bg-white px-4 py-3 flex-1 min-w-[140px]">
      <div className="text-2xl font-bold text-[#0e1c36]">{value}</div>
      <div className="text-[11.5px] text-[#0e1c36]/60 mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-[#0e1c36]/40 mt-0.5">{sub}</div>}
    </div>
  );
}
