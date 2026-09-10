'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { createProspect, updateProspect } from '../actions';
import type { ProspectInput } from '../actions';
import type { Prospect } from '../types';
import {
  PROSPECT_STAGES, PROSPECT_SOURCES, PROVIDER_TYPES, INFRA_TYPES, FLEET_TYPES,
  BD_SERVICE_TYPES, STAGE_LABELS, SERVICE_LABELS,
} from '../types';

interface Props {
  prospect?: Prospect;
}

type FormState = {
  stage: string;
  source: string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  city: string;
  description: string;
  assignedTo: string;
  nextFollowUp: string;
  tags: string;
  providerType: string;
  infraType: string;
  estimatedSpaces: string;
  estimatedLocations: string;
  servicesInterested: string[];
  currentlyMonetized: string;
  fleetType: string;
  fleetSize: string;
  servicesNeeded: string[];
  operatingMarkets: string;
  currentSolution: string;
  apiReady: string;
  estimatedMonthlyVolume: string;
  targetGoLive: string;
};

function makeInitial(p?: Prospect): FormState {
  if (!p) {
    return {
      stage: 'IDENTIFIED', source: '', companyName: '', contactName: '',
      contactTitle: '', contactEmail: '', contactPhone: '', website: '', city: '', description: '',
      assignedTo: '', nextFollowUp: '', tags: '',
      providerType: '', infraType: '', estimatedSpaces: '', estimatedLocations: '',
      servicesInterested: [], currentlyMonetized: '',
      fleetType: '', fleetSize: '', servicesNeeded: [], operatingMarkets: '',
      currentSolution: '', apiReady: '', estimatedMonthlyVolume: '', targetGoLive: '',
    };
  }
  const pd = p.providerDetails;
  const od = p.operatorDetails;
  return {
    stage: p.stage,
    source: p.source,
    companyName: p.companyName,
    contactName: p.contactName,
    contactTitle: p.contactTitle,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    website: p.website,
    city: p.city,
    description: p.description,
    assignedTo: p.assignedTo,
    nextFollowUp: p.nextFollowUp?.slice(0, 10) ?? '',
    tags: p.tags.join(', '),
    providerType: pd?.providerType ?? '',
    infraType: pd?.infraType ?? '',
    estimatedSpaces: pd?.estimatedSpaces?.toString() ?? '',
    estimatedLocations: pd?.estimatedLocations?.toString() ?? '',
    servicesInterested: (pd?.servicesInterested ?? []) as string[],
    currentlyMonetized: pd?.currentlyMonetized == null ? '' : pd.currentlyMonetized ? 'true' : 'false',
    fleetType: od?.fleetType ?? '',
    fleetSize: od?.fleetSize?.toString() ?? '',
    servicesNeeded: (od?.servicesNeeded ?? []) as string[],
    operatingMarkets: od?.operatingMarkets ?? '',
    currentSolution: od?.currentSolution ?? '',
    apiReady: od?.apiReady == null ? '' : od.apiReady ? 'true' : 'false',
    estimatedMonthlyVolume: od?.estimatedMonthlyVolume?.toString() ?? '',
    targetGoLive: od?.targetGoLive ?? '',
  };
}

function parseBool(val: string): boolean | null {
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}

function parseNum(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toggleItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40 mb-3 mt-6 first:mt-0">
      {children}
    </p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-[#0e1c36]/40">{hint}</p>}
    </div>
  );
}

function ServiceToggle({
  types,
  selected,
  onToggle,
}: {
  types: readonly string[];
  selected: string[];
  onToggle: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {types.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onToggle(t)}
          className={cn(
            'px-3 py-1.5 rounded-full font-mono text-[10px] font-semibold uppercase tracking-[.1em] border transition-colors',
            selected.includes(t)
              ? 'bg-[#0e1c36] text-[#f9fbf2] border-[#0e1c36]'
              : 'bg-white text-[#0e1c36]/55 border-[#0e1c36]/20 hover:border-[#0e1c36]/50'
          )}
        >
          {SERVICE_LABELS[t as keyof typeof SERVICE_LABELS] ?? t}
        </button>
      ))}
    </div>
  );
}

