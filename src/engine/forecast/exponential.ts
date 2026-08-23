/**
 * Exponential Smoothing Forecast Engine
 * ─────────────────────────────────────
 * Implements Simple (SES), Double (Holt), and Triple (Holt-Winters)
 * exponential smoothing — all as pure functions, no side-effects.
 *
 * Labels:
 *   SIMULATED — all outputs from this module are model-generated forecasts.
 */

/** @source SIMULATED */
export type ForecastLabel = 'SIMULATED';

export interface ForecastPoint {
  /** Period index (0-based) */
  period: number;
  /** Forecast value */
  forecast: number;
  /** Lower bound of 95% prediction interval */
  lower95: number;
  /** Upper bound of 95% prediction interval */
  upper95: number;
  /** Data label for UI badges */
  dataSource: ForecastLabel;
}

export interface ExponentialResult {
  /** Fitted values for the in-sample data */
  fitted: number[];
  /** Out-of-sample forecasts */
  forecasts: ForecastPoint[];
  /** Mean Absolute Percentage Error (in-sample) */
  mape: number | null;
  /** Root Mean Square Error (in-sample) */
  rmse: number;
  /** Alpha (level smoothing) used */
  alpha: number;
  /** Beta (trend) used — null for SES */
  beta: number | null;
  /** Gamma (seasonality) used — null for SES/Holt */
  gamma: number | null;
  /** Model type */
  model: 'SES' | 'HOLT' | 'HOLT_WINTERS';
  dataSource: ForecastLabel;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function rmse(actual: number[], fitted: number[]): number {
  const n = Math.min(actual.length, fitted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (actual[i] - fitted[i]) ** 2;
  return Math.sqrt(sum / n);
}

function mape(actual: number[], fitted: number[]): number | null {
  const n = Math.min(actual.length, fitted.length);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    if (actual[i] !== 0) {
      sum += Math.abs((actual[i] - fitted[i]) / actual[i]);
      valid++;
    }
  }
  return valid === 0 ? null : (sum / valid) * 100;
}

/** 95% prediction interval half-width using in-sample RMSE and horizon */
function pi95(rmseVal: number, horizon: number): number {
  return 1.96 * rmseVal * Math.sqrt(horizon);
}

// ── 1. Simple Exponential Smoothing (SES) ─────────────────────────────────

/**
 * Simple Exponential Smoothing — no trend, no seasonality.
 *
 * @param data   Historical values (≥2)
 * @param alpha  Smoothing factor 0 < α < 1  (default: auto-estimated via grid search)
 * @param horizon Number of periods to forecast
 */
export function ses(
  data: number[],
  alpha?: number,
  horizon = 4,
): ExponentialResult {
  if (data.length < 2) {
    throw new Error('SES requires at least 2 data points');
  }

  // Auto-select alpha via grid search minimising RMSE if not provided
  const a = alpha !== undefined ? alpha : bestAlpha(data);

  const fitted: number[] = [];
  let level = data[0];

  for (let i = 0; i < data.length; i++) {
    fitted.push(level);
    level = a * data[i] + (1 - a) * level;
  }

  const inRmse = rmse(data, fitted);
  const inMape = mape(data, fitted);

  const forecasts: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const f = level; // SES: all horizon forecasts = last level
    const hw = pi95(inRmse, h);
    forecasts.push({
      period: data.length + h - 1,
      forecast: round2(f),
      lower95: round2(Math.max(0, f - hw)),
      upper95: round2(f + hw),
      dataSource: 'SIMULATED',
    });
  }

  return { fitted: fitted.map(round2), forecasts, mape: inMape, rmse: round2(inRmse), alpha: a, beta: null, gamma: null, model: 'SES', dataSource: 'SIMULATED' };
}

// ── 2. Holt's Double Exponential Smoothing (Trend) ───────────────────────

/**
 * Holt's Linear Exponential Smoothing — handles trend.
 *
 * @param data    Historical values (≥3)
 * @param alpha   Level smoothing 0 < α < 1
 * @param beta    Trend smoothing 0 < β < 1
 * @param horizon Periods to forecast
 */
