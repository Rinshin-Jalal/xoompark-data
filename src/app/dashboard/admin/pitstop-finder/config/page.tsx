'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MetroCode } from '@/lib/types';
import { saveFinderConfig, deleteMetro } from './actions';
import { DEFAULT_FINDER_CONFIGS } from '../lib/config';

const METRO_CODES: MetroCode[] = ['sf', 'sd', 'miami', 'austin', 'dallas', 'phoenix', 'vegas'];

function notify(type: 'success' | 'error', message: string) {
  if (typeof window !== 'undefined') {
    alert(`${type.toUpperCase()}: ${message}`);
  }
}

type EditCell = { metro_id: string; field: string } | null;

interface EditPopupProps {
  value: any;
  onSave: (v: any) => void;
  onCancel: () => void;
  field: string;
  type?: 'text' | 'number';
}

function EditPopup({ value, onSave, onCancel, field, type = 'text' }: EditPopupProps) {
  const [input, setInput] = useState(String(value));

  return (
    <div className="fixed inset-0 bg-white/30 backdrop-blur-md flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg p-4 w-80 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[#0e1c36] mb-3">{field}</h3>
        <Input
          autoFocus
          type={type}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(type === 'number' ? parseFloat(input) : input);
            if (e.key === 'Escape') onCancel();
          }}
          className="mb-4 text-sm"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onSave(type === 'number' ? parseFloat(input) : input)}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const [metros, setMetros] = useState<any[]>(Object.values(DEFAULT_FINDER_CONFIGS));
  const [editCell, setEditCell] = useState<EditCell>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMetroCode, setNewMetroCode] = useState('');
  const [newMetroName, setNewMetroName] = useState('');
  const [isPending, startTransition] = useTransition();

  const availableMetroCodes = METRO_CODES.filter((code) => !metros.some((m) => m.metro_id === code));

  const handleCellEdit = (metro_id: string, field: string, newValue: any) => {
    setMetros((prev) =>
      prev.map((m) =>
        m.metro_id === metro_id ? { ...m, [field]: newValue, updated_at: new Date() } : m
      )
    );

    startTransition(async () => {
      try {
        const config = metros.find((m) => m.metro_id === metro_id);
        if (!config) return;
        await saveFinderConfig(metro_id as MetroCode, { ...config, [field]: newValue });
        notify('success', `Saved`);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to save');
      }
    });
    setEditCell(null);
  };

  const handleDelete = (metro_id: string, name: string) => {
    if (!confirm(`Delete ${name} and all its site findings?`)) return;

    startTransition(async () => {
      try {
        await deleteMetro(metro_id as MetroCode, true);
        setMetros((prev) => prev.filter((m) => m.metro_id !== metro_id));
        notify('success', `${name} removed.`);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to delete');
      }
    });
  };

  const handleAddMetro = () => {
    if (!newMetroCode || !newMetroName) {
      notify('error', 'Metro code and name required');
      return;
    }

    if (metros.some((m) => m.metro_id === newMetroCode)) {
      notify('error', 'Metro already exists');
      return;
    }

    // Use Miami as template
    const template = DEFAULT_FINDER_CONFIGS.miami;
    const newConfig = {
      ...template,
      metro_id: newMetroCode as MetroCode,
      name: newMetroName,
    };

    startTransition(async () => {
      try {
        await saveFinderConfig(newMetroCode as MetroCode, newConfig);
        setMetros((prev) => [...prev, { ...newConfig, created_at: new Date(), updated_at: new Date() }]);
        notify('success', `${newMetroName} added.`);
        setShowAddForm(false);
        setNewMetroCode('');
        setNewMetroName('');
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to add metro_id');
      }
    });
  };

  const EditableCell = ({ metro_id, field, value, type = 'text' }: { metro_id: string; field: string; value: any; type?: 'text' | 'number' }) => (
    <td
      className="px-4 py-3 text-sm cursor-pointer hover:bg-[#0e1c36]/5 transition-colors"
      onDoubleClick={() => setEditCell({ metro_id, field })}
    >
      {editCell?.metro_id === metro_id && editCell?.field === field ? (
        <EditPopup
          value={value}
          onSave={(v) => handleCellEdit(metro_id, field, v)}
          onCancel={() => setEditCell(null)}
          field={field}
          type={type}
        />
      ) : null}
      <span className="text-[#0e1c36]">{value}</span>
    </td>
  );

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0e1c36]">Scoring Configuration</h1>
        <p className="text-sm text-[#0e1c36]/50 mt-1">Double-click any cell to edit. Add new metros below.</p>
      </div>

      <div className="border border-[#0e1c36]/12 bg-white rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#0e1c36]/10 bg-[#f9fbf2]">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Metro
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Anchors
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Walk-List
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Res. Penalty
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[.1em] text-[#0e1c36]/40">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0e1c36]/8">
            {metros.map((m) => (
              <tr key={m.metro_id} className="hover:bg-[#0e1c36]/[.02]">
                <EditableCell metro_id={m.metro_id} field="name" value={m.name} />
                <td className="px-4 py-3 text-sm text-[#0e1c36]/60 font-mono">{m.metro_id}</td>
                <td className="px-4 py-3 text-sm text-[#0e1c36]/60">{m.anchors.length}</td>
                <EditableCell metro_id={m.metro_id} field="walkListThreshold" value={m.walkListThreshold} type="number" />
                <EditableCell metro_id={m.metro_id} field="residentialPenalty" value={m.residentialPenalty} type="number" />
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(m.metro_id, m.name)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[#c1121f]" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <Button onClick={() => setShowAddForm(true)} disabled={isPending || availableMetroCodes.length === 0} className="text-xs">
          {availableMetroCodes.length === 0 ? 'All metros added' : 'Add Metro'}
        </Button>
      </div>

      {showAddForm && availableMetroCodes.length > 0 && (
        <div className="fixed inset-0 bg-white/30 backdrop-blur-md flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-lg">
            <h2 className="text-lg font-semibold text-[#0e1c36] mb-4">Add New Metro</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Metro Code</label>
                <select
                  value={newMetroCode}
                  onChange={(e) => setNewMetroCode(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                >
                  <option value="">Select a metro_id...</option>
                  {availableMetroCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Name</label>
                <Input
                  value={newMetroName}
                  onChange={(e) => setNewMetroName(e.target.value)}
                  placeholder="e.g., New York"
                  className="mt-1 text-sm"
                />
              </div>
              <p className="text-xs text-[#0e1c36]/50">
                Uses Miami as a template. You can edit all settings after creating.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddForm(false);
                  setNewMetroCode('');
                  setNewMetroName('');
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleAddMetro} disabled={isPending || !newMetroCode || !newMetroName}>
                {isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
