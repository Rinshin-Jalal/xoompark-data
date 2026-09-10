import 'server-only';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Zap } from 'lucide-react';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { PrintButton } from '../../_components/PrintButton';
import type { Prospect } from '../../types';
import { INFRA_LABELS, FLEET_LABELS, SERVICE_LABELS } from '../../types';

const BD_COLLECTION = 'prospects';

async function getProspect(id: string): Promise<Prospect | null> {
  const db = getAdminFirestore();
  try {
    const doc = await db.collection(BD_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    const d = doc.data()!;
    return {
      id: doc.id, side: d.side, stage: d.stage,
      companyName: d.companyName ?? '', contactName: d.contactName ?? '',
      contactEmail: d.contactEmail ?? '', contactPhone: d.contactPhone ?? '',
      website: d.website ?? '', city: d.city ?? '', description: d.description ?? '',
      source: d.source ?? '', assignedTo: d.assignedTo ?? '',
      lastContactedAt: null, nextFollowUp: d.nextFollowUp ?? null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      providerDetails: d.providerDetails ?? null, operatorDetails: d.operatorDetails ?? null,
      createdAt: '', updatedAt: '', createdBy: d.createdBy ?? '',
    } as Prospect;
  } catch { return null; }
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="flex items-start gap-4 mb-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0e1c36] font-mono text-sm font-bold text-[#f9fbf2]">
          {n}
        </div>
        <h2 className="text-lg font-semibold text-[#0e1c36] pt-1">{title}</h2>
      </div>
      <div className="ml-12 text-sm text-[#0e1c36]/80 leading-relaxed space-y-2">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[.1em] text-[#0e1c36]/50 w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-[#0e1c36]">{value}</span>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-[#1a3a7a] pl-4 py-1 bg-[#afcbff]/10 rounded-r text-sm text-[#0e1c36]/80 space-y-1">
      {children}
    </div>
  );
}

export default async function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();

  const isProvider = prospect.side === 'provider';
  const pd = prospect.providerDetails;
  const od = prospect.operatorDetails;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const services = isProvider
    ? (pd?.servicesInterested ?? [])
    : (od?.servicesNeeded ?? []);

  return (
    <div className="max-w-4xl">
      {/* Print-only actions */}
      <div className="print:hidden flex items-center justify-between mb-6">
        <Link
          href={`/dashboard/admin/pipeline/${id}`}
          className="flex items-center gap-1.5 font-mono text-[10px] text-[#0e1c36]/40 hover:text-[#1a3a7a] uppercase tracking-[.12em]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to prospect
        </Link>
        <PrintButton />
      </div>

      {/* Guide document */}
      <div className="border border-[#0e1c36]/12 bg-white p-10 print:border-0 print:p-0">
        {/* Header */}
        <div className="border-b border-[#0e1c36]/15 pb-7 mb-8">
          <div className="flex items-center gap-2 mb-5">
            <Zap className="h-5 w-5 text-[#1a3a7a]" />
            <span className="font-mono text-sm font-bold tracking-[.14em] text-[#0e1c36]">XOOMPARK</span>
          </div>
          <h1 className="text-3xl font-bold text-[#0e1c36] tracking-tight mb-1">
            {isProvider ? 'Provider' : 'Operator'} Onboarding Guide
          </h1>
          <p className="text-[#0e1c36]/50 text-sm">Prepared for <strong className="text-[#0e1c36]">{prospect.companyName}</strong> · {today}</p>
          {prospect.contactName && (
            <p className="text-[#0e1c36]/50 text-sm mt-0.5">Attention: {prospect.contactName}{prospect.contactEmail ? ` · ${prospect.contactEmail}` : ''}</p>
          )}
        </div>

        {/* Introduction */}
        <div className="mb-8">
          <p className="text-base text-[#0e1c36] leading-relaxed">
            {isProvider ? (
              <>
                Welcome to XoomPark — the infrastructure marketplace for autonomous vehicles and smart fleets.
                As a <strong>Provider</strong>, you will list your spaces, bays, and services so that AV operators
                can discover and book them in real-time through our platform. This guide walks you through everything
                you need to go from sign-up to live.
              </>
            ) : (
              <>
                Welcome to XoomPark — the API infrastructure layer for parking, staging, charging, and service
                for autonomous vehicles and smart fleets. As an <strong>Operator</strong>, you will integrate our
                booking API so your vehicles can autonomously discover, hold, and book infrastructure services
                in real-time. This guide covers everything from account creation to your first live reservation.
              </>
            )}
          </p>
          {services.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-[#0e1c36]/40 mb-2">
                {isProvider ? 'Services you will offer:' : 'Services you need:'}
              </p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => (
                  <span key={s} className="font-mono text-[10px] font-semibold uppercase tracking-[.1em] bg-[#0e1c36]/8 text-[#0e1c36]/70 px-3 py-1 rounded-full border border-[#0e1c36]/10">
                    {SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Steps */}
        <Step n={1} title="Create Your Account">
          <p>Go to <strong>xoompark.co</strong> and click <em>Sign In</em>. Create a new account using your business email address.</p>
          <p>After signing in you will land on the main dashboard.</p>
          <InfoBox>
            <p><strong>Tip:</strong> Use an email address your team can share or transfer ownership of — this becomes the primary account for your organisation.</p>
          </InfoBox>
        </Step>

        {isProvider ? (
          <>
            <Step n={2} title="Set Up Your Provider Profile">
              <p>From the dashboard, click <strong>Set Up Provider</strong> and fill in the following:</p>
              <div className="space-y-1 mt-2">
                <Field label="Legal Name" value={`Your company's registered legal name`} />
                <Field label="Display Name" value={`The name operators see when searching — e.g. "${prospect.companyName}"`} />
                <Field label="Provider Type" value={
                  pd?.providerType
                    ? { PARKING_OPERATOR: 'Parking Operator', PROPERTY_OWNER: 'Property Owner', MUNICIPALITY: 'Municipality', INDIVIDUAL: 'Individual', OTHER: 'Other' }[pd.providerType] ?? pd.providerType
                    : 'Choose the type that best describes your organisation'
                } />
                <Field label="Contact Email" value="Your operations email address" />
                <Field label="Contact Phone" value="Your direct operations line" />
              </div>
            </Step>

            <Step n={3} title="Add Your First Site">
              <p>A <strong>Site</strong> is a physical location where you have spaces to offer. You need at least one site to go live.</p>
              <p>Click <strong>New Site</strong> in your Provider dashboard:</p>
              <div className="space-y-1 mt-2">
                <Field label="Name" value="A clear name for this location (e.g. 'Downtown SF Garage')" />
                <Field label="Address" value="Start typing — the platform uses Google Maps to pin the exact location" />
                <Field label="Geofence" value="Draw a boundary on the map that covers your property" />
                <Field label="Timezone" value="Select the local timezone" />
              </div>
              {pd?.infraType && (
                <InfoBox>
                  <p>Based on your infrastructure type (<strong>{INFRA_LABELS[pd.infraType as keyof typeof INFRA_LABELS] ?? pd.infraType}</strong>), the geofence should cover your {pd.infraType === 'CURBSIDE' ? 'curb zone' : 'property perimeter'}.</p>
                </InfoBox>
              )}
            </Step>

            <Step n={4} title="Add Resources">
              <p>A <strong>Resource</strong> is a specific bay, stall, or connector within a site. Add one resource per distinct space type.</p>
              <p>Resource types available on the platform:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li><strong>PARKING_STALL</strong> — Standard parking stall for staging</li>
                <li><strong>EV_CONNECTOR</strong> — EV charging point</li>
                <li><strong>CURB_BERTH</strong> — Curbside pick-up / drop-off bay</li>
                <li><strong>WASH_BAY</strong> — Vehicle wash bay</li>
                <li><strong>SERVICE_BAY</strong> — Maintenance or service bay</li>
              </ul>
              <p className="mt-2">For each resource, set:</p>
              <div className="space-y-1">
                <Field label="Dimensions" value="Length × Width in metres (and height if applicable — critical for vehicle matching)" />
                <Field label="Capacity" value="Number of vehicles this resource can accommodate simultaneously" />
              </div>
            </Step>

            <Step n={5} title="Create Offerings">
              <p>An <strong>Offering</strong> is a bookable service tied to a resource. This is what AV operators see and book.</p>
              <p>For each offering you configure:</p>
              <div className="space-y-1 mt-2">
                <Field label="Service Type" value="STAGE (parking), CHARGE (EV), PUDO (drop-off), WASH, or SERVICE" />
                <Field label="Metering" value="TIME_METERED (per minute/hour) or ENERGY_METERED (per kWh for charging)" />
                <Field label="Pricing" value="Set your per-minute, per-hour, or per-kWh rate" />
                <Field label="Availability" value="24/7 or custom windows — e.g. Mon–Fri 6am–10pm" />
                <Field label="Policy" value="Max duration, arrival grace period, cancellation cutoff" />
                <Field label="Eligible operators" value="Open to all operators or restricted to specific ones" />
              </div>
              <InfoBox>
                <p>Set offering status to <strong>PUBLISHED</strong> and resource status to <strong>ACTIVE</strong> when you are ready to accept bookings.</p>
              </InfoBox>
            </Step>

            <Step n={6} title="How Reservations Work">
              <p>Once live, this is the flow for every AV booking on your spaces:</p>
              <ol className="list-decimal list-inside space-y-1 mt-1">
                <li>Operator system creates a <strong>HOLD</strong> — locks the space for a short window</li>
                <li>Operator <strong>CONFIRMS</strong> — reservation is booked</li>
                <li>Vehicle arrives → <strong>Check-in</strong> via token / QR code</li>
                <li>Vehicle departs → automatic <strong>Check-out</strong> and billing</li>
              </ol>
              <p className="mt-2">You see all reservations in your <strong>Reservations</strong> dashboard in real-time, including current state, vehicle info, and usage duration.</p>
            </Step>
          </>
        ) : (
          <>
            <Step n={2} title="Set Up Your Operator Profile">
              <p>From the dashboard, click <strong>Set Up Operator</strong> and fill in:</p>
              <div className="space-y-1 mt-2">
                <Field label="Fleet / Product Name" value={`Your AV product name — e.g. "${prospect.companyName}"`} />
                <Field label="Company Legal Name" value="Your registered legal company name" />
                <Field label="Contact Email" value="Your technical operations or integration contact" />
                <Field label="Contact Phone" value="Direct line for operational queries" />
              </div>
            </Step>

            <Step n={3} title="Register Your Fleet Assets">
              <p>Add each <strong>vehicle type</strong> your system will dispatch. This is used to match your vehicles to compatible spaces (dimensions are critical).</p>
              <p>Click <strong>Add Vehicle</strong> in the Vehicles section:</p>
              <div className="space-y-1 mt-2">
                <Field label="Asset Type" value={od?.fleetType ? (FLEET_LABELS[od.fleetType as keyof typeof FLEET_LABELS] ?? od.fleetType) : 'ROBOTAXI, AV_VAN, DELIVERY_BOT, HEAVY_TRUCK, or OTHER'} />
                <Field label="Dimensions" value="Length × Width × Height in metres — used for space-matching" />
                <Field label="Display Name" value="Human-readable identifier for this vehicle class" />
              </div>
              {od?.fleetSize != null && (
                <InfoBox>
                  <p>You have a fleet of approximately <strong>{od.fleetSize} vehicles</strong>. You can register a single asset record per vehicle type to represent the whole class, or individual records per unit.</p>
                </InfoBox>
              )}
            </Step>

            <Step n={4} title="Generate API Keys">
              <p>Go to <strong>API Keys</strong> in your Operator dashboard and click <em>Create Key</em>:</p>
              <div className="space-y-1 mt-2">
                <Field label="Label" value="e.g. 'Production Booking Agent'" />
                <Field label="Role" value="booking_agent — for creating and managing reservations" />
                <Field label="Scopes" value={services.length > 0
                  ? `Select: ${services.map((s) => SERVICE_LABELS[s as keyof typeof SERVICE_LABELS] ?? s).join(', ')}`
                  : 'Select the service types your fleet uses'
                } />
              </div>
              <InfoBox>
                <p>Your full API key is shown <strong>once only</strong> at creation time — store it securely in your secrets manager. You can always revoke and regenerate.</p>
              </InfoBox>
            </Step>

            <Step n={5} title="Integrate the Booking API">
              <p>The XoomPark booking flow follows a <strong>Hold → Confirm → Check-in → Check-out</strong> lifecycle:</p>
              <div className="mt-2 font-mono text-xs bg-[#f0f4f9] rounded-md p-4 space-y-2">
                <p><span className="text-[#1a3a7a] font-semibold">POST</span> /v1/holds &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#0e1c36]/50">← Lock a resource for your vehicle</span></p>
                <p><span className="text-[#1a3a7a] font-semibold">POST</span> /v1/holds/:id/confirm &nbsp;<span className="text-[#0e1c36]/50">← Confirm → creates a reservation</span></p>
                <p><span className="text-[#1a3a7a] font-semibold">POST</span> /v1/reservations/:id/checkin &nbsp;<span className="text-[#0e1c36]/50">← Vehicle arrives</span></p>
                <p><span className="text-[#1a3a7a] font-semibold">POST</span> /v1/reservations/:id/checkout <span className="text-[#0e1c36]/50">← Vehicle departs, session billed</span></p>
              </div>
              <p className="mt-3">Authentication: <code className="font-mono text-xs bg-[#f0f4f9] px-1.5 py-0.5 rounded">Authorization: Bearer {'<your-api-key>'}</code></p>
              <p className="mt-2">Full interactive API documentation is available in your dashboard under <strong>API Docs</strong> after setting up your operator account.</p>
              {od?.operatingMarkets && (
                <InfoBox>
                  <p>XoomPark has infrastructure coverage in key markets. Search by geolocation or geohash to find available offerings in your operating markets: <strong>{od.operatingMarkets}</strong>.</p>
                </InfoBox>
              )}
            </Step>

            <Step n={6} title="Test and Go Live">
              <p>Before routing production traffic:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li>Use a <strong>sandbox API key</strong> to test the full reservation lifecycle without real charges</li>
                <li>Verify vehicle dimensions match available offerings in your target markets</li>
                <li>Confirm check-in token handling in your dispatch system</li>
                <li>Test cancellation and no-show flows</li>
              </ul>
              <p className="mt-2">When ready, switch to your <strong>production API key</strong> and you are live.</p>
              {od?.estimatedMonthlyVolume != null && (
                <InfoBox>
                  <p>With your estimated volume of <strong>~{od.estimatedMonthlyVolume.toLocaleString()} reservations/month</strong>, discuss rate limits and SLA requirements with your XoomPark contact before go-live.</p>
                </InfoBox>
              )}
            </Step>
          </>
        )}

        {/* Services reference */}
        <div className="mt-4 mb-8 border border-[#0e1c36]/10 rounded-lg p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[.14em] text-[#0e1c36]/50 mb-3">Services Reference</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {([['STAGE', 'Parking / autonomous staging areas'], ['CHARGE', 'EV charging infrastructure'], ['PUDO', 'Pick-up & drop-off curb berths'], ['WASH', 'Automated vehicle wash bays'], ['SERVICE', 'Maintenance and service bays']] as const).map(([code, desc]) => (
              <div key={code} className="flex gap-2">
                <span className="font-mono text-[10px] font-bold text-[#1a3a7a] w-16 shrink-0">{code}</span>
                <span className="text-[#0e1c36]/70">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#0e1c36]/12 pt-7 mt-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-[#0e1c36]/40 mb-3">Next Steps & Support</p>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-[#0e1c36]/70">
            <div>
              <p className="font-semibold text-[#0e1c36] mb-1">Your XoomPark Contact</p>
              {prospect.assignedTo ? (
                <p>{prospect.assignedTo}</p>
              ) : (
                <p>Reach out to your XoomPark representative for any questions during onboarding.</p>
              )}
            </div>
            <div>
              <p className="font-semibold text-[#0e1c36] mb-1">Platform</p>
              <p>xoompark.co</p>
              {!isProvider && <p className="mt-1">API Docs: available in your operator dashboard once registered</p>}
            </div>
          </div>
          <p className="font-mono text-[9px] text-[#0e1c36]/25 mt-6 uppercase tracking-[.1em]">
            XoomPark Confidential · Prepared {today} · For {prospect.companyName} only
          </p>
        </div>
      </div>
    </div>
  );
}
