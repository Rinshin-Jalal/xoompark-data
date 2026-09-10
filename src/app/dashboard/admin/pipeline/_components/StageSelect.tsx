'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateStage } from '../actions';
import { PROSPECT_STAGES, STAGE_LABELS, type ProspectStage } from '../types';

export function StageSelect({ prospectId, current }: { prospectId: string; current: ProspectStage }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(stage: ProspectStage) {
    startTransition(async () => {
      try {
        await updateStage(prospectId, stage);
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error('Failed to update stage');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0e1c36]/40" />}
      <Select value={current} onValueChange={(v) => handleChange(v as ProspectStage)}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROSPECT_STAGES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {STAGE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
