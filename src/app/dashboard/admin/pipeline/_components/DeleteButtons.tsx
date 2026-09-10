'use client';

import { useState, useTransition } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { deleteProspect, deleteNote } from '../actions';

export function DeleteProspectButton({ prospectId, companyName }: { prospectId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteProspect(prospectId);
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error('Failed to delete prospect');
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-red-500 hover:text-red-600 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete prospect?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#0e1c36]/60">
            This will permanently delete <strong>{companyName}</strong> and all their notes. This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteNoteButton({ prospectId, noteId }: { prospectId: string; noteId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteNote(prospectId, noteId);
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error('Failed to delete note');
      }
    });
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-[#0e1c36]/30 hover:text-red-500"
      title="Delete note"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}
