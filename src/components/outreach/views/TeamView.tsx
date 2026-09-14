'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useData, useRoles } from '@/components/outreach/DataContext';
import { AvatarStack } from '@/components/spectrumui/avatar-stack';
import { createUser, setUserRoles, listUsers } from '@/lib/outreach/userActions';
import { syncCompanyAccounts, getAllActivity } from '@/lib/outreach/actions';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/outreach/roles';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function TeamView() {
  const data = useData();
  const roles = useRoles();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [newRoles, setNewRoles] = useState<Role[]>(['bdr']);
  const [users, setUsers] = useState<{ uid: string; email: string; roles: string[] }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<{ actor: string; message: string; created: string; lead_id: string }[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  // Pending role change — confirmed via dialog before applying.
  const [pendingChange, setPendingChange] = useState<{ uid: string; email: string; roles: Role[] } | null>(null);

  const owners = [...new Set(Object.values(data.settings).filter((v) => typeof v === 'string'))] as string[];

  function toggleRole(r: Role) {
    setNewRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function loadUsers() {
    startTransition(async () => {
      try {
        setUsers(await listUsers());
        setLoaded(true);
      } catch {
        setLoaded(true);
      }
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await createUser(email, newRoles);
        toast.success(r.message);
        setEmail('');
        setNewRoles(['bdr']);
        await loadUsers();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create user');
      }
    });
  }

  function handleRoles(uid: string, r: Role[]) {
    startTransition(async () => {
      try {
        await setUserRoles(uid, r);
        toast.success('Roles updated');
        await loadUsers();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update roles');
      }
    });
  }

  function confirmRoleChange() {
    if (!pendingChange) return;
    handleRoles(pendingChange.uid, pendingChange.roles);
    setPendingChange(null);
  }

  function handleSyncAccounts() {
    startTransition(async () => {
      try {
        const r = await syncCompanyAccounts();
        toast.success(`Synced ${r.accounts} operator accounts`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to sync accounts');
      }
    });
  }

  function loadActivity() {
    startTransition(async () => {
      try {
        setActivity(await getAllActivity(100));
        setActivityLoaded(true);
      } catch {
        setActivityLoaded(true);
      }
    });
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> ADMIN</div>
          <h1>One team. A connected workflow.</h1>
          <p>Set the owners and keep the next step unambiguous.</p>
        </div>
      </div>

      {roles.includes('admin') && (
        <section className="panel mb-6">
          <div className="panel-heading">
            <div>
              <h2>Team members</h2>
              <p>Create users and assign roles. Only admins can create accounts.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSyncAccounts} disabled={pending} className="text-sm text-[#3b7a57] hover:underline disabled:opacity-50">
                Sync accounts
              </button>
              {!loaded && <button onClick={loadUsers} className="text-sm text-[#3b7a57] hover:underline">Load users</button>}
            </div>
          </div>
          <div className="p-4">
            <form onSubmit={handleCreate} className="flex gap-2 mb-4">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.com"
                required
                className="flex-1 h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
              />
              <div className="flex gap-1 items-center">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    className={`px-2.5 h-10 text-xs rounded-md border transition-colors ${
                      newRoles.includes(r) ? 'bg-[#111] text-white border-[#111]' : 'border-[#e5e3e3] text-[#6b6868] hover:border-[#171717]'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
              <button type="submit" disabled={pending} className="px-4 h-10 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] inline-flex items-center gap-1.5 disabled:opacity-60">
                <Plus size={14} /> Create
              </button>
            </form>

            {loaded && users.length > 0 && (
              <div className="divide-y divide-[#e5e3e3]">
                {users.map((u) => (
                  <div key={u.uid} className="flex items-center justify-between py-2">
                    <span className="text-sm text-[#171717]">{u.email}</span>
                    <div className="flex gap-1">
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          onClick={() => setPendingChange({ uid: u.uid, email: u.email, roles: (u.roles.includes(r) ? u.roles.filter((x) => x !== r) : [...u.roles, r]) as Role[] })}
                          className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                            u.roles.includes(r) ? 'bg-[#111] text-white border-[#111]' : 'border-[#e5e3e3] text-[#6b6868] hover:border-[#171717]'
                          }`}
                        >
                          {ROLE_LABELS[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {roles.includes('admin') && (
        <section className="panel mb-6">
          <div className="panel-heading">
            <div>
              <h2>Activity</h2>
              <p>Who did what, across the whole workspace.</p>
            </div>
            {!activityLoaded && <button onClick={loadActivity} className="text-sm text-[#3b7a57] hover:underline">Load activity</button>}
          </div>
          {activityLoaded && (
            <div className="divide-y divide-[#e5e3e3] max-h-96 overflow-y-auto">
              {activity.length === 0 ? (
                <p className="p-4 text-sm text-[#6b6868]">No activity yet.</p>
              ) : (
                activity.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-4">
                    <span className="text-sm text-[#171717]">{a.message}</span>
                    <span className="text-xs text-[#6b6868] shrink-0 ml-4">{a.actor} · {new Date(a.created).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}

      <div className="team-layout">
        <section className="panel settings-panel">
          <h2>Who owns the next step?</h2>
          <p className="muted">Real users, assigned by role. Manage roles in the Team members section above.</p>
          <div className="mt-4"><AvatarStack items={owners.map((name) => ({ name }))} /></div>
          <div style={{ display: 'grid', gap: 18, marginTop: 28 }}>
            {[
              ['researcher', 'Research owner'],
              ['bdr', 'BDR · territory A'],
              ['bdr', 'BDR · territory B'],
              ['sdr', 'SDR call owner'],
            ].map(([role, label], i) => {
              const roleUsers = users.filter((u) => u.roles.includes(role));
              const value = role === 'bdr' ? (roleUsers[i === 1 ? 0 : 1]?.email ?? 'Unassigned') : (roleUsers[0]?.email ?? 'Unassigned');
              return (
                <label key={label} style={{ display: 'grid', gap: 8, fontSize: 13, color: '#6b6868' }}>
                  {label}
                  <input value={value} readOnly className="h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]" />
                </label>
              );
            })}
            <label style={{ display: 'grid', gap: 8, fontSize: 13, color: '#6b6868' }}>
              Daily operator groups per person
              <input type="number" defaultValue={data.settings.dailyLimit} readOnly className="h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]" />
            </label>
          </div>
        </section>
        <section className="panel settings-panel">
          <h2>How work moves</h2>
          {[
            ['01', 'A daily action queue', 'A dated plan is created when the workspace opens. Unfinished work carries forward.'],
            ['02', 'AI-first research is the target', 'AI should fill sourced property details: address, owner/operator, facility type, spaces, hours, access, PUDO, staging, accessibility and contact routes.'],
            ['03', 'BDRs review and email', 'BDRs verify the details, resolve missing information, prepare and send emails from their own inbox, log sent messages and replies, and follow up.'],
            ['04', 'SDRs own the calls', 'SDRs receive the research brief and BDR email history. They call to identify or qualify the decision-maker, resolve open questions and record the next step.'],
            ['05', 'Fewer duplicate conversations', 'Daily tasks group operator records. Updates affect only the selected property; portfolio-wide approval is never assumed.'],
          ].map(([n, t, d]) => (
            <div className="rule" key={n}><b>{n}</b><div><h3>{t}</h3><p>{d}</p></div></div>
          ))}
        </section>
      </div>

      <Dialog open={!!pendingChange} onOpenChange={(open) => { if (!open) setPendingChange(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change roles?</DialogTitle>
            <DialogDescription>
              {pendingChange?.email} will become:{' '}
              <span className="font-medium text-[#171717]">
                {pendingChange?.roles.length ? pendingChange.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'no roles'}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setPendingChange(null)} className="px-4 py-2 text-sm rounded-md border border-[#e5e3e3] text-[#171717] hover:bg-[#f5f4f4] transition-colors duration-150">
              Cancel
            </button>
            <button onClick={confirmRoleChange} disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] transition-colors duration-150 disabled:opacity-60">
              Confirm
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}