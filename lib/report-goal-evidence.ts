import type { PlayerPlanGoalRow } from './training-db';

type GoalFilters = {
  startDate?: unknown;
  endDate?: unknown;
  pitchTypes?: unknown;
  countOptions?: unknown;
  afterCountOptions?: unknown;
  batterSide?: unknown;
  sessionType?: unknown;
};

type StoredGoal = {
  schema?: unknown;
  category?: unknown;
  stuffType?: unknown;
  movementAxis?: unknown;
  executionStat?: unknown;
  comparator?: unknown;
  targetValue?: unknown;
  filters?: GoalFilters;
};

type PanelContext = {
  sessionType?: unknown;
  tableMode?: unknown;
  pitchTypes?: unknown;
  countFilter?: unknown;
  afterCountFilter?: unknown;
  batterSide?: unknown;
};

type ComparisonRow = {
  group?: unknown;
  metric?: unknown;
  current?: unknown;
  currentAverage?: unknown;
  referenceAverage?: unknown;
  difference?: unknown;
  currentSampleSize?: unknown;
  referenceSampleSize?: unknown;
};

type EvidencePanel = {
  title?: unknown;
  panelType?: unknown;
  context?: PanelContext;
  comparisons?: unknown;
};

export type PlayerGoalReportEvidence = {
  slotIndex: number;
  category: string;
  metric: string;
  comparator: 'Greater Than' | 'Less Than';
  targetValue: number;
  filters: {
    pitchTypes: string[];
    countOptions: string[];
    afterCountOptions: string[];
    batterSide: string;
    sessionType: string;
  };
  comparisons: Array<{
    panel: string;
    group: string;
    current: number;
    reference: number;
    difference: number;
    trend: 'improved' | 'regressed' | 'stable';
    targetMet: boolean;
    currentSampleSize: number | null;
    referenceSampleSize: number | null;
  }>;
};

