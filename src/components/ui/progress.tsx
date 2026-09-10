'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// ponytail: plain div progress bar — no @radix-ui/react-progress dependency
// for what is a width-percentage bar. The outreach CSS styles
// [data-slot='progress'] directly.
function Progress({
  value,
  className,
  ...props
}: { value?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? 0}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-[#e5eaed]', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full bg-[#167456] transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </div>
  );
}

export { Progress };