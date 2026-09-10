import { HuntTrack } from '../../tutorial/HuntTrack';
import { getWorkspaceData } from '../getWorkspaceData';

export default async function ParkingSourcingHuntPage() {
  const { locations } = await getWorkspaceData();
  return <HuntTrack locations={locations} />;
}
