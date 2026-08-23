export function assertPositiveMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
}
export function assertNonNegativeMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}
export function assertUuid(value: string, label = 'ID'): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} is invalid`);
}
export function assertDateRange(start: string, end: string): void {
  if (new Date(start).getTime() > new Date(end).getTime()) throw new Error('Start date must be before end date');
}
