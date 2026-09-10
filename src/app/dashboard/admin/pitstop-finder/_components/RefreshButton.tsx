'use client';

import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { MetroCode } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { refreshFinderResults } from '../actions';

export function RefreshButton({ metro }: { metro: MetroCode }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(async () => { await refreshFinderResults(metro); })}
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
      {isPending ? 'Refreshing…' : 'Redo search'}
    </Button>
  );
}
