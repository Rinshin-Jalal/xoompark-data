'use client';

import { useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { oddZoneAt } from '@/lib/odd/odd';
import { cn } from '@/lib/utils';
import { validateAddLocationInput, type AddLocationFormInput } from '@/lib/sourcing/addLocation';
import { addSourcedLocation } from '../actions';
import { toast } from 'sonner';
import { TriStateControl } from './SourcingReviewTable';


const EMPTY_FORM: AddLocationFormInput = {
  name: '',
  sourceUrl: '',
  address: '',
  lat: '',
  lng: '',
  priceText: '',
  hoursText: '',
  capacityText: '',
  clearanceText: '',
  ingressEgress: '',
  notes: '',
  addedBy: '',
};

export function AddLocationButton({
  onSuccess,
  locality,
  keepOpenAfterSave,
  onStage,
  editStaged,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Fired after a successful submit, before the modal closes — lets a
   * caller (the Hunt tutorial track) observe the real mergedExisting
   * signal without a second write path. Optional so every existing call
   * site (just the admin toolbar button) keeps working unchanged. */
  onSuccess?: (result: { mergedExisting: boolean }) => void;
  /** Set by a caller that already knows the locality (the Hunt tracker,
   * which has the BDR's currently-selected locality) — silently attached to
   * the submit, not a form field, since the BDR already committed to it by
   * picking the locality before opening this form. */
  locality?: string;
  /** A successful save clears the form but leaves the dialog open (instead
   * of the default auto-close) so several lots can be entered back-to-back
   * without reopening it each time — the Hunt tracker's step 2, where a BDR
   * is finding multiple new lots in one aggregator sweep. Off by default:
   * the toolbar's one-off add and the tutorial's single "add one lot" step
   * both want the normal close-on-save behavior. */
  keepOpenAfterSave?: boolean;
  /** When set, Save does NOT write to Firestore at all — it validates
   * locally and hands the raw form values to this callback instead, then
   * clears the form and stays open for the next one. The actual write
   * happens later, wherever the caller batches its staged list (Hunt's
   * step 4 "Save all"). Mutually exclusive with keepOpenAfterSave/onSuccess
   * — this always keeps the dialog open, since staging one lot doesn't mean
   * you're done. */
  onStage?: (input: AddLocationFormInput) => void;
  /** Double-click on an already-staged (not yet saved) lot in the on-page
   * list re-opens this same form pre-filled with its values, so it can be
   * corrected before the batch is saved — editing something that only
   * exists in local state, not Firestore, hence no update-vs-create
   * ambiguity. When set: no trigger button is rendered (this instance
   * exists solely to show that one edit dialog), the dialog starts open,
   * and Save replaces the staged entry via onSave instead of writing
   * anywhere or appending a new one. */
  editStaged?: {
    value: AddLocationFormInput;
    onSave: (input: AddLocationFormInput) => void;
    onCancel: () => void;
  };
  /** Controlled open — when set, the internal trigger button is hidden and
   * the dialog opens from outside (e.g. the Add-lot dropdown menu). All
   * existing call sites omit it and keep their own button, unchanged. */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
} = {}) {
  const router = useRouter();
  const isStaging = !!onStage || !!editStaged;
  const [internalOpen, setInternalOpen] = useState(!!editStaged);
  // Controlled-or-uncontrolled: when `open` is passed the dialog is driven
  // from outside (Add-lot menu) and the internal trigger is hidden; every
  // existing call site omits it, so behavior there is unchanged.
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [form, setForm] = useState<AddLocationFormInput>(editStaged?.value ?? EMPTY_FORM);
  // Staging (Hunt's rapid multi-add) only really needs Name + Source URL to
  // move fast — the other ~10 fields stayed visible unconditionally before,
  // which is what made the dialog feel dense/confusing there. Collapsed by
  // default in staging mode, expanded by default everywhere else (the
  // toolbar's one-off complete add). Auto-expands if editing a staged entry
  // that already has one of the extra fields filled, so existing data is
  // never hidden.
  const [showMore, setShowMore] = useState(() => {
    if (!isStaging) return true;
    const v = editStaged?.value;
    if (!v) return false;
    return !!(
      v.address || v.lat || v.lng || v.priceText || v.hoursText || v.capacityText
      || v.clearanceText || v.ingressEgress || v.addedBy || v.notes
      || v.access247 !== undefined || v.fenced !== undefined || v.lit !== undefined
    );
  });
  // Tri-state fields — TriStateControl works on boolean|null|undefined
  // directly (null = "checked, couldn't tell"), so these live outside the
  // string-only `form` object rather than round-tripping through it.
  const [access247, setAccess247] = useState<boolean | null | undefined>(editStaged?.value.access247);
  const [fenced, setFenced] = useState<boolean | null | undefined>(editStaged?.value.fenced);
  const [lit, setLit] = useState<boolean | null | undefined>(editStaged?.value.lit);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [addedCount, setAddedCount] = useState(0);
  const [isPending, startTransition] = useTransition();

  const showToast = (t: { type: 'success' | 'error'; message: string }) => {
    if (t.type === 'success') toast.success(t.message);
    else toast.error(t.message);
  };

  // Excludes the tri-state keys — those are boolean|null|undefined
  // (TriStateControl), not string-bindable like the rest of the form.
  type StringFormKey = Exclude<keyof AddLocationFormInput, 'access247' | 'fenced' | 'lit'>;
  const bind = (key: StringFormKey) => ({
    value: form[key] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const resetFields = () => {
    setForm(EMPTY_FORM);
    setAccess247(undefined);
    setFenced(undefined);
    setLit(undefined);
    setFieldErrors({});
  };

  // Only Name/Source URL are required to save (validateAddLocationInput) —
  // a BDR can type just those, hit Save, and the rest is filled in later via
  // the Work Queue (any draft record shows up there). This confirm only
  // guards against silently losing typed-but-never-saved input when closing
  // without saving at all.
  const hasUnsavedInput =
    Object.entries(form).some(([k, v]) => k !== 'locality' && typeof v === 'string' && v.trim() !== '')
    || access247 !== undefined || fenced !== undefined || lit !== undefined;

  const handleClose = () => {
    // Editing a staged item: closing without "Save changes" just discards
    // this in-progress edit — the staged entry itself is untouched (never
    // mutated until onSave), so there's nothing to confirm before losing.
    if (editStaged) {
      editStaged.onCancel();
      return;
    }
    if (hasUnsavedInput && !window.confirm("Discard what you've typed? It hasn't been saved yet.")) return;
    setOpen(false);
    resetFields();
    setAddedCount(0);
  };

  const handleSubmit = () => {
    if (editStaged) {
      const validation = validateAddLocationInput({ ...form, locality, access247, fenced, lit });
      if (!validation.ok) {
        setFieldErrors(validation.fieldErrors);
        return;
      }
      setFieldErrors({});
      editStaged.onSave({ ...form, locality, access247, fenced, lit });
      return;
    }
    if (onStage) {
      const validation = validateAddLocationInput({ ...form, locality, access247, fenced, lit });
      if (!validation.ok) {
        setFieldErrors(validation.fieldErrors);
        return;
      }
      setFieldErrors({});
      onStage({ ...form, locality, access247, fenced, lit });
      resetFields();
      setAddedCount((c) => c + 1);
      showToast({ type: 'success', message: 'Added to the list below — not saved yet' });
      return;
    }
    startTransition(async () => {
      const result = await addSourcedLocation({ ...form, locality, access247, fenced, lit });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        return;
      }
      setFieldErrors({});
      resetFields();
      if (!keepOpenAfterSave) setOpen(false);
      setAddedCount((c) => c + 1);
      showToast({
        type: 'success',
        message: result.mergedExisting
          ? 'Already existed — merged your fields into it'
          : result.saved
            ? 'Added — every field filled in, so it skips the Work Queue'
            : 'Added — draft created',
      });
      onSuccess?.({ mergedExisting: result.mergedExisting });
      router.refresh();
    });
  };

  return (
    <>
      {!editStaged && controlledOpen === undefined && (
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs font-mono uppercase tracking-[.08em] bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a]"
        >
          Add Location
        </button>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editStaged ? 'Edit staged lot' : onStage ? 'Add a lot to your list' : 'Add sourced location'}
            </DialogTitle>
            <DialogDescription>
              {editStaged
                ? 'Still not saved — this only updates the staged entry. Save all still happens together in step 4.'
                : onStage
                  ? "Not saved yet — added to the list below. Nothing writes to the database until you hit \"Save all\" in step 4."
                  : 'Manually captured lot — created as a draft; whatever you fill in is marked verified.'}
              {!editStaged && (keepOpenAfterSave || onStage) && addedCount > 0 && (
                <span className="block mt-1 text-[#1a5a2a] font-medium">
                  ✓ {addedCount} {onStage ? 'in your list so far' : 'added so far'} — form cleared, add the next one
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Name *</label>
                <input {...bind('name')} className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm" />
                {fieldErrors.name && <p className="text-xs text-[#c1121f] mt-1">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Source URL *</label>
                <input {...bind('sourceUrl')} className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm" />
                {fieldErrors.sourceUrl && <p className="text-xs text-[#c1121f] mt-1">{fieldErrors.sourceUrl}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-[#0e1c36]/70">Address</label>
                <input {...bind('address')} className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm" />
              </div>

              {isStaging && !showMore && (
                <button
                  type="button"
                  onClick={() => setShowMore(true)}
                  className="text-xs text-[#1a3a7a] hover:underline"
                >
                  + More fields (optional) — price, hours, capacity, fenced/lit, etc.
                </button>
              )}

              {(showMore || !isStaging) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[#0e1c36]/70">Lat</label>
                      <input
                        {...bind('lat')}
                        type="number"
                        className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                      />
                      {fieldErrors.lat && <p className="text-xs text-[#c1121f] mt-1">{fieldErrors.lat}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#0e1c36]/70">Lng</label>
                      <input
                        {...bind('lng')}
                        type="number"
                        className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                      />
                      {fieldErrors.lng && <p className="text-xs text-[#c1121f] mt-1">{fieldErrors.lng}</p>}
                    </div>
                  </div>
                  {(() => {
                    const lat = Number(form.lat);
                    const lng = Number(form.lng);
                    if (!form.lat || !form.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    const zone = oddZoneAt(lat, lng, 'waymo');
                    return (
                      <p className={cn('text-xs -mt-1', zone ? 'text-[#1a5a2a]' : 'text-[#0e1c36]/40')}>
                        {zone ? `✓ In Waymo ODD — ${zone.metro}` : 'Outside the Waymo ODD'}
                      </p>
                    );
                  })()}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[#0e1c36]/70">Price</label>
                      <input
                        {...bind('priceText')}
                        placeholder="e.g. $10/day"
                        className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#0e1c36]/70">Hours open</label>
                      <input
                        {...bind('hoursText')}
                        placeholder="e.g. 24/7 or 6am–10pm"
                        className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#0e1c36]/70">Capacity</label>
                    <input {...bind('capacityText')} className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm" />
                  </div>
                  <TriStateControl id="add-access247" label="24/7 access" value={access247} onChange={setAccess247} />
                  <TriStateControl id="add-fenced" label="Fenced" value={fenced} onChange={setFenced} />
                  <TriStateControl id="add-lit" label="Lit" value={lit} onChange={setLit} />
                  <div>
                    <label htmlFor="add-ingressEgress" className="text-xs font-medium text-[#0e1c36]/70">Ingress / egress</label>
                    <input
                      id="add-ingressEgress"
                      {...bind('ingressEgress')}
                      placeholder="e.g. one-way in, separate exit on SE 2nd St"
                      className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="add-clearanceText" className="text-xs font-medium text-[#0e1c36]/70">Clearance</label>
                    <input
                      id="add-clearanceText"
                      {...bind('clearanceText')}
                      placeholder={'e.g. 6\'8"'}
                      className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#0e1c36]/70">Added by</label>
                    <input
                      {...bind('addedBy')}
                      placeholder="Your name (optional)"
                      className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#0e1c36]/70">Notes</label>
                    <textarea
                      {...bind('notes')}
                      rows={3}
                      className="w-full mt-1 px-3 py-2 border border-[#0e1c36]/20 rounded text-sm resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <p className="text-[10px] text-[#0e1c36]/40 mt-4">
              {editStaged
                ? 'Only Name and Source URL are required.'
                : onStage
                  ? 'Only Name and Source URL are required. Add as many lots as you find here, then save them all together in step 4.'
                  : "Only Name and Source URL are required. Save now with just what you know — it's created as a draft, and you can come back and finish the rest anytime from the Work Queue."}
            </p>
            <div className="flex gap-2 justify-end mt-2">
              <button onClick={handleClose} className="px-3 py-1.5 text-sm border border-[#0e1c36]/20 rounded hover:bg-[#0e1c36]/5">
                {editStaged ? 'Cancel' : 'Close'}
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="px-3 py-1.5 text-sm bg-[#0e1c36] text-white rounded hover:bg-[#1a3a7a] disabled:opacity-50"
              >
                {isPending ? 'Saving…' : editStaged ? 'Save changes' : onStage ? 'Add to list' : 'Save'}
              </button>
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
