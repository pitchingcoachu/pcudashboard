const INVALID_KEY_MARKERS = [
  '[sensitive]',
  'your_api_key_here',
  'your-api-key-here',
  'placeholder',
  'changeme',
];

const CONFIGURATION_ERROR =
  'Speech transcription is not configured correctly. Replace OPENAI_API_KEY with a valid OpenAI API key.';

export function getOpenAiTranscriptionKey(): string {
  const key = String(process.env.OPENAI_API_KEY ?? '').trim();
  const normalized = key.toLowerCase();
  if (key.length < 20 || INVALID_KEY_MARKERS.some((marker) => normalized.includes(marker))) {
    throw new Error(CONFIGURATION_ERROR);
  }
  return key;
}

export function sanitizeAiProcessingError(error: unknown): Error {
  const original = error instanceof Error ? error.message : 'Processing failed.';
  if (
    /incorrect api key|invalid[_ ]api[_ ]key|authentication(?:_error)?|401 unauthorized/i.test(original)
    || INVALID_KEY_MARKERS.some((marker) => original.toLowerCase().includes(marker))
  ) {
    return new Error(CONFIGURATION_ERROR);
  }

  // Provider messages should never be able to persist a credential in a
  // session record or return it to the browser.
  const sanitized = original
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  return new Error(sanitized || 'Processing failed.');
}
