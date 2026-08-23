/**
 * Time series moving averages.
 * All return null for insufficient data.
 * WARNING: Results are forecasts, not actual values.
 */

export interface TimeSeriesPoint {
  date: string;   // ISO date
  value: number;
}

export interface ForecastPoint {
  date: string;
  forecast: number;
  lower: number;  // simple confidence interval
  upper: number;
  isForecast: true;
}

/**
 * Simple Moving Average (SMA)
 * @param data — sorted time series
 * @param window — number of periods to average
 */
export function sma(data: TimeSeriesPoint[], window: number): (number | null)[] {
  if (window <= 0 || window > data.length) return data.map(() => null);
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const slice = data.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b.value, 0) / window;
  });
}

/**
 * Exponential Moving Average (EMA)
 * α = 2 / (window + 1)
 */
export function ema(data: TimeSeriesPoint[], window: number): (number | null)[] {
  if (data.length === 0 || window <= 0) return [];
  const α = 2 / (window + 1);
  const result: (number | null)[] = [null];
  let prev = data[0].value;
  for (let i = 1; i < data.length; i++) {
    const emaVal = data[i].value * α + prev * (1 - α);
    result.push(emaVal);
    prev = emaVal;
  }
  return result;
}

/**
 * Simple SMA-based forecast for next N periods.
 * Uses last `window` values as base.
 * Returns ForecastPoints with ±1.5 stddev confidence interval.
 */
export function forecastSMA(
  data: TimeSeriesPoint[],
  window: number,
  horizon: number,
): ForecastPoint[] {
  if (data.length < window) return [];
  const recent = data.slice(-window);
  const avgValue = recent.reduce((a, b) => a + b.value, 0) / window;
  const variance = recent.reduce((a, b) => a + Math.pow(b.value - avgValue, 2), 0) / window;
  const stddev = Math.sqrt(variance);

  // Generate future dates (assume daily for now)
  const lastDate = new Date(data[data.length - 1].date);
  return Array.from({ length: horizon }, (_, i) => {
    const futureDate = new Date(lastDate);
    futureDate.setDate(futureDate.getDate() + i + 1);
    return {
      date: futureDate.toISOString().split('T')[0],
      forecast: Math.round(avgValue),
      lower: Math.max(0, Math.round(avgValue - 1.5 * stddev)),
      upper: Math.round(avgValue + 1.5 * stddev),
      isForecast: true as const,
    };
  });
}
