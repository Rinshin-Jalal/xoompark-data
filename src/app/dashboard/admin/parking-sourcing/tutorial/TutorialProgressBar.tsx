'use client';

// Shared step-progress bar for both tutorial tracks — pure presentation over
// tutorialProgress.ts's TrackProgress. Segments for locked steps aren't
// clickable; unlocked ones jump via goToStep (already a no-op if somehow
// still locked, but the disabled attribute is the real gate here).
import { isStepUnlocked, type TrackProgress } from '@/lib/sourcing/tutorialProgress';
import { cn } from '@/lib/utils';

export function TutorialProgressBar({
  steps,
  progress,
  onJump,
}: {
  steps: string[];
  progress: TrackProgress;
  onJump: (stepIndex: number) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1 mb-1.5">
        {steps.map((label, i) => {
          const unlocked = isStepUnlocked(progress, i);
          const active = progress.step === i;
          return (
            <button
              key={label}
              disabled={!unlocked}
              onClick={() => onJump(i)}
              title={label}
              aria-label={`Step ${i + 1}: ${label}`}
              className={cn(
                'flex-1 h-1.5 rounded-full transition-colors',
                active ? 'bg-[#1a3a7a]' : unlocked ? 'bg-[#1a5a2a]' : 'bg-[#0e1c36]/10',
                unlocked && 'cursor-pointer',
              )}
            />
          );
        })}
      </div>
      <p className="text-xs text-[#0e1c36]/50">
        Step {progress.step + 1} of {steps.length}: <span className="font-medium">{steps[progress.step]}</span>
      </p>
    </div>
  );
}
