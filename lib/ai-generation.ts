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

const REPORT_METRIC_CONCEPTS = [
  { name: 'QP+', pattern: /\bqp\s*\+/i }, { name: 'Ctrl+', pattern: /\b(?:ctrl|control)\s*\+/i },
  { name: 'Stuff+', pattern: /\bstuff\s*\+/i }, { name: 'Velocity', pattern: /\b(?:velo(?:city)?|mph)\b/i },
  { name: 'IVB', pattern: /\b(?:ivb|induced vertical break)\b/i }, { name: 'HB', pattern: /\b(?:hb|horizontal break)\b/i },
  { name: 'Spin', pattern: /\b(?:spin(?: rate)?|rpm)\b/i }, { name: 'Release Height', pattern: /\brelease height\b/i },
  { name: 'Release Side', pattern: /\brelease side\b/i }, { name: 'Extension', pattern: /\bextension\b/i },
  { name: 'Tilt', pattern: /\b(?:r?tilt)\b/i }, { name: 'Exit Velocity', pattern: /\b(?:exit velocity|\bev\b)\b/i },
  { name: 'Launch Angle', pattern: /\b(?:launch angle|\bla\b)\b/i }, { name: 'Bat Speed', pattern: /\bbat speed\b/i },
  { name: 'Whiff Rate', pattern: /\b(?:whiff|swstrk)\s*%?/i }, { name: 'Strike Rate', pattern: /\bstrike\s*%/i },
  { name: 'Chase Rate', pattern: /\bchase\s*%?/i }, { name: 'Swing Rate', pattern: /\bswing\s*%/i },
  { name: 'Ground Ball Rate', pattern: /\b(?:ground ball|gb)\s*%/i }, { name: 'Barrel Rate', pattern: /\bbarrel\s*%?/i },
  { name: 'xWOBA', pattern: /\bxwoba\b/i }, { name: 'xISO', pattern: /\biso\b/i },
  { name: 'Run Value', pattern: /\b(?:run value|rv\/100)\b/i }, { name: 'Pitch Value', pattern: /\b(?:pitch value|pv\/100)\b/i },
  { name: 'ERA', pattern: /\bera\b/i }, { name: 'FIP', pattern: /\b(?:x?fip)\b/i },
  { name: 'SIERA', pattern: /\bsiera\b/i }, { name: 'WHIP', pattern: /\bwhip\b/i },
];

function forbiddenReportMetrics(text: string, allowedMetrics: string[]): string[] {
  const allowed = allowedMetrics.join(' | ');
  return REPORT_METRIC_CONCEPTS.filter((metric) => metric.pattern.test(text) && !metric.pattern.test(allowed)).map((metric) => metric.name);
}

export async function generateReportNarrative(input: { reportType: string; title: string; reportStart: string; reportEnd: string; comparisonStart: string; comparisonEnd: string; allowedMetrics: string[]; data: unknown }): Promise<string> {
  const system = `Write a concise, useful performance interpretation that sounds like an experienced coach. The only metrics you may name are: ${input.allowedMetrics.join(', ')}. Treat this as a strict whitelist, including acronyms and derived metrics.

Use the precomputed comparisons to identify the two or three most meaningful changes from the player's reference average. Explain what those changes mean together instead of listing every number. Distinguish a real direction from normal stability, and mention limited samples when the supplied sample sizes make a conclusion weak. Give one practical coaching implication grounded in the shown data, such as what to preserve, monitor, or investigate next. Do not invent a cause, mechanical explanation, intent, target, or recommendation that the evidence does not support. MLB context may appear in one sentence only when an MLB benchmark is supplied for that exact whitelisted metric.

Write 2-3 short paragraphs in plain language. Lead immediately with the main takeaway. Do not add headings, bullets, player details, dates, report setup, or an exhaustive stat recap. Do not diagnose injuries.`;
  const userContent = `Report: ${input.reportType}\nTitle: ${input.title}\nReport period: ${input.reportStart} to ${input.reportEnd}\nComparison period: ${input.comparisonStart} to ${input.comparisonEnd}\nAllowed metrics: ${input.allowedMetrics.join(', ')}\nEvidence:\n${JSON.stringify(input.data).slice(0, 140000)}`;
  const create = (correction = '') => getAnthropicClient().messages.create({ model: DASHBOARD_CHAT_MODEL, max_tokens: 1000, system: correction ? `${system}\n\nYour previous response violated the whitelist by naming: ${correction}. Rewrite it without those metrics.` : system, messages: [{ role: 'user' as const, content: userContent }] });
  let response = await create();
  let text = extractText(response.content);
  const forbidden = forbiddenReportMetrics(text, input.allowedMetrics);
  if (forbidden.length) {
    response = await create(forbidden.join(', '));
    text = extractText(response.content);
  }
  const stillForbidden = forbiddenReportMetrics(text, input.allowedMetrics);
  if (stillForbidden.length) throw new Error(`The summary included metrics outside this report (${stillForbidden.join(', ')}). Please generate it again.`);
  return text;
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
