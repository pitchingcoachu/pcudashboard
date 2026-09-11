import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../lib/player-content-scope';
import { listReportAutomations } from '../../../../lib/report-automations-db';
import { executeReportAutomation } from '../../../../lib/report-automation-runner';

export const maxDuration = 800;
export async function POST(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({error:'Unauthorized'}, {status:401});
  if (session.role !== 'admin' && session.role !== 'coach') return NextResponse.json({error:'Forbidden'}, {status:403});
  const organizationId = await resolvePlayerContentOrganizationId(session);
  const body = await request.json().catch(() => ({})) as {id?:number};
  const automation = (await listReportAutomations(organizationId)).find((item) => item.id === Number(body.id));
  if (!automation) return NextResponse.json({error:'Automation not found.'}, {status:404});
  const result = await executeReportAutomation(automation, new URL(request.url).origin,new Date(),{force:true});
  return NextResponse.json({ok:true, ...result});
}
