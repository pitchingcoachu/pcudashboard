import { NextResponse } from 'next/server';
import { listDueReportAutomations } from '../../../../lib/report-automations-db';
import { executeReportAutomation } from '../../../../lib/report-automation-runner';

export const maxDuration = 800;

function authorized(request: Request): boolean {
  const secret = String(process.env.CRON_SECRET ?? '').trim();
  const custom = String(process.env.REPORT_AUTOMATIONS_CRON_KEY ?? '').trim();
  const bearer = String(request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i,'').trim();
  const header = String(request.headers.get('x-cron-key') ?? '').trim();
  return Boolean((secret && bearer === secret) || (custom && (bearer === custom || header === custom)));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({error:'Unauthorized'}, {status:401});
  const automations = await listDueReportAutomations(new Date());
  const origin = new URL(request.url).origin;
  const results = [];
  for (const automation of automations) results.push({ automationId:automation.id, ...(await executeReportAutomation(automation, origin)) });
  return NextResponse.json({ok:true, due:automations.length, results});
}
