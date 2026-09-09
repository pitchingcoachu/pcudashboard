import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../lib/ai-access';
import { generateReportNarrative } from '../../../../lib/ai-generation';
import { resolveSchoolScopedOrganizationId } from '../../../../lib/programming-scope';
import { buildPlayerGoalReportEvidence } from '../../../../lib/report-goal-evidence';
import { listPlayerProfilesWithPlanGoals } from '../../../../lib/training-db';

export const maxDuration = 120;

function playerNameKeys(value: unknown): Set<string> {
  const raw = String(value ?? '').trim();
  if (!raw) return new Set();
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const keys = new Set<string>([normalize(raw)]);
  if (raw.includes(',')) {
    const [last, ...rest] = raw.split(',');
    const first = rest.join(' ').trim();
    if (first && last.trim()) keys.add(normalize(`${first} ${last}`));
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) keys.add(normalize(`${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`));
  }
  return keys;
}

function namesMatch(left: unknown, right: unknown): boolean {
  const leftKeys = playerNameKeys(left);
  return Array.from(playerNameKeys(right)).some((key) => leftKeys.has(key));
}

export async function POST(request: Request) {
  const access = await requireAiAccess(request, false, false);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Report data is required.' }, { status: 400 });
  }
  const allowedMetrics = Array.isArray(body.allowedMetrics)
    ? body.allowedMetrics.map(String).map((value) => value.trim()).filter(Boolean)
    : [];
  if (!allowedMetrics.length) {
    return NextResponse.json({ error: 'Visible report metrics are required.' }, { status: 400 });
  }

  const reportType = String(body.reportType ?? 'Performance report');
  const title = String(body.title ?? '');
  const reportStart = String(body.reportStart ?? '');
  const reportEnd = String(body.reportEnd ?? '');
  const playerName = String(body.playerName ?? '').trim();
  const data = { ...(body.data as Record<string, unknown>) };

  // Goal context is best-effort: summary generation should still work when a
  // profile is missing or the selected dashboard name cannot be matched.
  if (playerName && playerName.toLowerCase() !== 'all') {
    try {
      const organizationId = Number(resolveSchoolScopedOrganizationId(access.session)) || access.organizationId;
      if (organizationId > 0) {
        const profiles = await listPlayerProfilesWithPlanGoals({
          organizationId,
          assignedCoachUserId: access.role === 'coach' ? access.userId : null,
        });
        const profile = profiles.find((candidate) => {
          if (access.role === 'player' && access.playerId && candidate.playerId !== access.playerId) return false;
          return namesMatch(candidate.fullName, playerName);
        });
        if (profile) {
          const playerGoalEvidence = buildPlayerGoalReportEvidence({
            goals: profile.goals,
            reportType,
            title,
            reportStart,
            reportEnd,
            allowedMetrics,
            panels: data.panels,
          });
          if (playerGoalEvidence.length) data.playerGoalEvidence = playerGoalEvidence;
        }
      }
    } catch (error) {
      console.warn('[ai-report-summary] player goal lookup skipped', error);
    }
  }

  try {
    const summary = await generateReportNarrative({
      reportType,
      title,
      reportStart,
      reportEnd,
      comparisonStart: String(body.comparisonStart ?? ''),
      comparisonEnd: String(body.comparisonEnd ?? ''),
      allowedMetrics,
      data,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not generate summary.' },
      { status: 500 }
    );
  }
}
