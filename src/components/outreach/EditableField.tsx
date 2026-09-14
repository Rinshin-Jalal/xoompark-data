'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveField } from '@/lib/outreach/actions';

// Inline-editable field — click to edit, blur/Enter to save, Esc to cancel.
export function EditableField({ label, value, lotId, field, className }: {
  label: string;
  value: string;
  lotId: string;
  field: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  function save() {
    if (val === value) { setEditing(false); return; }
    startTransition(async () => {
      try {
        await saveField(lotId, field, val);
        toast.success(`${label} saved`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        disabled={pending}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setVal(value); setEditing(false); }
        }}
        className={className}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`Edit ${label}`}
      className={`${className} cursor-text hover:bg-[#f5f4f4] rounded transition-colors duration-150`}
    >
      {value || '—'}
    </button>
  );
}