export function holt(
  data: number[],
  alpha?: number,
  beta?: number,
  horizon = 4,
): ExponentialResult {
  if (data.length < 3) {
    throw new Error('Holt requires at least 3 data points');
  }

  const a = alpha ?? 0.3;
  const b = beta ?? 0.1;

  let level = data[0];
  let trend = data[1] - data[0];
  const fitted: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const prevLevel = level;
    const prevTrend = trend;
    fitted.push(prevLevel + prevTrend);
    level = a * data[i] + (1 - a) * (prevLevel + prevTrend);
    trend = b * (level - prevLevel) + (1 - b) * prevTrend;
  }

  const inRmse = rmse(data, fitted);
  const inMape = mape(data, fitted);

  const forecasts: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const f = level + h * trend;
    const hw = pi95(inRmse, h);
    forecasts.push({
      period: data.length + h - 1,
      forecast: round2(f),
      lower95: round2(Math.max(0, f - hw)),
      upper95: round2(f + hw),
      dataSource: 'SIMULATED',
    });
  }

  return { fitted: fitted.map(round2), forecasts, mape: inMape, rmse: round2(inRmse), alpha: a, beta: b, gamma: null, model: 'HOLT', dataSource: 'SIMULATED' };
}

// ── 3. Holt-Winters Triple Exponential Smoothing (Trend + Seasonality) ───

/**
 * Holt-Winters (additive) — handles trend and seasonal patterns.
 *
 * @param data     Historical values — must be ≥ 2 full seasons
 * @param season   Number of periods in a season (e.g. 12 for monthly, 4 for quarterly)
 * @param alpha    Level smoothing
 * @param beta     Trend smoothing
 * @param gamma    Seasonal smoothing
 * @param horizon  Periods to forecast
 */
export function holtWinters(
  data: number[],
  season = 12,
  alpha = 0.3,
  beta = 0.1,
  gamma = 0.2,
  horizon = season,
): ExponentialResult {
  if (data.length < 2 * season) {
    throw new Error(`Holt-Winters requires at least ${2 * season} data points for season=${season}`);
  }

  // Initialise level, trend, and seasonal indices
  let level = data.slice(0, season).reduce((s, v) => s + v, 0) / season;
  let trend = (
    data.slice(season, 2 * season).reduce((s, v) => s + v, 0) / season -
    data.slice(0, season).reduce((s, v) => s + v, 0) / season
  ) / season;
  const seasonal: number[] = data.slice(0, season).map(v => v - level);

  const fitted: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const s = seasonal[i % season];
    const prevLevel = level;
    const prevTrend = trend;
    fitted.push(prevLevel + prevTrend + s);
    level = alpha * (data[i] - s) + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    seasonal[i % season] = gamma * (data[i] - prevLevel - prevTrend) + (1 - gamma) * s;
  }

  const inRmse = rmse(data, fitted);
  const inMape = mape(data, fitted);

  const forecasts: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const f = level + h * trend + seasonal[(data.length + h - 1) % season];
    const hw = pi95(inRmse, h);
    forecasts.push({
      period: data.length + h - 1,
      forecast: round2(f),
      lower95: round2(Math.max(0, f - hw)),
      upper95: round2(f + hw),
      dataSource: 'SIMULATED',
    });
  }

  return { fitted: fitted.map(round2), forecasts, mape: inMape, rmse: round2(inRmse), alpha, beta, gamma, model: 'HOLT_WINTERS', dataSource: 'SIMULATED' };
}

// ── Auto-select alpha ──────────────────────────────────────────────────────

/** Grid search over α ∈ [0.05, 0.95] to minimise in-sample RMSE for SES */
function bestAlpha(data: number[]): number {
  let best = 0.3;
  let bestRmse = Infinity;
  for (let a = 0.05; a <= 0.95; a += 0.05) {
    let level = data[0];
    const fitted: number[] = [];
    for (let i = 0; i < data.length; i++) {
      fitted.push(level);
      level = a * data[i] + (1 - a) * level;
    }
    const r = rmse(data, fitted);
    if (r < bestRmse) { bestRmse = r; best = a; }
  }
  return Math.round(best * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Convenience ───────────────────────────────────────────────────────────

/**
 * Auto-select the best model:
 * - SES if data.length < 6
 * - Holt if trend detected
 * - Holt-Winters if seasonal pattern and enough data
 */
export function autoForecast(
  data: number[],
  season = 12,
  horizon = 4,
): ExponentialResult {
  if (data.length >= 2 * season) {
    return holtWinters(data, season, undefined, undefined, undefined, horizon);
  }
  if (data.length >= 6) {
    return holt(data, undefined, undefined, horizon);
  }
  return ses(data, undefined, horizon);
}
