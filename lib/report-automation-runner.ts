import { createSessionToken } from './auth';
import { getDbPool } from './auth-db';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadPlayerMediaToR2 } from './biomechanics-storage';
import { sendPushNotificationToUsers } from './push-notifications';
import { claimAutomationRun, finishAutomationRun, type ReportAutomationPanel, type ReportAutomationRow } from './report-automations-db';
import { buildAutomationRenderContext, resolvePanelDateRange } from './report-automation-render-context';
import { createPlayerMedia, getPlayerNotificationContext, listPlayerSummariesByOrganization, notifyPlayerForStaffActivity } from './training-db';

function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const get = (type:string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90) || 'report';
}

function reportDomain(automation: ReportAutomationRow): 'pitching' | 'hitting' | 'catching' {
  const key = `${automation.reportKey} ${automation.reportTitle} ${automation.sourcePath}`.toLowerCase();
  if (key.includes('hitting') || key.includes('hitter')) return 'hitting';
  if (key.includes('catching') || key.includes('catcher')) return 'catching';
  return 'pitching';
}

function reportQuery(automation: ReportAutomationRow, playerName: string, date: string): URLSearchParams {
  const domain = reportDomain(automation);
  const params = new URLSearchParams({ start_date:date, end_date:date, include_chart_points:'0' });
  params.set(domain === 'hitting' ? 'hitter' : domain === 'catching' ? 'catcher' : 'pitcher', playerName);
  const label = `${automation.reportKey} ${automation.reportTitle}`.toLowerCase();
  if (label.includes('bullpen')) params.set('session_type', 'Bullpen');
  if (label.includes('leaderboard')) params.set('split_by', domain === 'hitting' ? 'Batter' : domain === 'catching' ? 'Catcher' : 'Pitcher');
  else params.set('split_by', 'Pitch Types');
  if (domain === 'pitching') params.set('table_mode', label.includes('bullpen') ? 'Bullpen' : 'Stats');
  else if (domain === 'hitting') params.set('table_mode', 'Results');
  else params.set('table_mode', 'Catching Data');
  return params;
}

async function automationSession(automation: ReportAutomationRow) {
  if (!automation.createdByUserId) throw new Error('Automation owner is no longer available.');
  const user = automation.createdByUserId
    ? (await getDbPool().query<{email:string;name:string|null;role:string;app_url:string}>(`SELECT email,name,role,app_url FROM auth_users WHERE id=$1 AND is_active=TRUE`, [automation.createdByUserId])).rows[0]
    : null;
  const orgMap = (() => { try { return JSON.parse(process.env.DASHBOARD_ORG_SCHOOL_MAP ?? '{}') as Record<string,string>; } catch { return {}; } })();
  const dashboardSchoolCode = String(orgMap[String(automation.organizationId)] ?? process.env.DASHBOARD_DEFAULT_SCHOOL_CODE ?? 'OSU').toUpperCase();
  return {
    token:createSessionToken({ userId:automation.createdByUserId ?? undefined, email:user?.email ?? 'report-automation@pitchingcoachu.com', name:user?.name ?? 'Report Automation', role:user?.role === 'coach' ? 'coach' : 'admin', organizationId:automation.organizationId, playerId:null, dashboardSchoolCode, appUrl:user?.app_url ?? 'https://pitchingcoachu.shinyapps.io/TMdata/', apps:[{name:'Dashboard',url:user?.app_url ?? 'https://pitchingcoachu.shinyapps.io/TMdata/'}] }),
    actorName:user?.name ?? 'Report Automation', actorRole:user?.role === 'admin' ? 'admin' as const : 'coach' as const,
    dashboardSchoolCode,
  };
}

