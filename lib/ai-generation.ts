import { getAnthropicClient, DASHBOARD_CHAT_MODEL } from './anthropic-client';
import { canonicalReportMetric, type PlayerGoalReportEvidence } from './report-goal-evidence';

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
  { name: 'First Pitch Strike Rate', pattern: /\b(?:fps|first pitch strike)\s*%?/i },
  { name: 'In-Zone Rate', pattern: /\b(?:in[ -]?zone|zone)\s*%/i },
  { name: 'Competitive Pitch Rate', pattern: /\b(?:comp|competitive)\s*%/i },
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

const UNSUPPORTED_SHAPE_JUDGMENTS = [
  /\blost (?:its |their |his |her )?shape\b/i,
  /\b(?:worse|poorer|bad) pitch\b/i,
  /\bbehav(?:e|es|ed|ing) (?:more )?flat(?:ter)?\b/i,
  /\b(?:pitch|shape).{0,40}\b(?:flat(?:ter)?|steep(?:er)?)\b/i,
  /\b(?:ivb|spin efficiency|spineff).{0,80}\bflat(?:ter)?\b/i,
  /\b(?:ivb|spin efficiency|spineff).{0,80}\bsteep(?:er)?\b/i,
];

function hasUnsupportedShapeJudgment(text: string): boolean {
  return UNSUPPORTED_SHAPE_JUDGMENTS.some((pattern) => pattern.test(text));
}

function reportGoalEvidence(data: unknown): PlayerGoalReportEvidence[] {
  if (!data || typeof data !== 'object') return [];
  const goals = (data as { playerGoalEvidence?: unknown }).playerGoalEvidence;
  return Array.isArray(goals) ? (goals as PlayerGoalReportEvidence[]) : [];
}

