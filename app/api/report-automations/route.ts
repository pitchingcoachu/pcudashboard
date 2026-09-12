import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../lib/player-content-scope';
import { deleteReportAutomation, listAutomationRuns, listReportAutomations, saveReportAutomation, type ReportAutomationDateMode, type ReportAutomationPanel } from '../../../lib/report-automations-db';

async function staffScope(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return { ok:false as const, status:401, error:'Unauthorized' };
  if (session.role !== 'admin' && session.role !== 'coach') return { ok:false as const, status:403, error:'Only coaches and admins can manage report automations.' };
  const organizationId = await resolvePlayerContentOrganizationId(session);
  if (organizationId <= 0) return { ok:false as const, status:403, error:'No organization found.' };
  return { ok:true as const, session, organizationId };
}

export async function GET(request: Request) {
  const scope = await staffScope(request);
  if (!scope.ok) return NextResponse.json({ error:scope.error }, { status:scope.status });
  const automationId = Number(new URL(request.url).searchParams.get('automationId') ?? 0);
  try {
    const [automations, runs] = await Promise.all([listReportAutomations(scope.organizationId), listAutomationRuns(scope.organizationId, automationId || undefined)]);
    return NextResponse.json({ automations, runs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load report automations.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const scope = await staffScope(request);
  if (!scope.ok) return NextResponse.json({ error:scope.error }, { status:scope.status });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const title = String(body.reportTitle ?? '').trim();
  const localTime = /^\d{2}:\d{2}$/.test(String(body.localTime ?? '')) ? String(body.localTime) : '17:00';
  const timeZone = String(body.timeZone ?? '').trim() || 'America/Phoenix';
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); } catch { return NextResponse.json({ error:'Invalid timezone.' }, { status:400 }); }
  if (!title) return NextResponse.json({ error:'Report title is required.' }, { status:400 });
  const profileCategory = String(body.profileCategory ?? 'Reports').trim();
  if (!profileCategory || profileCategory.length > 80) return NextResponse.json({error:'Profile category must be between 1 and 80 characters.'},{status:400});
  if (!scope.session.userId) return NextResponse.json({ error:'Your staff account must be linked before creating automations.' }, { status:403 });
  const reportPanels = (Array.isArray(body.reportPanels) ? body.reportPanels : []).flatMap((value):ReportAutomationPanel[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const panel = value as Record<string,unknown>;
    const requestUrl = String(panel.requestUrl ?? '').trim();
    if (!requestUrl.startsWith('/api/')) return [];
    const requestedMode = String(panel.dateMode ?? 'automation_day');
    const dateMode:ReportAutomationDateMode = ['fixed','rolling_days','month_to_date','previous_month_to_date','previous_month'].includes(requestedMode) ? requestedMode as ReportAutomationDateMode : 'automation_day';
    return [{ id:String(panel.id??'').slice(0,100),title:String(panel.title??'Report panel').slice(0,180),requestUrl:requestUrl.slice(0,4000),dateMode,fixedStart:String(panel.fixedStart??'').slice(0,10),fixedEnd:String(panel.fixedEnd??'').slice(0,10),rollingDays:Math.max(1,Math.min(365,Number(panel.rollingDays)||30)) }];
  }).slice(0,36);
  if (reportPanels.some((panel) => panel.dateMode === 'fixed' && (!/^\d{4}-\d{2}-\d{2}$/.test(panel.fixedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(panel.fixedEnd) || panel.fixedStart > panel.fixedEnd))) {
    return NextResponse.json({error:'Each fixed panel range needs a valid start and end date.'},{status:400});
  }
  try {
    const automation = await saveReportAutomation({
      id: Number(body.id) || undefined,
      organizationId: scope.organizationId,
      createdByUserId: scope.session.userId,
      reportKey: String(body.reportKey ?? 'report').trim() || 'report', reportTitle:title,
      sourcePath:String(body.sourcePath ?? '').slice(0,1000), customReportId:Number(body.customReportId) > 0 ? Number(body.customReportId) : null, profileCategory,
      cadence:body.cadence === 'weekly' ? 'weekly' : 'daily',
      weekdays:Array.isArray(body.weekdays) ? body.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [0,1,2,3,4,5,6],
      localTime, timeZone, playerScope:body.playerScope === 'selected' ? 'selected' : 'all',
      playerIds:Array.isArray(body.playerIds) ? body.playerIds.map(Number).filter((id) => id > 0) : [],
      reportPanels,
      onlyWhenData:body.onlyWhenData !== false, includeAiSummary:body.includeAiSummary === true, notifyPlayers:body.notifyPlayers !== false, active:body.active !== false,
    });
    return NextResponse.json({ ok:true, automation });
  } catch (error) {
    console.error('Unable to save report automation.', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save automation.' }, { status:500 });
  }
}

export async function DELETE(request: Request) {
  const scope = await staffScope(request);
  if (!scope.ok) return NextResponse.json({ error:scope.error }, { status:scope.status });
  const id = Number(new URL(request.url).searchParams.get('id') ?? 0);
  if (id <= 0) return NextResponse.json({ error:'Automation id is required.' }, { status:400 });
  return NextResponse.json({ ok:await deleteReportAutomation(scope.organizationId, id) });
}
