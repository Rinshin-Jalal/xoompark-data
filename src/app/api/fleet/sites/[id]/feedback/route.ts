import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { requireFleetKey, FleetAuthError } from '@/lib/fleet/auth';
import { parseFeedbackBody, feedbackDocId } from '@/lib/fleet/feedback';
import { getSourcedLocation } from '@/lib/sourcing/store';

/**
 * POST /api/fleet/sites/:id/feedback — the ML loop. The fleet tells us which
 * sites work for them and why; this collection is the training data Greg
 * wants to mine to predict what fleets will select.
 *
 * Body: { decision: 'selected' | 'rejected', reasons?: string[], notes?: string }
 * (see parseFeedbackBody in src/lib/fleet/feedback.ts for exact validation)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let principal;
  try {
    principal = await requireFleetKey(request);
  } catch (err) {
    if (err instanceof FleetAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const { id } = await params;
  const location = await getSourcedLocation(id);
  if (!location || location.mergedInto) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseFeedbackBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { decision, reasons, notes } = parsed.value;

  const now = new Date().toISOString();
  const docId = feedbackDocId(principal.keyId, id);
  const ref = getAdminFirestore().collection('fleetFeedback').doc(docId);
  await ref.set({
    id: docId,
    siteId: id,
    fleet: principal.fleet,
    decision,
    reasons,
    notes,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ feedbackId: docId }, { status: 201 });
}
