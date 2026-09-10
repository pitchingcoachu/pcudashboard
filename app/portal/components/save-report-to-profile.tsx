'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';
import {
  prepareReportPdfForProfile,
  REPORT_PDF_READY_EVENT,
} from '../../../lib/report-pdf-delivery';

type OrgPlayer = { playerId: number; fullName: string };
type PendingReport = { file: File; title: string; preferredPlayerId: number | null; preferredPlayerName?: string };
type AutomationDateMode = 'automation_day'|'fixed'|'rolling_days'|'month_to_date'|'previous_month_to_date'|'previous_month';
export type AutomationPanelSeed = { id:string; title:string; requestUrl:string };
type AutomationPanel = AutomationPanelSeed & { dateMode:AutomationDateMode; fixedStart:string; fixedEnd:string; rollingDays:number };
type AutomationRequest = { reportTitle: string; reportKey: string; sourcePath: string; preferredPlayerId?: number | null; preferredPlayerName?: string; includeAiSummaryByDefault?: boolean; reportPanels?:AutomationPanelSeed[] };
type Automation = { id:number; reportKey:string; reportTitle:string; sourcePath:string; cadence:'daily'|'weekly'; weekdays:number[]; localTime:string; timeZone:string; playerScope:'all'|'selected'; playerIds:number[]; reportPanels:AutomationPanel[]; onlyWhenData:boolean; includeAiSummary:boolean; notifyPlayers:boolean; active:boolean; lastRunAt:string|null };
type AutomationRun = { id:number; automationId:number; reportDate:string; status:'running'|'saved'|'skipped'|'failed'; detail:string; createdAt:string };

let staffCheck: Promise<boolean> | null = null;
function canManageAutomations(): Promise<boolean> {
  if (!staffCheck) staffCheck = fetch('/api/auth/session', {cache:'no-store'}).then((response) => response.json()).then((data:{role?:string}) => data.role === 'admin' || data.role === 'coach').catch(() => false);
  return staffCheck;
}

function reportKeyFromTitle(title: string): string {
  const value = title.toLowerCase();
  if (value.includes('bullpen')) return 'bullpen-summary';
  if (value.includes('pitching')) return 'pitching-report';
  if (value.includes('hitting') || value.includes('hitter')) return 'hitting-report';
  if (value.includes('catching') || value.includes('catcher')) return 'catching-report';
  if (value.includes('intended')) return 'intended-target-report';
  if (value.includes('biomechanic')) return 'biomechanics-report';
  if (value.includes('pulse')) return 'pulse-report';
  if (value.includes('development')) return 'development-plan';
  return 'custom-report';
}

