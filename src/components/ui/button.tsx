import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-mono text-[11px] font-semibold tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e1c36]/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[#0e1c36] text-[#f9fbf2] shadow-sm hover:bg-[#1a3a7a]',
        destructive: 'bg-red-600 text-white shadow hover:bg-red-500',
        outline: 'border border-[#0e1c36]/25 bg-transparent text-[#0e1c36] hover:border-[#0e1c36]/50 hover:bg-[#0e1c36]/8',
        secondary: 'bg-[#e9eef6] text-[#0e1c36] shadow-sm hover:bg-[#dde4ef]',
        ghost: 'text-[#0e1c36]/60 hover:bg-[#0e1c36]/8 hover:text-[#0e1c36]',
        link: 'text-[#1a3a7a] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };