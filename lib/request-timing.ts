type TimingMeta = Record<string, unknown>;

export function logApiTiming(input: {
  route: string;
  startedAtMs: number;
  status: number;
  meta?: TimingMeta;
}): void {
  if (process.env.NODE_ENV === 'test') return;
  const durationMs = Date.now() - input.startedAtMs;
  const payload: Record<string, unknown> = {
    route: input.route,
    status: input.status,
    duration_ms: durationMs,
    at: new Date().toISOString(),
  };
  if (input.meta && Object.keys(input.meta).length > 0) {
    payload.meta = input.meta;
  }
  try {
    console.info(`[api-timing] ${JSON.stringify(payload)}`);
  } catch {
    // Ignore logging failures.
  }
}
