import { BdrQueueView } from '../_components/BdrQueueView';
import { getWorkspaceData } from './getWorkspaceData';

// The "new here?" pointer lives once, in the shared layout's Work Queue tab
// description — no separate hint here.
export default async function ParkingSourcingWorkspacePage() {
  const { locations, practiceRecord } = await getWorkspaceData();
  return <BdrQueueView locations={locations} practiceRecord={practiceRecord} />;
}
