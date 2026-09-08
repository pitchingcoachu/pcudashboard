import { getAnthropicClient, DASHBOARD_CHAT_MODEL } from './anthropic-client';

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n').trim();
}

function parseJsonText<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function summarizeTranscript(input: { transcript: string; sessionType: string; title: string; playerNames: string[] }): Promise<string[]> {
  const response = await getAnthropicClient().messages.create({
    model: DASHBOARD_CHAT_MODEL,
    max_tokens: 1200,
    system: 'You turn sports coaching transcripts into accurate, concise session notes. Never invent details. Return only a JSON array of 3-10 complete bullet strings. Preserve explicit measurements, cues, action items, physical feedback, and decisions. Do not diagnose injuries.',
    messages: [{ role: 'user', content: `Title: ${input.title}\nType: ${input.sessionType}\nPlayers: ${input.playerNames.join(', ') || 'Unassigned'}\n\nTranscript:\n${input.transcript.slice(0, 120000)}` }],
  });
  const parsed = parseJsonText<unknown>(extractText(response.content));
  return Array.isArray(parsed) ? parsed.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 10) : [];
}

export async function generateReportNarrative(input: { reportType: string; title: string; reportStart: string; reportEnd: string; comparisonStart: string; comparisonEnd: string; data: unknown }): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model: DASHBOARD_CHAT_MODEL,
    max_tokens: 1200,
    system: 'Write a simple, professional baseball or athlete-development report narrative that sounds like a coach wrote it. Discuss only data points and visuals that are present in currentReport; never introduce a metric that is not featured in the report. First explain how the current performance compares with that player’s own average in playerReference, focusing on the few meaningful improvements or declines. Then, only when mlbBenchmark contains a valid comparison for one of those same featured metrics, briefly explain how it compares with the overall MLB benchmark. Do not infer missing values, mechanics, intent, or causes. Keep it concise: 2-4 short paragraphs in plain language. Begin immediately with the analysis. Do not add any title or heading, player/handedness line, Session line, Reference Window line, date range, or setup sentence that restates the report inputs. Do not diagnose injuries.',
    messages: [{ role: 'user', content: `Report: ${input.reportType}\nTitle: ${input.title}\nReport period: ${input.reportStart} to ${input.reportEnd}\nComparison period: ${input.comparisonStart} to ${input.comparisonEnd}\nData:\n${JSON.stringify(input.data).slice(0, 140000)}` }],
  });
  return extractText(response.content);
}

export async function transcribeAudioFiles(paths: string[], prompt = 'Baseball player development, pitching, hitting, bullpen, TrackMan, IVB, horizontal break, velocity, release height.'): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('Speech transcription is not configured yet. Add OPENAI_API_KEY to the server environment.');
  const { readFile } = await import('node:fs/promises');
  const transcripts = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(path);
    const form = new FormData();
    form.set('model', 'gpt-transcribe');
    form.set('prompt', prompt);
    form.set('file', new File([bytes], path.split('/').pop() || 'audio.m4a', { type: 'audio/mp4' }));
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(240000) });
    const payload = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
    if (!response.ok || !payload.text) throw new Error(payload.error?.message || 'Transcription failed.');
    return payload.text.trim();
  }));
  return transcripts.filter(Boolean).join('\n\n');
}
