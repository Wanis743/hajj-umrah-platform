import { roundTo } from '../math/arithmetic';

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  value?: number; // monetary value if applicable
}

export interface FunnelStageResult extends FunnelStage {
  conversionFromPrevious: number | null;  // % converted from previous stage
  dropoffFromPrevious: number | null;     // % dropped from previous stage
  conversionFromTop: number | null;       // % from first stage (overall)
  avgTimeInStage?: number | null;         // days
}

export interface FunnelResult {
  stages: FunnelStageResult[];
  totalConversion: number | null;  // first → last stage %
  totalDropoff: number | null;
}

export function analyzeFunnel(stages: FunnelStage[]): FunnelResult {
  if (stages.length === 0) return { stages: [], totalConversion: null, totalDropoff: null };

  const topCount = stages[0].count;
  const results: FunnelStageResult[] = stages.map((stage, i) => {
    const prevCount = i === 0 ? null : stages[i - 1].count;
    const convFromPrev = prevCount != null && prevCount > 0
      ? roundTo((stage.count / prevCount) * 100, 1)
      : null;
    const dropFromPrev = convFromPrev != null ? roundTo(100 - convFromPrev, 1) : null;
    const convFromTop = topCount > 0 ? roundTo((stage.count / topCount) * 100, 1) : null;

    return {
      ...stage,
      conversionFromPrevious: convFromPrev,
      dropoffFromPrevious: dropFromPrev,
      conversionFromTop: convFromTop,
    };
  });

  const lastCount = stages[stages.length - 1].count;
  const totalConversion = topCount > 0 ? roundTo((lastCount / topCount) * 100, 1) : null;

  return {
    stages: results,
    totalConversion,
    totalDropoff: totalConversion != null ? roundTo(100 - totalConversion, 1) : null,
  };
}
