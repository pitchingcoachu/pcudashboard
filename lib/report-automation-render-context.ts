import { getDbPool } from './auth-db';
import type { ReportAutomationPanel, ReportAutomationRow } from './report-automations-db';

type ReportCell = Record<string, unknown> & { title?:unknown; panelType?:unknown; filterSelect?:unknown; dateStart?:unknown; dateEnd?:unknown; player?:unknown };
type CustomReportPayload = Record<string, unknown> & { cells?:Record<string,ReportCell> };

export function formatAutomationReportDate(reportDate:string):string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate.trim());
  if (!match) return '';
  const [,year,month,day] = match;
  return `${Number(month)}/${Number(day)}/${year.slice(-2)}`;
}

function isoDate(year:number,monthIndex:number,day:number):string {
  return `${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function dateParts(value:string):{year:number;monthIndex:number;day:number} {
  const [year,month,day] = value.split('-').map(Number);
  return {year,monthIndex:month-1,day};
}
function shiftIsoDate(value:string,days:number):string {
  const {year,monthIndex,day} = dateParts(value);
  const shifted = new Date(Date.UTC(year,monthIndex,day+days));
  return isoDate(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate());
}
export function resolvePanelDateRange(panel:ReportAutomationPanel,reportDate:string):{startDate:string;endDate:string} {
  const {year,monthIndex,day} = dateParts(reportDate);
  if (panel.dateMode === 'fixed' && panel.fixedStart && panel.fixedEnd) return {startDate:panel.fixedStart,endDate:panel.fixedEnd};
  if (panel.dateMode === 'rolling_days') return {startDate:shiftIsoDate(reportDate,-Math.max(1,panel.rollingDays)+1),endDate:reportDate};
  if (panel.dateMode === 'month_to_date') return {startDate:isoDate(year,monthIndex,1),endDate:reportDate};
  if (panel.dateMode === 'previous_month' || panel.dateMode === 'previous_month_to_date') {
    const previousEnd = new Date(Date.UTC(year,monthIndex,0));
    const previousYear = previousEnd.getUTCFullYear();
    const previousMonth = previousEnd.getUTCMonth();
    const endDay = panel.dateMode === 'previous_month' ? previousEnd.getUTCDate() : Math.min(day,previousEnd.getUTCDate());
    return {startDate:isoDate(previousYear,previousMonth,1),endDate:isoDate(previousYear,previousMonth,endDay)};
  }
  return {startDate:reportDate,endDate:reportDate};
}

function templateScore(payload:CustomReportPayload, automation:ReportAutomationRow):number {
  const cells = payload.cells && typeof payload.cells === 'object' ? payload.cells : {};
  let score = 0;
  for (const panel of automation.reportPanels) {
    const cell = cells[panel.id];
    if (cell) score += 8;
    const title = String(cell?.title ?? cell?.panelType ?? '').trim().toLowerCase();
    if (title && title === panel.title.trim().toLowerCase()) score += 4;
  }
  if (String(payload.title ?? '').trim().toLowerCase() === automation.reportTitle.trim().toLowerCase()) score += 3;
  return score;
}

export async function resolveAutomationCustomReport(
  automation:ReportAutomationRow,
  dashboardSchoolCode:string,
):Promise<{id:number;payload:CustomReportPayload}|null> {
  const result = await getDbPool().query<{id:number;payload_json:unknown}>(
    `SELECT id,payload_json
       FROM dashboard_custom_reports
      WHERE ($1::bigint IS NOT NULL AND id=$1)
         OR organization_id=$2
         OR visibility='global'
         OR school_code=$3
      ORDER BY updated_at DESC,id DESC`,
    [automation.customReportId,automation.organizationId,dashboardSchoolCode],
  );
  const candidates = result.rows.flatMap((row) => {
    if (!row.payload_json || typeof row.payload_json !== 'object' || Array.isArray(row.payload_json)) return [];
    return [{id:Number(row.id),payload:row.payload_json as CustomReportPayload}];
  });
  if (automation.customReportId) return candidates.find((item) => item.id === automation.customReportId) ?? null;
  const ranked = candidates.map((item) => ({...item,score:templateScore(item.payload,automation)})).sort((a,b) => b.score-a.score);
  return ranked[0] && ranked[0].score >= Math.max(8,automation.reportPanels.length*6) ? ranked[0] : null;
}

export async function buildAutomationRenderContext(args:{
  automation:ReportAutomationRow;
  dashboardSchoolCode:string;
  playerName:string;
  reportDate:string;
}):Promise<{templateId:number;payload:CustomReportPayload}|null> {
  const resolved = await resolveAutomationCustomReport(args.automation,args.dashboardSchoolCode);
  if (!resolved) return null;
  const payload = structuredClone(resolved.payload);
  const ranges = new Map(args.automation.reportPanels.map((panel) => [panel.id,resolvePanelDateRange(panel,args.reportDate)]));
  const allRanges = Array.from(ranges.values());
  const reportStart = allRanges.map((range) => range.startDate).sort()[0] ?? args.reportDate;
  const reportEnd = allRanges.map((range) => range.endDate).sort().at(-1) ?? args.reportDate;
  payload.title = args.automation.reportTitle;
  if (!String(payload.subtitle ?? '').trim()) payload.subtitle = formatAutomationReportDate(args.reportDate);
  payload.scope = 'Single Player';
  payload.players = [args.playerName];
  payload.rowPlayers = [args.playerName];
  payload.teamScopePlayers = [];
  payload.useGlobalDates = false;
  payload.globalStartDate = reportStart;
  payload.globalEndDate = reportEnd;
  payload.showAiSummary = args.automation.includeAiSummary;
  const cells = payload.cells && typeof payload.cells === 'object' ? payload.cells : {};
  for (const [cellId,rawCell] of Object.entries(cells)) {
    if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) continue;
    const range = ranges.get(cellId) ?? {startDate:args.reportDate,endDate:args.reportDate};
    const filterSelect = Array.isArray(rawCell.filterSelect) ? rawCell.filterSelect.map(String) : [];
    rawCell.player = args.playerName;
    rawCell.dateStart = range.startDate;
    rawCell.dateEnd = range.endDate;
    rawCell.filterSelect = filterSelect.includes('Dates') ? filterSelect : ['Dates',...filterSelect];
  }
  payload.cells = cells;
  return {templateId:resolved.id,payload};
}
