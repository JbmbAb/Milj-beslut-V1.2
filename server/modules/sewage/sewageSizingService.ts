export type SewageSizingEstimate = {
  pe: number;
  estimatedDailyFlowLiters: number;
  suggestedBufferVolumeLiters: number;
};

export function estimateSewageSizing(pe: number): SewageSizingEstimate {
  const normalizedPe = Math.max(1, Math.round(pe));
  const estimatedDailyFlowLiters = normalizedPe * 150;

  return {
    pe: normalizedPe,
    estimatedDailyFlowLiters,
    suggestedBufferVolumeLiters: estimatedDailyFlowLiters * 2,
  };
}
