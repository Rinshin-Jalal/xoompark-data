'use client';

import { useState, useTransition, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addNote } from '../actions';

export function AddNoteForm({ prospectId }: { prospectId: string }) {
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      try {
        await addNote(prospectId, body);
        setBody('');
        ref.current?.focus();
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error(err instanceof Error ? err.message : 'Failed to add note');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add a note — call summary, update, next steps..."
        className="resize-none text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-[#0e1c36]/30">⌘↵ to submit</p>
        <Button type="submit" size="sm" disabled={isPending || !body.trim()}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Add Note
        </Button>
      </div>
    </form>
  );
}
