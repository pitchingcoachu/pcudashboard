import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import { listPlayerSummariesByOrganization } from '../../../../lib/training-db';
import { listReportAutomations } from '../../../../lib/report-automations-db';
import { buildAutomationRenderContext } from '../../../../lib/report-automation-render-context';

export async function GET(request:Request) {
  const session = getSessionFromRequest(request,await cookies());
  if (!session) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (session.role !== 'admin' && session.role !== 'coach') return NextResponse.json({error:'Forbidden'},{status:403});
  const organizationId = await resolvePlayerContentOrganizationId(session);
  const params = new URL(request.url).searchParams;
  const automation = (await listReportAutomations(organizationId)).find((item) => item.id === Number(params.get('automationId')));
  if (!automation) return NextResponse.json({error:'Automation not found.'},{status:404});
  const playerId = Number(params.get('playerId'));
  const player = (await listPlayerSummariesByOrganization({organizationId,assignedCoachUserId:null})).find((item) => item.playerId === playerId);
  if (!player) return NextResponse.json({error:'Player not found.'},{status:404});
  const reportDate = String(params.get('reportDate') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return NextResponse.json({error:'Valid report date is required.'},{status:400});
  const context = await buildAutomationRenderContext({automation,dashboardSchoolCode:String(session.dashboardSchoolCode ?? '').toUpperCase(),playerName:player.fullName,reportDate});
  if (!context) return NextResponse.json({error:'The saved custom-report template could not be identified. Open the report and save this automation again.'},{status:404});
  return NextResponse.json(context);
}