function personNameKey(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

function panelDateValue(requestUrl:string, names:string[]):string {
  try {
    const params = new URL(requestUrl, window.location.origin).searchParams;
    return names.map((name) => params.get(name) ?? '').find(Boolean)?.slice(0,10) ?? '';
  } catch { return ''; }
}

function initializeAutomationPanel(panel:AutomationPanelSeed):AutomationPanel {
  return {
    ...panel,
    dateMode:'automation_day',
    fixedStart:panelDateValue(panel.requestUrl,['start_date','startDate','start']),
    fixedEnd:panelDateValue(panel.requestUrl,['end_date','endDate','end']),
    rollingDays:30,
  };
}

export function SaveReportToProfileButton({
  generate,
  title,
  preferredPlayerId,
  preferredPlayerName,
  reportKey,
  includeAiSummaryByDefault = false,
  disabled = false,
  className = 'btn btn-ghost',
}: {
  generate: () => void | Promise<void>;
  title?: string;
  preferredPlayerId?: number | null;
  preferredPlayerName?: string;
  reportKey?: string;
  includeAiSummaryByDefault?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [preparing, setPreparing] = useState(false);
  const [canAutomate, setCanAutomate] = useState(false);

  useEffect(() => { void canManageAutomations().then(setCanAutomate); }, []);

  const prepare = async () => {
    setPreparing(true);
    try {
      await prepareReportPdfForProfile(generate, { title, preferredPlayerId, preferredPlayerName });
    } catch (error) {
      window.dispatchEvent(new CustomEvent('pearl:report-save-message', {
        detail: { message: error instanceof Error ? error.message : 'Unable to prepare report.', error: true },
      }));
    } finally {
      setPreparing(false);
    }
  };

  return <>
    <button type="button" className={className} onClick={() => void prepare()} disabled={disabled || preparing}>{preparing ? 'Preparing…' : 'Save to Player Profile'}</button>
    {canAutomate ? <button type="button" className={className} disabled={disabled} onClick={() => window.dispatchEvent(new CustomEvent('pearl:report-automation-open', {detail:{ reportTitle:title || 'Report', reportKey:reportKey || reportKeyFromTitle(title || 'Report'), sourcePath:`${window.location.pathname}${window.location.search}`, preferredPlayerId, preferredPlayerName, includeAiSummaryByDefault } satisfies AutomationRequest}))}>Automate</button> : null}
  </>;
}

export function ReportActionsDropdown({
  generate,
  downloadPng,
  title,
  preferredPlayerId,
  preferredPlayerName,
  reportKey,
  includeAiSummaryByDefault = false,
  automationPanels = [],
  disabled = false,
  className = 'btn btn-primary',
}: {
  generate: () => void | Promise<void>;
  downloadPng?: () => void | Promise<void>;
  title?: string;
  preferredPlayerId?: number | null;
  preferredPlayerName?: string;
  reportKey?: string;
  includeAiSummaryByDefault?: boolean;
  automationPanels?: AutomationPanelSeed[];
  disabled?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [canAutomate, setCanAutomate] = useState(false);

  useEffect(() => { void canManageAutomations().then(setCanAutomate); }, []);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const saveToProfile = async () => {
    setOpen(false);
    setPreparing(true);
    try {
      await prepareReportPdfForProfile(generate, { title, preferredPlayerId, preferredPlayerName });
    } catch (error) {
      window.dispatchEvent(new CustomEvent('pearl:report-save-message', { detail: { message: error instanceof Error ? error.message : 'Unable to prepare report.', error: true } }));
    } finally {
      setPreparing(false);
    }
  };

  const automate = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('pearl:report-automation-open', { detail: {
      reportTitle:title || 'Report', reportKey:reportKey || reportKeyFromTitle(title || 'Report'),
      sourcePath:`${window.location.pathname}${window.location.search}`, preferredPlayerId, preferredPlayerName, includeAiSummaryByDefault, reportPanels:automationPanels,
    } satisfies AutomationRequest }));
  };

  return (
    <div ref={rootRef} className="report-actions-dropdown">
      <button type="button" className={className} disabled={disabled || preparing} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {preparing ? 'Preparing…' : 'Report Actions'} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="report-actions-menu" role="menu" style={{ display: 'flex', flexDirection: 'column' }}>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void generate(); }}>Download PDF</button>
          {downloadPng ? <button type="button" role="menuitem" onClick={() => { setOpen(false); void downloadPng(); }}>Download PNG</button> : null}
          <button type="button" role="menuitem" onClick={() => void saveToProfile()}>Save to Player Profile</button>
          {canAutomate ? <button type="button" role="menuitem" onClick={automate}>Automate Report</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ReportProfileSaveManager() {
  const [pending, setPending] = useState<PendingReport | null>(null);
  const [players, setPlayers] = useState<OrgPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(0);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [automationRequest, setAutomationRequest] = useState<AutomationRequest | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [editingAutomationId, setEditingAutomationId] = useState<number | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationTitle, setAutomationTitle] = useState('');
  const [cadence, setCadence] = useState<'daily'|'weekly'>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([0,1,2,3,4,5,6]);
  const [localTime, setLocalTime] = useState('17:00');
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Phoenix');
  const [playerScope, setPlayerScope] = useState<'all'|'selected'>('all');
  const [automationPlayerIds, setAutomationPlayerIds] = useState<number[]>([]);
  const [automationPanels, setAutomationPanels] = useState<AutomationPanel[]>([]);
  const [onlyWhenData, setOnlyWhenData] = useState(true);
  const [includeAiSummary, setIncludeAiSummary] = useState(false);
  const [notifyPlayers, setNotifyPlayers] = useState(true);

  useEffect(() => {
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<PendingReport>).detail;
      if (!detail?.file) return;
      setPending(detail);
      setError('');
      setLoadingPlayers(true);
      fetch('/api/dashboard/player-plans/players', { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as { players?: OrgPlayer[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? 'Unable to load players.');
          const nextPlayers = Array.isArray(payload.players) ? payload.players : [];
          setPlayers(nextPlayers);
          const urlPreferredId = Number(new URLSearchParams(window.location.search).get('previewPlayerId') ?? 0);
          const preferredById = nextPlayers.find((player) => player.playerId === detail.preferredPlayerId)
            ?? nextPlayers.find((player) => player.playerId === urlPreferredId);
          const preferredNameKey = personNameKey(detail.preferredPlayerName ?? '');
          const preferredByName = preferredNameKey
            ? nextPlayers.find((player) => personNameKey(player.fullName) === preferredNameKey)
            : undefined;
          setSelectedPlayerId((preferredById ?? preferredByName ?? nextPlayers[0])?.playerId ?? 0);
        })
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load players.'))
        .finally(() => setLoadingPlayers(false));
    };
    const onMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) setToast(detail.message);
    };
    const onAutomation = (event: Event) => {
      const detail = (event as CustomEvent<AutomationRequest>).detail;
      if (!detail?.reportTitle) return;
      setAutomationRequest(detail); setAutomationTitle(detail.reportTitle); setError(''); setAutomationLoading(true);
      setIncludeAiSummary(Boolean(detail.includeAiSummaryByDefault));
      setAutomationPanels((detail.reportPanels ?? []).map(initializeAutomationPanel));
      const readJson = async (response: Response) => {
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Request failed (${response.status}).`);
        return payload;
      };
      Promise.all([
        fetch('/api/dashboard/player-plans/players', {cache:'no-store'}).then(readJson),
        fetch('/api/report-automations', {cache:'no-store'}).then(readJson),
      ]).then(([playerData, automationData]:[{players?:OrgPlayer[]},{automations?:Automation[];runs?:AutomationRun[]}]) => {
        const nextPlayers = Array.isArray(playerData.players) ? playerData.players : [];
        setPlayers(nextPlayers); setAutomations(Array.isArray(automationData.automations) ? automationData.automations : []);
        setAutomationRuns(Array.isArray(automationData.runs) ? automationData.runs : []); setEditingAutomationId(null);
        const preferredKey = personNameKey(detail.preferredPlayerName ?? '');
        const preferred = nextPlayers.find((player) => player.playerId === detail.preferredPlayerId) ?? nextPlayers.find((player) => preferredKey && personNameKey(player.fullName) === preferredKey);
        setAutomationPlayerIds(preferred ? [preferred.playerId] : []);
      }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load automation settings.')).finally(() => setAutomationLoading(false));
    };
    window.addEventListener(REPORT_PDF_READY_EVENT, onReady);
    window.addEventListener('pearl:report-save-message', onMessage);
    window.addEventListener('pearl:report-automation-open', onAutomation);
    return () => {
      window.removeEventListener(REPORT_PDF_READY_EVENT, onReady);
      window.removeEventListener('pearl:report-save-message', onMessage);
      window.removeEventListener('pearl:report-automation-open', onAutomation);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const close = () => {
    if (saving) return;
    setPending(null);
    setPlayers([]);
    setSelectedPlayerId(0);
    setError('');
  };

  const save = async () => {
    if (!pending || selectedPlayerId <= 0) return;
    setSaving(true);
    setError('');
    const result = await uploadPlayerMediaFile({
      playerId: selectedPlayerId,
      file: pending.file,
      title: pending.title,
      category: 'Reports',
      sourceType: 'generated_report',
      sourceLabel: pending.title,
    });
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    const playerName = players.find((player) => player.playerId === selectedPlayerId)?.fullName;
    setSaving(false);
    setPending(null);
    setToast(`Report saved${playerName ? ` to ${playerName}'s profile` : ''}.`);
  };

  const saveAutomation = async () => {
    if (!automationRequest) return;
    setAutomationSaving(true); setError('');
    const existing = editingAutomationId ? automations.find((item) => item.id === editingAutomationId) : null;
    const response = await fetch('/api/report-automations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ id:editingAutomationId,reportKey:automationRequest.reportKey,reportTitle:automationTitle,sourcePath:automationRequest.sourcePath,cadence,weekdays,localTime,timeZone,playerScope,playerIds:automationPlayerIds,reportPanels:automationPanels,onlyWhenData,includeAiSummary,notifyPlayers,active:existing?.active ?? true })});
    const payload = await response.json().catch(() => ({})) as {automation?:Automation;error?:string};
    if (!response.ok || !payload.automation) { setError(payload.error ?? 'Could not save automation.'); setAutomationSaving(false); return; }
    setAutomations((current) => editingAutomationId ? current.map((item) => item.id === editingAutomationId ? payload.automation! : item) : [payload.automation!, ...current]); setAutomationSaving(false); setAutomationRequest(null); setEditingAutomationId(null); setToast(editingAutomationId ? 'Report automation updated.' : 'Report automation enabled.');
  };

  const deleteAutomation = async (id:number) => {
    const response = await fetch(`/api/report-automations?id=${id}`, {method:'DELETE'});
    if (response.ok) setAutomations((current) => current.filter((item) => item.id !== id));
  };

  const runAutomation = async (id:number) => {
    setAutomationSaving(true); setError('');
    const response = await fetch('/api/report-automations/run', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const payload = await response.json().catch(() => ({})) as {saved?:number;skipped?:number;failed?:number;error?:string};
    setAutomationSaving(false);
    if (!response.ok) { setError(payload.error ?? 'Automation run failed.'); return; }
    setToast(`Automation finished: ${payload.saved ?? 0} saved, ${payload.skipped ?? 0} skipped, ${payload.failed ?? 0} failed.`);
  };

  const editAutomation = (item:Automation, duplicate=false) => {
    setAutomationRequest({reportTitle:item.reportTitle,reportKey:item.reportKey,sourcePath:item.sourcePath});
    setEditingAutomationId(duplicate ? null : item.id); setAutomationTitle(duplicate ? `${item.reportTitle} Copy` : item.reportTitle);
    setCadence(item.cadence); setWeekdays(item.weekdays); setLocalTime(item.localTime); setTimeZone(item.timeZone); setPlayerScope(item.playerScope); setAutomationPlayerIds(item.playerIds); setAutomationPanels(item.reportPanels ?? []); setOnlyWhenData(item.onlyWhenData); setIncludeAiSummary(item.includeAiSummary); setNotifyPlayers(item.notifyPlayers); setError('');
  };

  const toggleAutomation = async (item:Automation) => {
    const response = await fetch('/api/report-automations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,id:item.id,active:!item.active})});
    const payload = await response.json().catch(() => ({})) as {automation?:Automation;error?:string};
    if (!response.ok || !payload.automation) { setError(payload.error ?? 'Could not update automation.'); return; }
    setAutomations((current) => current.map((entry) => entry.id === item.id ? payload.automation! : entry));
  };

  const hasInvalidPanelDates = automationPanels.some((panel) => panel.dateMode === 'fixed' && (!panel.fixedStart || !panel.fixedEnd || panel.fixedStart > panel.fixedEnd));

  return (
    <>
      {pending ? (
        <div className="report-profile-save-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="report-profile-save-dialog" role="dialog" aria-modal="true" aria-labelledby="report-profile-save-title">
            <div className="report-profile-save-kicker">REPORT LIBRARY</div>
            <h2 id="report-profile-save-title">Save to player profile</h2>
            <p className="portal-muted-text">This PDF will appear in the player’s profile under <strong>Reports</strong>.</p>
            <label>
              Report name
              <input
                value={pending.title}
                maxLength={180}
                onChange={(event) => setPending((current) => current ? { ...current, title: event.target.value } : current)}
              />
            </label>
            <label>
              Player
              <select value={selectedPlayerId || ''} disabled={loadingPlayers || players.length <= 1} onChange={(event) => setSelectedPlayerId(Number(event.target.value))}>
                {loadingPlayers ? <option value="">Loading players…</option> : null}
                {!loadingPlayers && players.length === 0 ? <option value="">No available players</option> : null}
                {players.map((player) => <option key={player.playerId} value={player.playerId}>{player.fullName}</option>)}
              </select>
            </label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="report-profile-save-actions">
              <button type="button" className="btn btn-ghost" onClick={close} disabled={saving}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || loadingPlayers || selectedPlayerId <= 0 || !pending.title.trim()}>
                {saving ? 'Saving…' : 'Save Report'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {automationRequest ? (
        <div className="report-profile-save-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !automationSaving) setAutomationRequest(null); }}>
          <section className="report-profile-save-dialog report-automation-dialog" role="dialog" aria-modal="true" aria-labelledby="report-automation-title">
            <div className="report-profile-save-kicker">AUTOMATED DELIVERY</div>
            <h2 id="report-automation-title">Automate this report</h2>
            <p className="portal-muted-text">Fresh data will be checked on schedule and qualifying PDFs will be saved under <strong>Reports</strong>.</p>
            <label>Automation name<input value={automationTitle} maxLength={180} onChange={(event) => setAutomationTitle(event.target.value)} /></label>
            <div className="report-automation-grid">
              <label>Schedule<select value={cadence} onChange={(event) => setCadence(event.target.value as 'daily'|'weekly')}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              <label>Time<input type="time" step="300" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></label>
            </div>
            <label>Timezone<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} list="report-timezones" /><datalist id="report-timezones"><option value="America/Phoenix"/><option value="America/Los_Angeles"/><option value="America/Denver"/><option value="America/Chicago"/><option value="America/New_York"/></datalist></label>
            {cadence === 'weekly' ? <fieldset className="report-automation-weekdays"><legend>Run on</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label,day) => <label key={label}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current,day])}/>{label}</label>)}</fieldset> : null}
            {automationPanels.length ? <fieldset className="report-automation-panel-dates"><legend>Panel date behavior</legend><div className="report-automation-panel-toolbar"><span>Choose how each panel moves when the automation runs.</span><button type="button" className="btn btn-ghost" onClick={() => setAutomationPanels((current) => current.map((panel) => ({...panel,dateMode:'automation_day'})))}>Use Run Date for All</button></div>{automationPanels.map((panel,index) => <div className="report-automation-panel-date-row" key={`${panel.id}-${index}`}><strong>{panel.title || `Panel ${index+1}`}</strong><select aria-label={`${panel.title} date behavior`} value={panel.dateMode} onChange={(event) => setAutomationPanels((current) => current.map((item,itemIndex) => itemIndex === index ? {...item,dateMode:event.target.value as AutomationDateMode} : item))}><option value="automation_day">Automation date</option><option value="fixed">Fixed date range</option><option value="rolling_days">Rolling number of days</option><option value="month_to_date">Month to date</option><option value="previous_month_to_date">Previous month to same day</option><option value="previous_month">Full previous month</option></select>{panel.dateMode === 'fixed' ? <div className="report-automation-panel-range"><input type="date" aria-label={`${panel.title} fixed start`} value={panel.fixedStart} onChange={(event) => setAutomationPanels((current) => current.map((item,itemIndex) => itemIndex === index ? {...item,fixedStart:event.target.value} : item))}/><span>to</span><input type="date" aria-label={`${panel.title} fixed end`} value={panel.fixedEnd} onChange={(event) => setAutomationPanels((current) => current.map((item,itemIndex) => itemIndex === index ? {...item,fixedEnd:event.target.value} : item))}/></div> : null}{panel.dateMode === 'rolling_days' ? <label className="report-automation-rolling-days">Days<input type="number" min="1" max="365" value={panel.rollingDays} onChange={(event) => setAutomationPanels((current) => current.map((item,itemIndex) => itemIndex === index ? {...item,rollingDays:Math.max(1,Math.min(365,Number(event.target.value)||1))} : item))}/></label> : null}</div>)}</fieldset> : null}
            <label>Players<select value={playerScope} onChange={(event) => setPlayerScope(event.target.value as 'all'|'selected')}><option value="all">All players</option><option value="selected">Selected players</option></select></label>
            {playerScope === 'selected' ? <div className="report-automation-player-list">{automationLoading ? <span>Loading players…</span> : players.map((player) => <label key={player.playerId}><input type="checkbox" checked={automationPlayerIds.includes(player.playerId)} onChange={() => setAutomationPlayerIds((current) => current.includes(player.playerId) ? current.filter((id) => id !== player.playerId) : [...current,player.playerId])}/>{player.fullName}</label>)}</div> : null}
            <label className="report-automation-check"><input type="checkbox" checked={onlyWhenData} onChange={(event) => setOnlyWhenData(event.target.checked)}/><span>Only save when qualifying data exists</span></label>
            <label className="report-automation-check"><input type="checkbox" checked={includeAiSummary} onChange={(event) => setIncludeAiSummary(event.target.checked)}/><span>Include a fresh AI summary in each PDF</span></label>
            <label className="report-automation-check"><input type="checkbox" checked={notifyPlayers} onChange={(event) => setNotifyPlayers(event.target.checked)}/><span>Notify players when a report is saved</span></label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="report-profile-save-actions"><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => {setAutomationRequest(null);setEditingAutomationId(null);}}>Cancel</button><button type="button" className="btn btn-primary" disabled={automationSaving || automationLoading || hasInvalidPanelDates || !automationTitle.trim() || (playerScope === 'selected' && !automationPlayerIds.length) || (cadence === 'weekly' && !weekdays.length)} onClick={() => void saveAutomation()}>{automationSaving ? 'Saving…' : editingAutomationId ? 'Save Changes' : 'Enable Automation'}</button></div>
            {automations.length ? <details className="report-automation-existing"><summary>Manage existing automations ({automations.length})</summary>{automations.map((item) => <div key={item.id}><span><strong>{item.reportTitle}</strong><small>{item.cadence} at {item.localTime} · {item.active ? 'Active' : 'Paused'}{item.lastRunAt ? ` · Last run ${new Date(item.lastRunAt).toLocaleDateString()}` : ''}</small></span><span className="report-automation-row-actions"><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => editAutomation(item)}>Edit</button><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => editAutomation(item,true)}>Duplicate</button><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => void toggleAutomation(item)}>{item.active?'Pause':'Resume'}</button><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => void runAutomation(item.id)}>Run now</button><button type="button" className="btn btn-ghost" disabled={automationSaving} onClick={() => void deleteAutomation(item.id)}>Delete</button></span></div>)}{automationRuns.length ? <div className="report-automation-run-history"><strong>Recent runs</strong>{automationRuns.slice(0,8).map((run) => <small key={run.id} data-status={run.status}>{run.reportDate} · {run.status} · {run.detail || 'Processing'}</small>)}</div> : null}</details> : null}
          </section>
        </div>
      ) : null}
      {toast ? <div className="report-profile-save-toast" role="status">{toast}</div> : null}
    </>
  );
}
