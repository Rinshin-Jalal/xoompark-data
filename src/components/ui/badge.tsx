import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[#afcbff] text-[#0e1c36]',
        secondary: 'border-transparent bg-[#e9eef6] text-[#0e1c36]/70',
        destructive: 'border-transparent bg-red-600 text-white',
        outline: 'border-[#afcbff] text-[#1a3a7a]',
        success: 'border-transparent bg-[#16a34a] text-white',
        warning: 'border-transparent bg-[#d97706] text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
