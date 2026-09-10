'use client';

import { useRouter } from 'next/navigation';
import { PROSPECT_STAGES, STAGE_LABELS, type ProspectStage, type ProspectSide } from '../types';

interface Props {
  currentStage?: ProspectStage;
  currentSide?: ProspectSide;
}

export function StageFilter({ currentStage, currentSide }: Props) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const p = new URLSearchParams();
    if (currentSide) p.set('side', currentSide);
    if (e.target.value) p.set('stage', e.target.value);
    router.push(`/dashboard/admin/pipeline${p.toString() ? `?${p}` : ''}`);
  }

  return (
    <select
      value={currentStage ?? ''}
      onChange={handleChange}
      className="h-8 rounded-md border border-[#0e1c36]/20 bg-white px-2 font-mono text-[11px] text-[#0e1c36] focus:outline-none focus:ring-2 focus:ring-[#0e1c36]/20"
    >
      <option value="">All stages</option>
      {PROSPECT_STAGES.map((s) => (
        <option key={s} value={s}>{STAGE_LABELS[s]}</option>
      ))}
    </select>
  );
}