function formatGoalMetricValue(metric: string, value: number): string {
  const metricKey = canonicalReportMetric(metric);
  if (metric.includes('%') || metricKey.endsWith('pct')) return `${value.toFixed(1)}%`;
  if (new Set(['avg', 'slg', 'obp', 'ops', 'woba', 'xwoba', 'iso', 'xiso', 'babip']).has(metricKey)) {
    return value.toFixed(3).replace(/^0/, '');
  }
  if (metricKey === 'spinrate') return `${Math.round(value)} rpm`;
  if (metricKey === 'velocity' || metricKey === 'maxvelocity') return `${value.toFixed(1)} mph`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function goalAlreadyCovered(text: string, goal: PlayerGoalReportEvidence): boolean {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const metricToken = String(goal.metric ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const metricKey = canonicalReportMetric(goal.metric);
  const metricAliases: Record<string, string[]> = {
    fpspct: ['fps', 'firstpitchstrike'],
    inzonepct: ['inzone', 'zonerate'],
    comppct: ['comppct', 'competitivepitch'],
    strikepct: ['strikepct', 'strikerate'],
  };
  const metricCovered = [metricToken, ...(metricAliases[metricKey] ?? [])].filter(Boolean).some((value) => normalizedText.includes(value));
  const scopedPitchTypes = goal.filters.pitchTypes.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')).filter(Boolean);
  const scopeCovered = !scopedPitchTypes.length || scopedPitchTypes.some((value) => normalizedText.includes(value));
  const targetCovered = normalizedText.includes(String(goal.targetValue).replace(/[^0-9]+/g, ''));
  return metricCovered && scopeCovered && targetCovered;
}

function appendMissingGoalCoverage(text: string, data: unknown): string {
  const missing = reportGoalEvidence(data).filter((goal) => !goalAlreadyCovered(text, goal));
  if (!missing.length) return text;
  const sentences = missing.flatMap((goal) => {
    const comparison = goal.comparisons[0];
    if (!comparison) return [];
    const pitchType = goal.filters.pitchTypes.length === 1 ? `${goal.filters.pitchTypes[0]} ` : '';
    const sample = comparison.currentSampleSize && comparison.currentSampleSize > 0
      ? ` over ${comparison.currentSampleSize} pitch${comparison.currentSampleSize === 1 ? '' : 'es'}`
      : '';
    const targetStatus = comparison.targetMet
      ? `met the ${formatGoalMetricValue(goal.metric, goal.targetValue)} target`
      : goal.comparator === 'Less Than'
        ? `remained above the ${formatGoalMetricValue(goal.metric, goal.targetValue)} target`
        : `remained below the ${formatGoalMetricValue(goal.metric, goal.targetValue)} target`;
    return [`On the ${pitchType}${goal.metric} goal, the report ${comparison.trend === 'stable' ? 'held steady' : comparison.trend} from ${formatGoalMetricValue(goal.metric, comparison.reference)} to ${formatGoalMetricValue(goal.metric, comparison.current)}${sample} and ${targetStatus}.`];
  });
  return sentences.length ? `${text.trim()}\n\n${sentences.join(' ')}` : text;
}

export async function generateReportNarrative(input: { reportType: string; title: string; reportStart: string; reportEnd: string; comparisonStart: string; comparisonEnd: string; allowedMetrics: string[]; data: unknown }): Promise<string> {
  const system = `Write a concise, useful performance interpretation that sounds like an experienced coach. The only metrics you may name are: ${input.allowedMetrics.join(', ')}. Treat this as a strict whitelist, including acronyms and derived metrics.

Use the precomputed comparisons to identify the two or three most meaningful changes from the player's reference average. Explain what those changes mean together instead of listing every number. Distinguish a real direction from normal stability, and mention limited samples when the supplied sample sizes make a conclusion weak. Give one practical coaching implication grounded in the shown data, such as what to preserve, monitor, or investigate next. Do not invent a cause, mechanical explanation, intent, target, or recommendation that the evidence does not support. MLB context may appear in one sentence only when an MLB benchmark is supplied for that exact whitelisted metric.

The evidence may contain playerGoalEvidence. Those entries are the only player-plan goals relevant to this report: they have a numeric target, a visible matching metric, applicable report context, and a same-metric comparison. When entries are supplied, briefly address each relevant goal using its current value, reference value, target, comparator, and supplied trend. Say whether the player improved, regressed, or remained stable toward that goal, and say the target was met only when targetMet is true. Do not mention goals at all when playerGoalEvidence is absent or empty. Never infer or discuss subjective, mechanical, physical, or otherwise unmeasured goals. Never apply a goal to a different metric, pitch type, count, batter side, or session context. In a bullpen context, do not introduce competition-result goals such as Whiff%, chase, batted-ball outcomes, K%, or BB%.

Treat pitch-shape metrics carefully. More or less IVB, HB, spin efficiency, or tilt is a shape change, not automatically an improvement or decline. Lower IVB may represent more depth, and lower spin efficiency may be intentional or normal for a cutter or other pitch type. Spin efficiency is not a pitch-quality score. Tilt describes orientation, not quality. Never call a pitch worse, say it lost its shape, or label it flatter or steeper from those metrics alone. Use neutral language such as "showed less IVB," "had more depth," or "the shape shifted from the reference." Only grade a shape change when the evidence includes an explicit target, outcome metric, or directly applicable benchmark that supports the judgment. Do not infer approach angle or trajectory from IVB alone.

Write 2-3 short paragraphs in plain language. Lead immediately with the main takeaway. Do not add headings, bullets, player details, dates, report setup, or an exhaustive stat recap. Do not diagnose injuries.`;
  const userContent = `Report: ${input.reportType}\nTitle: ${input.title}\nReport period: ${input.reportStart} to ${input.reportEnd}\nComparison period: ${input.comparisonStart} to ${input.comparisonEnd}\nAllowed metrics: ${input.allowedMetrics.join(', ')}\nEvidence:\n${JSON.stringify(input.data).slice(0, 140000)}`;
  const create = (correction = '') => getAnthropicClient().messages.create({ model: DASHBOARD_CHAT_MODEL, max_tokens: 1000, system: correction ? `${system}\n\n${correction}` : system, messages: [{ role: 'user' as const, content: userContent }] });
  let response = await create();
  let text = extractText(response.content);
  let forbidden = forbiddenReportMetrics(text, input.allowedMetrics);
  let unsupportedShapeJudgment = hasUnsupportedShapeJudgment(text);
  if (forbidden.length || unsupportedShapeJudgment) {
    const reasons = [
      forbidden.length ? `used forbidden metrics (${forbidden.join(', ')})` : '',
      unsupportedShapeJudgment ? 'made an unsupported pitch-shape quality judgment' : '',
    ].filter(Boolean).join(' and ');
    response = await create(`Your previous response ${reasons}. Rewrite from scratch. Use only the visible metric whitelist, keep movement and spin-efficiency changes neutral unless direct evidence supports a quality judgment, and omit any conclusion that depends on unsupported assumptions.`);
    text = extractText(response.content);
    forbidden = forbiddenReportMetrics(text, input.allowedMetrics);
    unsupportedShapeJudgment = hasUnsupportedShapeJudgment(text);
  }
  text = appendMissingGoalCoverage(text, input.data);
  forbidden = forbiddenReportMetrics(text, input.allowedMetrics);
  unsupportedShapeJudgment = hasUnsupportedShapeJudgment(text);
  if (forbidden.length) throw new Error(`The summary included metrics outside this report (${forbidden.join(', ')}). Please generate it again.`);
  if (unsupportedShapeJudgment) throw new Error('The summary made an unsupported pitch-shape judgment. Please generate it again.');
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
