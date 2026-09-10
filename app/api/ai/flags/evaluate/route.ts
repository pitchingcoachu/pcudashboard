import { NextResponse } from 'next/server';
import { requireAiAccess } from '../../../../../lib/ai-access';
import { claimFlagNotification, listFlagRules } from '../../../../../lib/ai-workspace-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import { evaluateFlagRules } from '../../../../../lib/flag-evaluation';
import { loadFlagMetricPoints } from '../../../../../lib/flag-metric-data';
import { createNotificationsForUsers } from '../../../../../lib/training-db';
import { sendPushNotificationToUsers } from '../../../../../lib/push-notifications';

export const maxDuration = 300;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const access = await requireAiAccess(request, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rules = await listFlagRules(access.organizationId);
  const enabledRules = rules.filter((rule) => rule.enabled);
  if (!enabledRules.length) return NextResponse.json({ results: [], rules });

  const maxDays = Math.max(...enabledRules.map((rule) => rule.baselineDays), 7);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - maxDays);
  const end = new Date();
  const schoolCode = resolveDashboardSchoolCode({
    userId: access.session.userId ?? 0,
    email: access.session.email,
    name: access.session.name,
    role: access.role === 'player' ? 'player' : access.role === 'coach' ? 'coach' : 'admin',
    organizationId: access.session.organizationId ?? access.organizationId,
    playerId: access.session.playerId ?? null,
    dashboardSchoolCode: access.session.dashboardSchoolCode ?? null,
    appUrl: access.session.appUrl,
    apps: access.session.apps,
  });

  try {
    const domains = Array.from(new Set(enabledRules.map((rule) => rule.domain)));
    const points = await loadFlagMetricPoints({ schoolCode, startDate: ymd(start), endDate: ymd(end), domains });
    const results = evaluateFlagRules(rules, points);

    await Promise.all(results.filter((result) => result.triggered).map(async (result) => {
      const rule = rules.find((candidate) => candidate.id === result.ruleId);
      const change = result.change;
      const changePercent = result.changePercent;
      if (!rule?.notificationsEnabled || !rule.createdByUserId || change === null || changePercent === null) return;
      if (!(await claimFlagNotification(rule.id, result.player, result.sessionDate))) return;
      const direction = change >= 0 ? 'increased' : 'decreased';
      const detail = `${result.player}: ${result.metric.replaceAll('_', ' ')} ${direction} by ${Math.abs(change).toFixed(2)} (${Math.abs(changePercent).toFixed(1)}%) versus the ${rule.baselineDays}-day session baseline.`;
      await createNotificationsForUsers({ recipientUserIds: [rule.createdByUserId], eventType: 'metric_flag', title: `Flag: ${rule.name}`, detail, path: '/portal/dashboard?suite=flags', playerName: result.player });
      await sendPushNotificationToUsers({ userIds: [rule.createdByUserId], title: `Flag: ${rule.name}`, body: detail, data: { path: '/portal/dashboard?suite=flags' } });
    }));

    return NextResponse.json({ results, rules, generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not evaluate flags.' }, { status: 500 });
  }
}
