import type { ServiceType } from './types';

export type TaskKey =
  | 'ACCESS'
  | 'POSITIONED'
  | 'PLUGGED_IN'
  | 'PLUGGED_OUT'
  | 'VACATED'
  | 'WASH_COMPLETE'
  | 'SERVICE_COMPLETE';

export const TASK_REGISTRY_VERSION = 1;

export const TASK_REGISTRY: Record<ServiceType, TaskKey[]> = {
  STAGE:   ['ACCESS', 'POSITIONED'],
  CHARGE:  ['ACCESS', 'POSITIONED', 'PLUGGED_IN', 'PLUGGED_OUT'],
  PUDO:    ['ACCESS', 'VACATED'],
  WASH:    ['ACCESS', 'WASH_COMPLETE'],
  SERVICE: ['ACCESS', 'SERVICE_COMPLETE'],
};

export const TASK_LABELS: Record<TaskKey, string> = {
  ACCESS:           'Access Granted',
  POSITIONED:       'Vehicle Positioned',
  PLUGGED_IN:       'Plugged In',
  PLUGGED_OUT:      'Plugged Out',
  VACATED:          'Berth Cleared',
  WASH_COMPLETE:    'Wash Complete',
  SERVICE_COMPLETE: 'Service Complete',
};
