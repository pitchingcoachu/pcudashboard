export type PercentileComparisonWindow = {
  startDate: string;
  endDate: string;
  label: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validIsoDate(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function defaultPercentileComparisonWindow(reference = new Date()): PercentileComparisonWindow {
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  return { startDate: isoDate(start), endDate: isoDate(end), label: 'Last 365 days' };
}

export function resolvePercentileComparisonWindow(params: URLSearchParams, reference = new Date()): PercentileComparisonWindow {
  const fallback = defaultPercentileComparisonWindow(reference);
  const requestedStart = validIsoDate(params.get('comparison_start_date') ?? params.get('comparisonStartDate'));
  const requestedEnd = validIsoDate(params.get('comparison_end_date') ?? params.get('comparisonEndDate'));
  let startDate = requestedStart || fallback.startDate;
  let endDate = requestedEnd || fallback.endDate;
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  return {
    startDate,
    endDate,
    label: requestedStart || requestedEnd ? `${startDate} to ${endDate}` : fallback.label,
  };
}
