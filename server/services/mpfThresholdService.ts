/**
 * Compatibility wrapper around the shared MPF domain core.
 *
 * Keep this file as the server-side entry point while the wider codebase
 * migrates away from duplicated MPF logic.
 */

import { logger } from '../logger';
import {
  evaluateMpfCode as evaluateMpfCodeCore,
  getMpfGateDecision as getMpfGateDecisionCore,
  getMpfThreshold as getMpfThresholdCore,
  listMpfThresholds as listMpfThresholdsCore,
} from '../../services/mpfEngine';

export type {
  MpfCodeType,
  MpfEvaluationResult,
  MpfGateDecision,
  MpfPermitClass,
  MpfThreshold,
} from '../../services/mpfEngine';

export function getMpfThreshold(code: string) {
  return getMpfThresholdCore(code);
}

export function listMpfThresholds() {
  return listMpfThresholdsCore();
}

export function evaluateMpfCode(input: {
  code: string;
  quantity: number;
  codeType?: 'EWC' | 'SNI';
}) {
  const result = evaluateMpfCodeCore(input);

  if (result.gateDecision === 'UNKNOWN_CODE') {
    logger.warn(`mpfThresholdService: okand kod "${input.code}" – ingen matchning i MPF-tabellen`);
  }

  return result;
}

export function getMpfGateDecision(code: string, quantity: number) {
  return getMpfGateDecisionCore(code, quantity);
}