async function waitForDownloadedPdf(directory:string,timeoutMs=240_000):Promise<Buffer> {
  const deadline = Date.now()+timeoutMs;
  while (Date.now()<deadline) {
    const files = await readdir(directory).catch(() => []);
    const pdf = files.find((file) => file.toLowerCase().endsWith('.pdf'));
    if (pdf) {
      const first = await readFile(join(directory,pdf));
      await new Promise((resolve) => setTimeout(resolve,250));
      const second = await readFile(join(directory,pdf));
      if (first.length > 0 && first.length === second.length) return second;
    }
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  throw new Error('Timed out while downloading the rendered report PDF.');
}

async function buildRenderedCustomReportPdf(args:{origin:string;token:string;automation:ReportAutomationRow;playerId:number;reportDate:string}):Promise<Buffer> {
  const [{default:puppeteer},{default:chromium}] = await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);
  const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || (existsSync(localChrome) ? localChrome : await chromium.executablePath());
  const downloadDirectory = await mkdtemp(join(tmpdir(),'pcu-automated-report-'));
  const browser = await puppeteer.launch({
    executablePath,
    args:existsSync(localChrome) && executablePath === localChrome ? ['--no-sandbox','--disable-setuid-sandbox'] : chromium.args,
    headless:true,
    defaultViewport:{width:1440,height:1200,deviceScaleFactor:1},
  });
  try {
    const page = await browser.newPage();
    await page.setCookie({name:'pcu_session_v3',value:args.token,url:args.origin,httpOnly:true,sameSite:'Lax'});
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDirectory});
    const url = new URL('/portal/dashboard',args.origin);
    url.searchParams.set('suite','custom-reports');
    url.searchParams.set('automationRender','1');
    url.searchParams.set('automationId',String(args.automation.id));
    url.searchParams.set('playerId',String(args.playerId));
    url.searchParams.set('reportDate',args.reportDate);
    await page.goto(url.toString(),{waitUntil:'networkidle2',timeout:240_000});
    await page.waitForSelector('[data-automation-render-state]',{timeout:120_000});
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-automation-render-state]');
      const state = node?.getAttribute('data-automation-render-state');
      return state === 'ready' || state === 'error';
    },{timeout:300_000});
    const renderState = await page.$eval('[data-automation-render-state]',(node) => node.getAttribute('data-automation-render-state'));
    if (renderState !== 'ready') {
      const detail = await page.$$eval('.portal-error-text,.auth-error',(nodes) => nodes.map((node) => node.textContent?.trim() ?? '')).catch(() => [] as string[]);
      throw new Error(detail.find(Boolean) || 'One or more custom-report panels failed to render.');
    }
    await page.$eval('.report-actions-dropdown > button',(button) => (button as HTMLButtonElement).click());
    await page.waitForSelector('[data-report-download-pdf="true"]',{visible:true,timeout:10_000});
    await page.$eval('[data-report-download-pdf="true"]',(button) => (button as HTMLButtonElement).click());
    return await waitForDownloadedPdf(downloadDirectory);
  } finally {
    await browser.close().catch(() => undefined);
    await rm(downloadDirectory,{recursive:true,force:true}).catch(() => undefined);
  }
}

