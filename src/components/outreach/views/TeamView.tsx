'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useData, useRoles } from '@/components/outreach/DataContext';
import { AvatarStack } from '@/components/spectrumui/avatar-stack';
import { createUser, setUserRoles, listUsers } from '@/lib/outreach/userActions';
import { syncCompanyAccounts } from '@/lib/outreach/actions';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/outreach/roles';

export function TeamView() {
  const data = useData();
  const roles = useRoles();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [newRoles, setNewRoles] = useState<Role[]>(['bdr']);
  const [users, setUsers] = useState<{ uid: string; email: string; roles: string[] }[]>([]);
  const [loaded, setLoaded] = useState(false);

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
                          onClick={() => handleRoles(u.uid, (u.roles.includes(r) ? u.roles.filter((x) => x !== r) : [...u.roles, r]) as Role[])}
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

      <div className="team-layout">
        <section className="panel settings-panel">
          <h2>Who owns the next step?</h2>
          <p className="muted">Preview role names, not authenticated employee accounts.</p>
          <div className="mt-4"><AvatarStack items={owners.map((name) => ({ name }))} /></div>
          <form style={{ display: 'grid', gap: 18, marginTop: 28 }}>
            {[
              ['researcher', 'Research owner'],
              ['bdr1', 'BDR · territory A'],
              ['bdr2', 'BDR · territory B'],
              ['sdr', 'SDR call owner'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'grid', gap: 8, fontSize: 13, color: '#6b6868' }}>
                {label}
                <input name={key} defaultValue={String(data.settings[key as keyof typeof data.settings])} readOnly className="h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]" />
              </label>
            ))}
            <label style={{ display: 'grid', gap: 8, fontSize: 13, color: '#6b6868' }}>
              Daily operator groups per person
              <input name="dailyLimit" type="number" defaultValue={data.settings.dailyLimit} readOnly className="h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]" />
            </label>
          </form>
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
    </>
  );
}