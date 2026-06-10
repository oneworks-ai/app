import type { RelayAdminDevice } from '../../shared/model/adminTypes'
import { DataPanel } from '../../shared/ui/DataPanel'
import { DeviceTable } from './DeviceTable'

export interface DevicePanelProps {
  devices: RelayAdminDevice[]
}

export const DevicePanel = ({ devices }: DevicePanelProps) => (
  <DataPanel id='devices'>
    <DeviceTable devices={devices} />
  </DataPanel>
)