function rowsFromPayload(payload: Record<string, unknown>, preferredKeys: string[]): {columns:string[];rows:Record<string,unknown>[]} {
  for (const key of preferredKeys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    const rows = value.filter((item):item is Record<string,unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    if (!rows.length) continue;
    return {columns:Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0,20),rows};
  }
  const columns = Array.isArray(payload.table_columns) ? payload.table_columns.map(String) : [];
  const rows = Array.isArray(payload.table_rows) ? payload.table_rows.filter((item):item is Record<string,unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  return {columns,rows};
}

type ResolvedReportPanel = { title:string; startDate:string; endDate:string; columns:string[]; rows:Record<string,unknown>[] };

function setQueryValue(params:URLSearchParams, names:string[], value:string, fallback:string):void {
  const existing = names.filter((name) => params.has(name));
  if (existing.length) existing.forEach((name) => params.set(name,value));
  else params.set(fallback,value);
}

async function fetchConfiguredPanel(
  origin:string,
  token:string,
  automation:ReportAutomationRow,
  panel:ReportAutomationPanel,
  playerId:number,
  playerName:string,
  reportDate:string,
):Promise<ResolvedReportPanel> {
  const url = new URL(panel.requestUrl,origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/')) throw new Error(`Invalid saved request for ${panel.title}.`);
  const range = resolvePanelDateRange(panel,reportDate);
  setQueryValue(url.searchParams,['start_date','startDate','start'],range.startDate,'start_date');
  setQueryValue(url.searchParams,['end_date','endDate','end'],range.endDate,'end_date');
  const domain = reportDomain(automation);
  const playerParams = ['pitcher','pitcherName','hitter','hitterName','catcher','catcherName'];
  const existingPlayerParams = playerParams.filter((name) => url.searchParams.has(name));
  if (existingPlayerParams.length) existingPlayerParams.forEach((name) => url.searchParams.set(name,playerName));
  else url.searchParams.set(domain === 'hitting' ? 'hitter' : domain === 'catching' ? 'catcher' : 'pitcher',playerName);
  if (url.searchParams.has('playerId')) url.searchParams.set('playerId',String(playerId));
  const response = await fetch(url,{headers:{cookie:`pcu_session_v3=${token}`},cache:'no-store',signal:AbortSignal.timeout(240_000)});
  const payload = await response.json().catch(() => ({})) as Record<string,unknown> & {error?:string};
  if (!response.ok) throw new Error(payload.error ?? `${panel.title} request failed (${response.status}).`);
  const data = rowsFromPayload(payload,['chart_points','stats','dailyEvents','workload','events']);
  return {title:panel.title,startDate:range.startDate,endDate:range.endDate,...data};
}

async function fetchReportData(origin: string, token: string, automation: ReportAutomationRow, playerId: number, playerName: string, date: string) {
  const domain = reportDomain(automation);
  const key = `${automation.reportKey} ${automation.reportTitle}`.toLowerCase();
  const url = new URL(
    key.includes('intended') ? '/api/dashboard/pitching/intended-zone/stats'
      : key.includes('biomechanic') ? '/api/dashboard/biomechanics'
        : key.includes('development') ? '/api/player/plan-goals'
          : key.includes('pulse') ? '/api/admin/pulse'
            : `/api/dashboard/${domain}/overview`,
    origin,
  );
  if (key.includes('intended')) url.search = new URLSearchParams({pitcherName:playerName,startDate:date,endDate:date}).toString();
  else if (key.includes('biomechanic')) url.search = new URLSearchParams({pitcher:playerName,startDate:date,endDate:date}).toString();
  else if (key.includes('development')) url.searchParams.set('playerId', String(playerId));
  else if (key.includes('pulse')) { url.searchParams.set('start',date); url.searchParams.set('end',date); }
  else url.search = reportQuery(automation, playerName, date).toString();
  const response = await fetch(url, { headers:{ cookie:`pcu_session_v3=${token}` }, cache:'no-store', signal:AbortSignal.timeout(240_000) });
  let payload = await response.json().catch(() => ({})) as Record<string,unknown> & {error?:string};
  if (!response.ok) throw new Error(payload.error ?? `Report data request failed (${response.status}).`);
  if (key.includes('pulse')) {
    const match = Array.isArray(payload.players) ? (payload.players as Array<Record<string,unknown>>).find((item) => String(item.playerName??'').toLowerCase() === playerName.toLowerCase()) : null;
    if (!match?.playerKey) return {columns:[],rows:[]};
    if (match.playerKey) {
      url.searchParams.set('player', String(match.playerKey));
      const selectedResponse = await fetch(url, {headers:{cookie:`pcu_session_v3=${token}`},cache:'no-store',signal:AbortSignal.timeout(240_000)});
      payload = await selectedResponse.json().catch(() => ({})) as Record<string,unknown> & {error?:string};
      if (!selectedResponse.ok) throw new Error(payload.error ?? 'PULSE report data request failed.');
    }
  }
  return rowsFromPayload(payload, key.includes('intended') ? ['stats'] : key.includes('development') ? ['goals'] : key.includes('pulse') ? ['dailyEvents','workload','events'] : []);
}

async function generateAiSummary(
  origin: string,
  token: string,
  automation: ReportAutomationRow,
  playerName: string,
  date: string,
  panels: ResolvedReportPanel[],
): Promise<string> {
  const allowedMetrics = Array.from(new Set(panels.flatMap((panel) => panel.columns))).slice(0,80);
  if (!allowedMetrics.length) throw new Error('No visible metrics were available for an AI summary.');
  const response = await fetch(new URL('/api/ai/report-summary', origin), {
    method: 'POST',
    headers: { cookie:`pcu_session_v3=${token}`, 'content-type':'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      reportType: `${reportDomain(automation)} automated report`,
      title: automation.reportTitle,
      playerName,
      reportStart: date,
      reportEnd: date,
      comparisonStart: '',
      comparisonEnd: '',
      allowedMetrics,
      data: {
        panels: panels.map((panel) => ({
          title: panel.title,
          panelType: 'Summary Table',
          context:{startDate:panel.startDate,endDate:panel.endDate},
          allowedMetrics:panel.columns,
          current: { kind:'table', columns:panel.columns, rows:panel.rows.slice(0, 60) },
          comparisons: [],
        })),
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as {summary?:string;error?:string};
  if (!response.ok || !payload.summary?.trim()) throw new Error(payload.error ?? `AI summary request failed (${response.status}).`);
  return payload.summary.trim();
}

async function buildReportPdf(title: string, playerName: string, date: string, panels:ResolvedReportPanel[], aiSummary = ''): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation:'landscape', unit:'pt', format:'letter' });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const rowHeight = 22;
  let y = 0;
  const pageHeader = () => {
    pdf.setFillColor(7, 14, 24); pdf.rect(0, 0, width, height, 'F');
    y = 34;
    pdf.setTextColor(248,250,252); pdf.setFont('helvetica','bold'); pdf.setFontSize(17); pdf.text(title, margin, y);
    pdf.setFontSize(12); pdf.text(playerName, margin, y + 18);
    pdf.setFont('helvetica','normal'); pdf.setTextColor(148,163,184); pdf.setFontSize(10); pdf.text(date, margin, y + 34);
    y += 62;
  };
  const newPage = () => { pdf.addPage('letter','landscape'); pageHeader(); };
  const tableHeader = (columns:string[]) => {
    const colWidth = (width-margin*2)/Math.max(1,columns.length);
    pdf.setFillColor(22,32,47); pdf.setTextColor(226,232,240); pdf.setFont('helvetica','bold'); pdf.setFontSize(8);
    columns.forEach((column,index) => {const x=margin+index*colWidth;pdf.rect(x,y,colWidth,rowHeight,'F');pdf.text(String(column).slice(0,20),x+4,y+14,{maxWidth:colWidth-8});});
    y += rowHeight;
  };
  pageHeader();
  for (const panel of panels) {
    const visibleColumns = panel.columns.slice(0,12);
    const colWidth = (width-margin*2)/Math.max(1,visibleColumns.length);
    if (y+72>height-margin) newPage();
    pdf.setTextColor(248,250,252); pdf.setFont('helvetica','bold'); pdf.setFontSize(12); pdf.text(panel.title || 'Report panel',margin,y); y+=15;
    pdf.setTextColor(148,163,184); pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.text(panel.startDate === panel.endDate ? panel.startDate : `${panel.startDate} to ${panel.endDate}`,margin,y); y+=12;
    if (!visibleColumns.length || !panel.rows.length) {
      pdf.setTextColor(148,163,184); pdf.setFontSize(9); pdf.text('No qualifying data.',margin,y+10); y+=34; continue;
    }
    tableHeader(visibleColumns);
    for (const row of panel.rows) {
      if (y+rowHeight>height-margin) {newPage();pdf.setTextColor(248,250,252);pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text(`${panel.title} (continued)`,margin,y);y+=16;tableHeader(visibleColumns);}
      pdf.setDrawColor(51,65,85);pdf.setTextColor(226,232,240);pdf.setFont('helvetica','normal');pdf.setFontSize(8);
      visibleColumns.forEach((column,index) => {const x=margin+index*colWidth;pdf.rect(x,y,colWidth,rowHeight);const raw=row[column];const value=raw==null?'—':String(raw);pdf.text(value.slice(0,24),x+4,y+14,{maxWidth:colWidth-8});});
      y+=rowHeight;
    }
    y+=18;
  }
  if (aiSummary.trim()) {
    const drawSummaryPage = () => {
      pdf.setFillColor(7, 14, 24); pdf.rect(0, 0, width, height, 'F'); y = margin;
    };
    if (y + 90 > height - margin) { pdf.addPage('letter','landscape'); drawSummaryPage(); }
    else y += 22;
    pdf.setTextColor(200,16,46); pdf.setFont('helvetica','bold'); pdf.setFontSize(9); pdf.text('AI COACH ANALYSIS', margin, y); y += 18;
    pdf.setTextColor(248,250,252); pdf.setFontSize(15); pdf.text('Report Summary', margin, y); y += 22;
    pdf.setFont('helvetica','normal'); pdf.setTextColor(226,232,240); pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(aiSummary.trim(), width - margin * 2) as string[];
    for (const line of lines) {
      if (y + 14 > height - margin) { pdf.addPage('letter','landscape'); drawSummaryPage(); pdf.setFont('helvetica','normal'); pdf.setTextColor(226,232,240); pdf.setFontSize(10); }
      pdf.text(line, margin, y); y += 14;
    }
  }
  return Buffer.from(pdf.output('arraybuffer'));
}

export async function executeReportAutomation(automation: ReportAutomationRow, origin: string, now = new Date(), options:{force?:boolean}={}): Promise<{saved:number;skipped:number;failed:number}> {
  const reportDate = localDate(now, automation.timeZone);
  const allPlayers = await listPlayerSummariesByOrganization({ organizationId:automation.organizationId, assignedCoachUserId:null });
  const selectedSet = new Set(automation.playerIds);
  const players = automation.playerScope === 'selected' ? allPlayers.filter((player) => selectedSet.has(player.playerId)) : allPlayers;
  const session = await automationSession(automation);
  const counts = { saved:0, skipped:0, failed:0 };
  for (const player of players) {
    const runId = await claimAutomationRun(automation.id, player.playerId, reportDate,options.force === true);
    if (!runId) continue;
    try {
      const panels:ResolvedReportPanel[] = automation.reportPanels.length
        ? await Promise.all(automation.reportPanels.map((panel) => fetchConfiguredPanel(origin,session.token,automation,panel,player.playerId,player.fullName,reportDate)))
        : [await fetchReportData(origin, session.token, automation, player.playerId, player.fullName, reportDate).then((data) => ({title:automation.reportTitle,startDate:reportDate,endDate:reportDate,...data}))];
      const meaningfulRows = panels.flatMap((panel) => panel.rows).filter((row) => !Object.values(row).some((value) => String(value??'').trim().toLowerCase() === 'all'));
      if (automation.onlyWhenData && meaningfulRows.length === 0) {
        await finishAutomationRun(runId, 'skipped', 'No qualifying data found for this date.'); counts.skipped += 1; continue;
      }
      let aiSummary = '';
      let aiSummaryError = '';
      const customReportContext = automation.reportKey.includes('custom-report')
        ? await buildAutomationRenderContext({automation,dashboardSchoolCode:session.dashboardSchoolCode,playerName:player.fullName,reportDate})
        : null;
      if (automation.reportKey.includes('custom-report') && !customReportContext) {
        throw new Error('The saved custom-report template could not be identified. Open the report and save this automation again.');
      }
      if (automation.includeAiSummary && !customReportContext) {
        try {
          aiSummary = await generateAiSummary(origin, session.token, automation, player.fullName, reportDate, panels);
        } catch (error) {
          aiSummaryError = error instanceof Error ? error.message : 'AI summary generation failed.';
          console.warn(`[report-automation] saving ${automation.id}/${player.playerId} without AI summary: ${aiSummaryError}`);
        }
      }
      const title = `${automation.reportTitle} - ${player.fullName} - ${reportDate}`;
      const pdfBody = customReportContext
        ? await buildRenderedCustomReportPdf({origin,token:session.token,automation,playerId:player.playerId,reportDate})
        : await buildReportPdf(automation.reportTitle, player.fullName, reportDate, panels, aiSummary);
      const fileName = `${safeFileName(automation.reportTitle)}-${reportDate}.pdf`;
      const r2Key = await uploadPlayerMediaToR2({ organizationId:automation.organizationId, playerId:player.playerId, fileName, contentType:'application/pdf', body:pdfBody });
      if (!r2Key) throw new Error('Could not store the generated PDF.');
      const created = await createPlayerMedia({ organizationId:automation.organizationId, playerId:player.playerId, mediaType:'pdf', title, category:automation.profileCategory, fileName, contentType:'application/pdf', sizeBytes:pdfBody.length, r2Key, sourceType:'automated_report', sourceLabel:automation.reportTitle, createdByUserId:automation.createdByUserId!, processingStatus:'ready' });
      if (!created.ok) throw new Error(created.error);
      if (automation.notifyPlayers) {
        const context = await getPlayerNotificationContext({ organizationId:automation.organizationId, playerId:player.playerId });
        const recipients = await notifyPlayerForStaffActivity({ playerUserId:context?.userId ?? null, eventType:'automated_report_saved', title:'New report available', detail:`${automation.reportTitle} was saved to your profile`, path:`/portal/player?previewPlayerId=${player.playerId}`, actorUserId:automation.createdByUserId, actorName:session.actorName, actorRole:session.actorRole, playerId:player.playerId, playerName:player.fullName }).catch(() => []);
        if (recipients.length) await sendPushNotificationToUsers({ userIds:recipients, title:'New report available', body:`${automation.reportTitle} was saved to your profile`, data:{path:`/portal/player?previewPlayerId=${player.playerId}`} });
      }
      await finishAutomationRun(runId, 'saved', aiSummaryError ? `Report saved without AI summary: ${aiSummaryError}` : 'Report saved to player profile.', created.id); counts.saved += 1;
    } catch (error) {
      await finishAutomationRun(runId, 'failed', error instanceof Error ? error.message : 'Report generation failed.'); counts.failed += 1;
    }
  }
  await getDbPool().query(`UPDATE report_automations SET last_run_at=NOW() WHERE id=$1`, [automation.id]);
  return counts;
}