function token(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return values.map((entry) => String(entry ?? '').trim()).filter((entry) => entry && entry.toLowerCase() !== 'all');
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function canonicalReportMetric(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const compact = token(raw);
  if (!compact) return '';
  if (/\bqp\s*\+/.test(raw)) return 'qpplus';
  if (/\bstuff\s*\+/.test(raw)) return 'stuffplus';
  if (/\b(?:ctrl|control)\s*\+/.test(raw)) return 'ctrlplus';
  if (/\bqp\s*%/.test(raw)) return 'qppct';
  if (/\bk\s*%/.test(raw)) return 'kpct';
  if (/\bbb\s*%/.test(raw)) return 'bbpct';

  const aliases: Record<string, string> = {
    velo: 'velocity', velocity: 'velocity', relspeed: 'velocity', averagevelocity: 'velocity', avgvelocity: 'velocity',
    max: 'maxvelocity', maxvelo: 'maxvelocity', maxvelocity: 'maxvelocity',
    ivb: 'ivb', inducedverticalbreak: 'ivb', hb: 'hb', horizontalbreak: 'hb',
    spin: 'spinrate', spinrate: 'spinrate', rpm: 'spinrate',
    height: 'releaseheight', releaseheight: 'releaseheight',
    side: 'releaseside', releaseside: 'releaseside',
    ext: 'extension', extension: 'extension',
    fps: 'fpspct', fpspct: 'fpspct', firstpitchstrike: 'fpspct', firstpitchstrikepct: 'fpspct',
    inzone: 'inzonepct', inzonepct: 'inzonepct', zone: 'inzonepct', zonepct: 'inzonepct',
    strike: 'strikepct', strikepct: 'strikepct', strikerate: 'strikepct',
    whiff: 'whiffpct', whiffpct: 'whiffpct', whiffrate: 'whiffpct',
    csw: 'cswpct', cswpct: 'cswpct', calledstrikeswhiffpct: 'cswpct',
    swing: 'swingpct', swingpct: 'swingpct', swingrate: 'swingpct',
    chase: 'chasepct', chasepct: 'chasepct', chaserate: 'chasepct',
    calleds: 'calledstrikepct', calledspct: 'calledstrikepct', calledstrikepct: 'calledstrikepct', calledstrikerate: 'calledstrikepct',
    take: 'takepct', takepct: 'takepct', takerate: 'takepct',
    early: 'earlypct', earlypct: 'earlypct', ahead: 'aheadpct', aheadpct: 'aheadpct',
    ea: 'eapct', eapct: 'eapct', '11w': '11wpct', '11wpct': '11wpct',
    comp: 'comppct', comppct: 'comppct', competitivepct: 'comppct',
    gb: 'gbpct', gbpct: 'gbpct', groundballrate: 'gbpct',
    barrel: 'barrelpct', barrelpct: 'barrelpct', barrelrate: 'barrelpct',
    hardhit: 'hardhitpct', hardhitpct: 'hardhitpct', hardhitrate: 'hardhitpct',
    ev: 'exitvelocity', exitspeed: 'exitvelocity', exitvelocity: 'exitvelocity',
    la: 'launchangle', launchangle: 'launchangle',
    k: 'k', kpct: 'kpct', bb: 'bb', bbpct: 'bbpct', whiffs: 'whiffs',
    p: 'pitches', pitches: 'pitches', bf: 'battersfaced', battersfaced: 'battersfaced', pa: 'plateappearances', plateappearances: 'plateappearances',
    rv100: 'rv100', runvalue: 'rv100', runvalues: 'rv100', pv100: 'pv100', pitchvalue: 'pv100',
    avg: 'avg', slg: 'slg', obp: 'obp', ops: 'ops', woba: 'woba', xwoba: 'xwoba',
    iso: 'iso', xiso: 'xiso', babip: 'babip',
    exchangetime: 'exchangetime', poptime: 'poptime', throwvelo: 'throwvelocity', throwvelocity: 'throwvelocity',
  };
  return aliases[compact] ?? compact;
}

const BULLPEN_INAPPLICABLE_METRICS = new Set([
  'whiffpct', 'cswpct', 'swingpct', 'chasepct', 'calledstrikepct', 'takepct',
  'gbpct', 'barrelpct', 'hardhitpct', 'k', 'kpct', 'bb', 'bbpct', 'whiffs',
  'battersfaced', 'plateappearances', 'avg', 'slg', 'obp', 'ops', 'woba',
  'xwoba', 'iso', 'xiso', 'babip', 'exitvelocity', 'launchangle', 'rv100', 'pv100',
]);

function isBullpenContext(context: PanelContext | undefined, reportType: string, title: string): boolean {
  return /bullpen|\bbp\b/i.test(`${String(context?.sessionType ?? '')} ${String(context?.tableMode ?? '')} ${reportType} ${title}`);
}

function metricForGoal(goal: StoredGoal): string {
  if (String(goal.category ?? '') === 'Stuff') {
    if (String(goal.stuffType ?? '') === 'Velocity') return 'Velocity';
    if (String(goal.stuffType ?? '') === 'Movement') return String(goal.movementAxis ?? '');
    return '';
  }
  return String(goal.executionStat ?? '').trim();
}

function categoryMatchesReport(category: string, reportType: string): boolean {
  const domain = reportType.trim().toLowerCase();
  if (category === 'Stuff') return domain.includes('pitching');
  if (category === 'Hitting Stats') return domain.includes('hitting');
  if (category === 'Execution' || category === 'Command') return domain.includes('pitching') || domain.includes('catching');
  return false;
}

function overlapsReport(filters: GoalFilters | undefined, reportStart: string, reportEnd: string): boolean {
  const start = String(filters?.startDate ?? '').trim();
  const end = String(filters?.endDate ?? '').trim();
  if (start && reportEnd && start > reportEnd) return false;
  if (end && reportStart && end < reportStart) return false;
  return true;
}

function scopedComparisonApplies(goal: StoredGoal, context: PanelContext | undefined, group: string): boolean {
  const filters = goal.filters;
  const groupToken = token(group);
  const pitchTypes = list(filters?.pitchTypes);
  if (pitchTypes.length) {
    const requested = list(context?.pitchTypes);
    const groupMatches = pitchTypes.some((value) => token(value) === groupToken);
    const requestMatches = requested.length === 1 && pitchTypes.some((value) => token(value) === token(requested[0]));
    if (!groupMatches && !requestMatches) return false;
  }

  const countOptions = list(filters?.countOptions);
  if (countOptions.length) {
    const requested = list(context?.countFilter);
    const groupMatches = countOptions.some((value) => token(value) === groupToken);
    const requestMatches = requested.length > 0 && requested.every((value) => countOptions.some((goalValue) => token(goalValue) === token(value)));
    if (!groupMatches && !requestMatches) return false;
  }

  const afterCountOptions = list(filters?.afterCountOptions);
  if (afterCountOptions.length) {
    const requested = list(context?.afterCountFilter);
    const groupMatches = afterCountOptions.some((value) => token(value) === groupToken);
    const requestMatches = requested.length > 0 && requested.every((value) => afterCountOptions.some((goalValue) => token(goalValue) === token(value)));
    if (!groupMatches && !requestMatches) return false;
  }

  const batterSide = String(filters?.batterSide ?? '').trim();
  if (batterSide && batterSide.toLowerCase() !== 'all') {
    const requested = String(context?.batterSide ?? '').trim();
    if (token(requested) !== token(batterSide) && groupToken !== token(batterSide)) return false;
  }

  const sessionType = String(filters?.sessionType ?? '').trim();
  if (sessionType && !['all', 'season'].includes(sessionType.toLowerCase())) {
    const requested = String(context?.sessionType ?? '').trim();
    if (token(requested) !== token(sessionType) && groupToken !== token(sessionType)) return false;
  }
  return true;
}

export function buildPlayerGoalReportEvidence(input: {
  goals: PlayerPlanGoalRow[];
  reportType: string;
  title: string;
  reportStart: string;
  reportEnd: string;
  allowedMetrics: string[];
  panels: unknown;
}): PlayerGoalReportEvidence[] {
  const allowed = new Set(input.allowedMetrics.map(canonicalReportMetric).filter(Boolean));
  const panels = Array.isArray(input.panels) ? (input.panels as EvidencePanel[]) : [];
  const result: PlayerGoalReportEvidence[] = [];

  for (const row of input.goals) {
    let goal: StoredGoal;
    try {
      goal = JSON.parse(String(row.goalDescription ?? '')) as StoredGoal;
    } catch {
      continue;
    }
    if (goal.schema !== 'pcu_goal_v2') continue;
    const category = String(goal.category ?? row.category ?? '').trim();
    if (!categoryMatchesReport(category, input.reportType)) continue;
    const metric = metricForGoal(goal);
    const metricKey = canonicalReportMetric(metric);
    const targetValue = finite(goal.targetValue);
    if (!metricKey || targetValue === null || !allowed.has(metricKey)) continue;
    if (!overlapsReport(goal.filters, input.reportStart, input.reportEnd)) continue;

    const comparator: 'Greater Than' | 'Less Than' = goal.comparator === 'Less Than' ? 'Less Than' : 'Greater Than';
    const comparisons: PlayerGoalReportEvidence['comparisons'] = [];
    for (const panel of panels) {
      if (isBullpenContext(panel.context, input.reportType, input.title) && BULLPEN_INAPPLICABLE_METRICS.has(metricKey)) continue;
      const rows = Array.isArray(panel.comparisons) ? (panel.comparisons as ComparisonRow[]) : [];
      for (const comparison of rows) {
        if (canonicalReportMetric(comparison.metric) !== metricKey) continue;
        const group = String(comparison.group ?? 'All').trim() || 'All';
        if (!scopedComparisonApplies(goal, panel.context, group)) continue;
        const current = finite(comparison.current ?? comparison.currentAverage);
        const reference = finite(comparison.referenceAverage);
        if (current === null || reference === null) continue;
        const difference = current - reference;
        const towardGoal = comparator === 'Less Than' ? -difference : difference;
        comparisons.push({
          panel: String(panel.title ?? panel.panelType ?? 'Report panel'),
          group,
          current,
          reference,
          difference: Number(difference.toFixed(3)),
          trend: Math.abs(difference) < 0.0005 ? 'stable' : towardGoal > 0 ? 'improved' : 'regressed',
          targetMet: comparator === 'Less Than' ? current < targetValue : current > targetValue,
          currentSampleSize: finite(comparison.currentSampleSize),
          referenceSampleSize: finite(comparison.referenceSampleSize),
        });
      }
    }
    if (!comparisons.length) continue;
    comparisons.sort((a, b) => Number(b.group === 'All') - Number(a.group === 'All'));
    result.push({
      slotIndex: row.slotIndex,
      category,
      metric,
      comparator,
      targetValue,
      filters: {
        pitchTypes: list(goal.filters?.pitchTypes),
        countOptions: list(goal.filters?.countOptions),
        afterCountOptions: list(goal.filters?.afterCountOptions),
        batterSide: String(goal.filters?.batterSide ?? 'All') || 'All',
        sessionType: String(goal.filters?.sessionType ?? 'Season') || 'Season',
      },
      comparisons: comparisons.slice(0, 4),
    });
  }
  return result.slice(0, 3);
}