export function ProspectForm({ prospect }: Props) {
  const side = prospect?.side ?? 'provider'; // side is fixed on edit; for new, user picks below
  const [selectedSide, setSelectedSide] = useState<'provider' | 'operator'>(side);
  const [form, setForm] = useState<FormState>(makeInitial(prospect));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!prospect;

  function set(field: keyof FormState, value: string | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function buildInput(): ProspectInput {
    return {
      side: isEdit ? prospect!.side : selectedSide,
      stage: form.stage as ProspectInput['stage'],
      companyName: form.companyName,
      contactName: form.contactName,
      contactTitle: form.contactTitle,
      contactEmail: form.contactEmail,
      contactPhone: form.contactPhone,
      website: form.website,
      city: form.city,
      description: form.description,
      source: form.source,
      assignedTo: form.assignedTo,
      nextFollowUp: form.nextFollowUp,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      providerType: form.providerType,
      infraType: form.infraType,
      estimatedSpaces: parseNum(form.estimatedSpaces),
      estimatedLocations: parseNum(form.estimatedLocations),
      servicesInterested: form.servicesInterested,
      currentlyMonetized: parseBool(form.currentlyMonetized),
      fleetType: form.fleetType,
      fleetSize: parseNum(form.fleetSize),
      servicesNeeded: form.servicesNeeded,
      operatingMarkets: form.operatingMarkets,
      currentSolution: form.currentSolution,
      apiReady: parseBool(form.apiReady),
      estimatedMonthlyVolume: parseNum(form.estimatedMonthlyVolume),
      targetGoLive: form.targetGoLive,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) {
      toast.error('Company name is required');
      return;
    }
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateProspect(prospect!.id, prospect!.side, buildInput());
        } else {
          await createProspect(buildInput());
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        toast.error(err instanceof Error ? err.message : 'Something went wrong');
      }
    });
  }

  const activeSide = isEdit ? prospect!.side : selectedSide;

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-0">
      {/* Side selector — only for new prospects */}
      {!isEdit && (
        <>
          <SectionHeader>Prospect type</SectionHeader>
          <div className="flex gap-3 mb-2">
            {(['provider', 'operator'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelectedSide(s)}
                className={cn(
                  'flex-1 py-2.5 rounded-md font-mono text-[11px] font-semibold uppercase tracking-[.12em] border transition-colors',
                  selectedSide === s
                    ? 'bg-[#0e1c36] text-[#f9fbf2] border-[#0e1c36]'
                    : 'bg-white text-[#0e1c36]/55 border-[#0e1c36]/20 hover:border-[#0e1c36]/50'
                )}
              >
                {s === 'provider' ? 'Provider (Infrastructure)' : 'Operator (Fleet / AV)'}
              </button>
            ))}
          </div>
        </>
      )}

      <SectionHeader>Company info</SectionHeader>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Field label="Company Name *">
            <Input
              value={form.companyName}
              onChange={(e) => set('companyName', e.target.value)}
              placeholder="Acme Parking LLC"
              required
            />
          </Field>
        </div>
        <Field label="City / Market">
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="San Francisco, CA" />
        </Field>
        <Field label="Website">
          <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://..." />
        </Field>
      </div>

      <SectionHeader>Primary contact</SectionHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Contact Name">
          <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Jane Smith" />
        </Field>
        <Field label="Title / Role">
          <Input value={form.contactTitle} onChange={(e) => set('contactTitle', e.target.value)} placeholder="VP Operations" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="jane@acme.com" />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+1 555 000 0000" />
        </Field>
      </div>

      <SectionHeader>Pipeline</SectionHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Stage">
          <Select value={form.stage} onValueChange={(v) => set('stage', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROSPECT_STAGES.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={form.source || '__none'} onValueChange={(v) => set('source', v === '__none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="How did you find them?" /></SelectTrigger>
            <SelectContent>
              {PROSPECT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'INBOUND' ? 'Inbound' : s === 'OUTBOUND' ? 'Outbound' : s === 'REFERRAL' ? 'Referral' :
                   s === 'CONFERENCE' ? 'Conference' : s === 'COLD_OUTREACH' ? 'Cold Outreach' : 'Other'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Assigned To">
          <Input value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} placeholder="team@xoompark.co" />
        </Field>
        <Field label="Next Follow-up">
          <Input type="date" value={form.nextFollowUp} onChange={(e) => set('nextFollowUp', e.target.value)} />
        </Field>
      </div>

      <SectionHeader>Description</SectionHeader>
      <Field label="Who are they and what do they do?" hint="Use this to capture context from conversations — the more detail the better.">
        <Textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          placeholder="E.g. Privately-owned 3-story parking structure in downtown SF, 280 stalls. Currently underutilised nights + weekends. Owner is interested in passive revenue from AV staging..."
        />
      </Field>

      {/* Provider-specific fields */}
      {activeSide === 'provider' && (
        <>
          <SectionHeader>Infrastructure details</SectionHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Legal Entity Type">
              <Select value={form.providerType || '__none'} onValueChange={(v) => set('providerType', v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === 'PARKING_OPERATOR' ? 'Parking Operator' : t === 'PROPERTY_OWNER' ? 'Property Owner' :
                       t === 'MUNICIPALITY' ? 'Municipality' : t === 'INDIVIDUAL' ? 'Individual' : 'Other'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Infrastructure Type">
              <Select value={form.infraType || '__none'} onValueChange={(v) => set('infraType', v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {INFRA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === 'PARKING_GARAGE' ? 'Parking Garage' : t === 'SURFACE_LOT' ? 'Surface Lot' :
                       t === 'HOTEL_PROPERTY' ? 'Hotel Property' : t === 'COMMERCIAL_BUILDING' ? 'Commercial Building' :
                       t === 'CURBSIDE' ? 'Curbside' : t === 'WAREHOUSE' ? 'Warehouse' : 'Other'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Est. Spaces / Bays">
              <Input type="number" min={0} value={form.estimatedSpaces} onChange={(e) => set('estimatedSpaces', e.target.value)} placeholder="280" />
            </Field>
            <Field label="Est. Locations">
              <Input type="number" min={0} value={form.estimatedLocations} onChange={(e) => set('estimatedLocations', e.target.value)} placeholder="1" />
            </Field>
            <div className="col-span-2">
              <Field label="Currently monetising spaces?">
                <Select value={form.currentlyMonetized || '__none'} onValueChange={(v) => set('currentlyMonetized', v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Unknown" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <Field label="Services they could offer">
            <ServiceToggle
              types={BD_SERVICE_TYPES}
              selected={form.servicesInterested}
              onToggle={(t) => set('servicesInterested', toggleItem(form.servicesInterested, t))}
            />
          </Field>
        </>
      )}

      {/* Operator-specific fields */}
      {activeSide === 'operator' && (
        <>
          <SectionHeader>Fleet details</SectionHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fleet Type">
              <Select value={form.fleetType || '__none'} onValueChange={(v) => set('fleetType', v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {FLEET_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === 'ROBOTAXI' ? 'Robotaxi' : t === 'AV_VAN' ? 'AV Van' :
                       t === 'DELIVERY_BOT' ? 'Delivery Bot' : t === 'HEAVY_TRUCK' ? 'Heavy Truck' : 'Other'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fleet Size (vehicles)">
              <Input type="number" min={0} value={form.fleetSize} onChange={(e) => set('fleetSize', e.target.value)} placeholder="500" />
            </Field>
            <Field label="API Integration Ready?">
              <Select value={form.apiReady || '__none'} onValueChange={(v) => set('apiReady', v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Unknown" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes — has eng resources</SelectItem>
                  <SelectItem value="false">No — not yet</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Est. Monthly Reservation Volume">
              <Input type="number" min={0} value={form.estimatedMonthlyVolume} onChange={(e) => set('estimatedMonthlyVolume', e.target.value)} placeholder="5000" />
            </Field>
            <div className="col-span-2">
              <Field label="Operating Markets / Cities">
                <Input value={form.operatingMarkets} onChange={(e) => set('operatingMarkets', e.target.value)} placeholder="San Francisco, Los Angeles, Phoenix" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Current parking / staging solution">
                <Input value={form.currentSolution} onChange={(e) => set('currentSolution', e.target.value)} placeholder="Internal lots, ad-hoc street parking..." />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Target go-live date">
                <Input type="date" value={form.targetGoLive} onChange={(e) => set('targetGoLive', e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label="Services needed">
            <ServiceToggle
              types={BD_SERVICE_TYPES}
              selected={form.servicesNeeded}
              onToggle={(t) => set('servicesNeeded', toggleItem(form.servicesNeeded, t))}
            />
          </Field>
        </>
      )}

      <SectionHeader>Tags</SectionHeader>
      <Field label="Tags" hint="Comma-separated — e.g. priority, warm-lead, ev-focus">
        <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="priority, warm-lead" />
      </Field>

      <div className="flex items-center justify-between pt-6 mt-2 border-t border-[#0e1c36]/10">
        <Button type="button" variant="ghost" asChild>
          <Link href={isEdit ? `/dashboard/admin/pipeline/${prospect!.id}` : '/dashboard/admin/pipeline'}>
            <ArrowLeft className="h-4 w-4" /> Cancel
          </Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Prospect'}
        </Button>
      </div>
    </form>
  );
}
