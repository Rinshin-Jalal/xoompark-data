'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { createFleetKey, revokeFleetKey } from '../actions';
import { toast } from 'sonner';
import { KeyRound, Plus, Copy, Check, Loader2, AlertTriangle, ShieldOff, Clock, Activity } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface FleetKeyRow {
  id: string;
  label: string;
  status: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** "2d ago" / "3h ago" — compact enough for a table cell; the full
 * timestamp rides the hover title. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function StatusChip({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap',
        active
          ? 'bg-[#dff5e1] border-[#c8ecc9] text-[#1a5a2a]'
          : 'bg-[#ffe1e1]/60 border-[#ffcccc] text-[#7a1a1a]',
      )}
    >
      <span className={cn('h-1 w-1 rounded-full', active ? 'bg-[#1a5a2a]' : 'bg-[#7a1a1a]')} />
      {active ? 'active' : 'revoked'}
    </span>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          toast.success('Key ID copied');
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={`Key ID: ${id} — click to copy`}
      className="inline-flex items-center gap-1 text-[10px] font-mono text-[#0e1c36]/35 hover:text-[#1a3a7a] transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {id.slice(0, 8)}…
    </button>
  );
}

export function FleetKeysClient({ initialKeys }: { initialKeys: FleetKeyRow[] }) {
  const [keys, setKeys] = useState<FleetKeyRow[]>(initialKeys);
  const [isPending, startTransition] = useTransition();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [rawKeyDialog, setRawKeyDialog] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  // Two-click revoke: first click arms, second confirms. No modal for a
  // low-stakes admin action — the arm state self-cancels after 3s.
  const [armedKeyId, setArmedKeyId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  const activeCount = keys.filter((k) => k.status === 'ACTIVE').length;
  const neverUsed = keys.filter((k) => k.status === 'ACTIVE' && !k.lastUsedAt).length;

  function armRevoke(keyId: string) {
    if (armedKeyId !== keyId) {
      setArmedKeyId(keyId);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedKeyId(null), 3000);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedKeyId(null);
    startTransition(async () => {
      try {
        await revokeFleetKey(keyId);
        setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, status: 'REVOKED' } : k)));
        toast.success('Key revoked');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to revoke key');
      }
    });
  }

  function handleCreate() {
    if (!newKeyLabel.trim()) { toast.error('Enter a label for this key'); return; }
    startTransition(async () => {
      try {
        const { rawKey, keyId } = await createFleetKey({ label: newKeyLabel.trim() });
        setShowCreateDialog(false);
        // Local state update, NOT a reload — a reload would wipe the
        // raw-key dialog before the user can copy the key.
        setKeys((prev) => [
          { id: keyId, label: newKeyLabel.trim(), status: 'ACTIVE', createdAt: new Date().toISOString(), lastUsedAt: null },
          ...prev,
        ]);
        setNewKeyLabel('');
        setRawKeyDialog(rawKey);
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error(err instanceof Error ? err.message : 'Failed to create key');
      }
    });
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => toast.success('Copied to clipboard'));
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-3.5 w-3.5 text-[#1a3a7a]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40">
            Fleet API
          </span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#0e1c36]">Fleet Keys</h1>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4" /> Create Key
          </Button>
        </div>
        <p className="text-sm text-[#0e1c36]/50 mt-1">
          Keys for the Waymo-facing site API (<code className="text-[#0e1c36]/70">/api/fleet</code>). The label doubles as the fleet identity in feedback records.
        </p>
      </div>

      {keys.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="border border-[#0e1c36]/12 bg-white rounded-lg px-4 py-3">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#0e1c36]/40 mb-1">
              <Activity className="h-3 w-3" /> Active keys
            </div>
            <div className="text-xl font-semibold text-[#0e1c36]">{activeCount}</div>
          </div>
          <div className="border border-[#0e1c36]/12 bg-white rounded-lg px-4 py-3">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#0e1c36]/40 mb-1">
              <Clock className="h-3 w-3" /> Never used
            </div>
            <div className="text-xl font-semibold text-[#0e1c36]">{neverUsed}</div>
          </div>
          <div className="border border-[#0e1c36]/12 bg-white rounded-lg px-4 py-3">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#0e1c36]/40 mb-1">
              <ShieldOff className="h-3 w-3" /> Revoked
            </div>
            <div className="text-xl font-semibold text-[#0e1c36]">{keys.length - activeCount}</div>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="border border-dashed border-[#0e1c36]/20 bg-white rounded-lg flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-full bg-[#f9fbf2] border border-[#0e1c36]/10 flex items-center justify-center mb-4">
            <KeyRound className="h-5 w-5 text-[#0e1c36]/40" />
          </div>
          <h3 className="text-lg font-semibold text-[#0e1c36] mb-1">No fleet keys yet</h3>
          <p className="text-[#0e1c36]/50 text-sm mb-5 max-w-sm">
            Create one to give a fleet access to the site API. Keys are shown once at creation — store them safely.
          </p>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4" /> Create First Key
          </Button>
        </div>
      ) : (
        <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
                {['Label', 'Status', 'Last used', 'Created', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0e1c36]/8">
              {keys.map((key) => (
                <tr key={key.id} className={cn('hover:bg-[#0e1c36]/[.02]', key.status !== 'ACTIVE' && 'opacity-50')}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p className="text-xs font-medium text-[#0e1c36]">{key.label}</p>
                    <CopyId id={key.id} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <StatusChip status={key.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap" title={key.lastUsedAt ? formatDateTimeFull(key.lastUsedAt) : undefined}>
                    {key.lastUsedAt ? (
                      <span className="text-[#0e1c36]/60">{timeAgo(key.lastUsedAt)}</span>
                    ) : (
                      <span className="text-[#0e1c36]/30">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#0e1c36]/60 whitespace-nowrap" title={key.createdAt ? formatDateTimeFull(key.createdAt) : undefined}>
                    {key.createdAt ? formatDate(key.createdAt) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {key.status === 'ACTIVE' && (
                      <button
                        onClick={() => armRevoke(key.id)}
                        disabled={isPending}
                        className={cn(
                          'px-2 py-1 rounded text-[9px] border transition-colors disabled:opacity-50',
                          armedKeyId === key.id
                            ? 'text-white bg-[#7a1a1a] border-[#7a1a1a]'
                            : 'text-[#7a1a1a] bg-[#ffe1e1]/60 border-[#ffcccc] hover:bg-[#ffe1e1]',
                        )}
                      >
                        {armedKeyId === key.id ? 'Confirm revoke?' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Fleet API Key</DialogTitle>
            <DialogDescription>Name the fleet this key belongs to (e.g. &quot;Waymo — prod&quot;).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="fleetKeyLabel">Label</Label>
              <Input
                id="fleetKeyLabel"
                placeholder="Waymo — production"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <Button onClick={handleCreate} disabled={isPending} className="w-full">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Generate Key
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rawKeyDialog} onOpenChange={() => setRawKeyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Fleet API Key</DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-1.5 text-amber-600"><AlertTriangle className="h-4 w-4" /> Copy this key now — it will never be shown again.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-[#1e2d40] border border-[#0e1c36]/20 px-3 py-2.5">
              <code className="flex-1 text-xs text-[#c5d8ff] font-mono break-all leading-relaxed">{rawKeyDialog}</code>
              <Button size="sm" variant="ghost" className="text-[#c5d8ff] hover:text-white hover:bg-white/10 shrink-0" onClick={() => copyKey(rawKeyDialog!)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-[#0e1c36]/40">
              Pass this as the <code className="text-[#0e1c36]/70">X-API-Key</code> header on <code className="text-[#0e1c36]/70">/api/fleet/*</code> requests.
            </p>
            <Button variant="outline" className="w-full" onClick={() => setRawKeyDialog(null)}>
              <Check className="h-4 w-4" /> I&apos;ve saved the key
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDateTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
