'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

// shadcn/ui's chart.tsx, adapted to this project's convention: colors are literal
// hex strings on each ChartConfig entry (this app doesn't theme via CSS custom
// properties elsewhere), so the CSS-variable injection shadcn normally does is
// dropped in favor of reading `color` straight off the config.

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color: string;
  }
>;

type ChartContextProps = { config: ChartConfig };
const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[#0e1c36]/50 [&_.recharts-cartesian-grid_line]:stroke-[#0e1c36]/8 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-[#0e1c36]/15 [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-radial-bar-background-sector]:fill-[#0e1c36]/5 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[#0e1c36]/5 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-[#0e1c36]/15 [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  className,
  indicator = 'dot',
}: {
  active?: boolean;
  payload?: readonly { name?: string; value?: number | string; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];
  label?: string;
  labelFormatter?: (label: string) => React.ReactNode;
  formatter?: (value: number | string, name: string) => React.ReactNode;
  className?: string;
  indicator?: 'dot' | 'line';
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div className={cn('grid min-w-[10rem] gap-1.5 rounded-lg border border-[#0e1c36]/10 bg-white px-3 py-2 text-xs shadow-md', className)}>
      {label && <div className="font-medium text-[#0e1c36] mb-0.5">{labelFormatter ? labelFormatter(label) : label}</div>}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = item.dataKey ?? item.name ?? `item-${i}`;
          const itemConfig = config[key as string];
          const color = item.color ?? itemConfig?.color;
          return (
            <div key={key} className="flex items-center gap-2">
              {indicator === 'dot' && <span className="h-2 w-2 rounded-[2px] shrink-0" style={{ background: color }} />}
              <span className="text-[#0e1c36]/60">{itemConfig?.label ?? item.name}</span>
              <span className="ml-auto font-medium tabular-nums text-[#0e1c36]">
                {formatter ? formatter(item.value as number, key as string) : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartLegendContent({ config }: { config: ChartConfig }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2 text-xs text-[#0e1c36]/60">
      {Object.entries(config).map(([key, item]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px] shrink-0" style={{ background: item.color }} />
          {item.label ?? key}
        </div>
      ))}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartLegendContent, useChart };
