'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-[4px] border border-[#0e1c36]/30 bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#167456]/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#167456] data-[state=checked]:bg-[#167456] data-[state=checked]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current">
        <Check className="h-3.5 w-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };