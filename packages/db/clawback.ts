/**
 * Re-export shim for the clawback DB module.
 * Allows imports via 'db/clawback' consistent with tsconfig path mapping.
 */
export {
  createClawbackEvent,
  triggerGuaranteePeriod,
  holdCommissionRecordsForClawback,
  listCommissionRecordIdsForPlacement,
  createCommissionRecordAdjustment,
  createClawbackRecoverySchedule,
  getClawbackStatusForPlacement,
  getProducerClawbackExposure,
} from './src/clawback.js';
export type {
  ClawbackEventRow,
  CommissionRecordAdjustmentRow,
  ClawbackRecoveryScheduleRow,
  CreateClawbackEventInput,
  CreateAdjustmentInput,
  CreateRecoveryScheduleInput,
  ClawbackStatus,
} from './src/clawback.js';
