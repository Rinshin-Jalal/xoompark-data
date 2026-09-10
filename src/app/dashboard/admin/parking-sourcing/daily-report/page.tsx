import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { OutreachRecord } from '@/lib/sourcing/types';
import type { SourcedParkingLocation } from '@/lib/sourcing/types';
import { DailyReportClient } from './DailyReportClient';

export const dynamic = 'force-dynamic';

async function getOutreachData() {
  const db = getAdminFirestore();
  const lotsSnap = await db.collection('parking_lots').get();

  const rows: {
    lot: SourcedParkingLocation;
    outreach: OutreachRecord;
  }[] = [];

  for (const lotDoc of lotsSnap.docs) {
    const lot = lotDoc.data() as SourcedParkingLocation;
    if (lot.merged_into_lot_id) continue;
    const outreachSnap = await db
      .collection('parking_lots')
      .doc(lotDoc.id)
      .collection('outreach')
      .limit(1)
      .get();
    if (outreachSnap.empty) continue;
    rows.push({ lot, outreach: outreachSnap.docs[0].data() as OutreachRecord });
  }

  return rows;
}

export default async function DailyReportPage() {
  const rows = await getOutreachData();
  return <DailyReportClient rows={rows} />;
}
