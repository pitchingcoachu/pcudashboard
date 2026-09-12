'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameTrackerRosterMember, GameTrackerTeam, Handedness, ThrowingHand } from '../../lib/game-tracker/types';
import styles from './game-tracker-rosters.module.css';

type OrganizationPlayer = { playerId: number; fullName: string; bats: Handedness | null; throws: ThrowingHand | null; position: string | null };
type TeamData = { teams: GameTrackerTeam[]; members: GameTrackerRosterMember[]; organizationRoster: OrganizationPlayer[] };

export default function GameTrackerRosters() {
  const [data, setData] = useState<TeamData>({ teams: [], members: [], organizationRoster: [] });
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [rosterPersonId, setRosterPersonId] = useState<number | null>(null);
  const [bats, setBats] = useState<Handedness>('R');
  const [throws, setThrows] = useState<ThrowingHand>('R');
  const [position, setPosition] = useState('');
  const [jersey, setJersey] = useState('');
  const [csvText, setCsvText] = useState('');
  const [linkingMember, setLinkingMember] = useState<GameTrackerRosterMember | null>(null);
  const [linkPlayerId, setLinkPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/game-tracker/teams', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) return setError(body.error ?? 'Could not load teams.');
    setData(body);
    setSelectedTeamId((current) => current && body.teams.some((team: GameTrackerTeam) => team.id === current) ? current : body.teams[0]?.id ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedTeam = data.teams.find((team) => team.id === selectedTeamId);
  const members = useMemo(() => data.members.filter((member) => member.teamId === selectedTeamId), [data.members, selectedTeamId]);
  const identityChoices = useMemo(() => {
    const choices = new Map<string, { name: string; playerId: number | null; rosterPersonId: number | null; bats: Handedness; throws: ThrowingHand; position: string | null }>();
    for (const player of data.organizationRoster) choices.set(player.fullName.toLowerCase(), { name: player.fullName, playerId: player.playerId, rosterPersonId: null, bats: player.bats ?? 'R', throws: player.throws ?? 'R', position: player.position });
    for (const member of data.members) if (!choices.has(member.displayName.toLowerCase())) choices.set(member.displayName.toLowerCase(), { name: member.displayName, playerId: member.playerId, rosterPersonId: member.rosterPersonId, bats: member.bats, throws: member.throws, position: member.position });
    return Array.from(choices.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  function selectIdentity(value: string) {
    setName(value);
    const match = identityChoices.find((choice) => choice.name.localeCompare(value.trim(), undefined, { sensitivity: 'accent' }) === 0);
    setPlayerId(match?.playerId ?? null);
    setRosterPersonId(match?.rosterPersonId ?? null);
    if (match) { setBats(match.bats); setThrows(match.throws); setPosition(match.position ?? ''); }
  }

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    const response = await fetch('/api/game-tracker/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) { setError(body.error ?? 'Could not save roster.'); return null; }
    return body;
  }

  async function createTeam(formData: FormData) {
    const body = await post({ action: 'create_team', name: formData.get('name'), shortName: formData.get('shortName') || null, teamType: formData.get('teamType'), statSourceTeamId: formData.get('statSourceTeamId') ? Number(formData.get('statSourceTeamId')) : null });
    if (!body) return;
    await load(); setSelectedTeamId(body.team.id); setNotice(`${body.team.name} is ready for players.`);
  }

  async function addPlayer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTeamId) return;
    const body = await post({ action: 'save_member', teamId: selectedTeamId, playerId, rosterPersonId, displayName: name, bats, throws, position: position || null, jerseyNumber: jersey || null });
    if (!body) return;
    setName(''); setPlayerId(null); setRosterPersonId(null); setPosition(''); setJersey('');
    await load(); setNotice(`${body.member.displayName} added to ${selectedTeam?.name}.`);
  }

  async function importRoster() {
    if (!selectedTeamId || !csvText.trim()) return;
    const body = await post({ action: 'import_roster', teamId: selectedTeamId, csvText });
    if (!body) return;
    setCsvText(''); await load(); setNotice(`${body.imported} players imported into ${selectedTeam?.name}.`);
  }

  async function removeMember(member: GameTrackerRosterMember) {
    if (!selectedTeamId || !window.confirm(`Remove ${member.displayName} from ${selectedTeam?.name}? Their existing game stats will remain.`)) return;
    setBusy(true);
    const response = await fetch(`/api/game-tracker/teams?teamId=${selectedTeamId}&memberId=${member.id}`, { method: 'DELETE' });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error ?? 'Could not remove player.');
    await load();
  }

  async function linkIdentity() {
    if (!linkingMember || !linkPlayerId) return;
    const target = data.organizationRoster.find((player) => player.playerId === linkPlayerId);
    if (!window.confirm(`Link ${linkingMember.displayName} to ${target?.fullName}? Existing Game Tracker stats will be merged into that player.`)) return;
    const body = await post({ action: 'link_person', rosterPersonId: linkingMember.rosterPersonId, playerId: linkPlayerId });
    if (!body) return;
    setLinkingMember(null); setLinkPlayerId(null); await load(); setNotice(`Player identity linked to ${target?.fullName}.`);
  }

  return <main className={`${styles.shell} game-tracker-rosters-shell`}>
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker">← Game Tracker</Link></div>
    <section className="game-tracker-rosters-hero"><div><p>TEAM LIBRARY / PLAYER IDENTITY</p><h1>Teams & Rosters</h1><span>Build opponent and intrasquad rosters without splitting a player’s permanent statistical record.</span></div><strong>{data.teams.length}<small>saved teams</small></strong></section>
    {error ? <p className="game-tracker-rosters-error">{error}</p> : null}{notice ? <p className="game-tracker-rosters-notice">{notice}</p> : null}
    <section className="game-tracker-rosters-layout">
      <aside className="game-tracker-rosters-sidebar">
        <div className="game-tracker-rosters-team-list">{data.teams.map((team) => <button type="button" key={team.id} className={team.id === selectedTeamId ? 'is-active' : ''} onClick={() => setSelectedTeamId(team.id)}><span><strong>{team.name}</strong><small>{team.teamType.replace('_', ' ')}</small></span><b>{team.memberCount}</b></button>)}</div>
        <form action={createTeam} className="game-tracker-rosters-create"><h2>Create a team</h2><label>Team name<input name="name" placeholder="LEC Black" required /></label><label>Short name<input name="shortName" placeholder="BLACK" /></label><label>Type<select name="teamType" defaultValue="opponent"><option value="organization">Organization</option><option value="intrasquad">Intrasquad</option><option value="opponent">Opponent</option></select></label><label>Roll stats up to<select name="statSourceTeamId" defaultValue=""><option value="">This team</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button className="btn btn-primary" disabled={busy}>Create team</button></form>
      </aside>
      <div className="game-tracker-rosters-main">
        {!selectedTeam ? <div className="game-tracker-rosters-empty">Create your first team to begin.</div> : <>
          <header><div><small>{selectedTeam.teamType.replace('_', ' ')}</small><h2>{selectedTeam.name}</h2></div><span>{members.length} PLAYERS</span></header>
          <datalist id="game-tracker-identity-list">{identityChoices.map((choice) => <option key={`${choice.playerId ?? choice.rosterPersonId}-${choice.name}`} value={choice.name} />)}</datalist>
          <form className="game-tracker-rosters-player-form" onSubmit={addPlayer}><label className="is-name">Player<input list="game-tracker-identity-list" value={name} onChange={(event) => selectIdentity(event.target.value)} placeholder="Select existing or type new" required /></label><label>#<input value={jersey} onChange={(event) => setJersey(event.target.value)} /></label><label>Bats<select value={bats} onChange={(event) => setBats(event.target.value as Handedness)}><option>R</option><option>L</option><option>S</option></select></label><label>Throws<select value={throws} onChange={(event) => setThrows(event.target.value as ThrowingHand)}><option>R</option><option>L</option></select></label><label>Position<input value={position} onChange={(event) => setPosition(event.target.value)} placeholder="SS" /></label><button className="btn btn-primary" disabled={busy}>Add player</button></form>
          <div className="game-tracker-rosters-table"><div className="game-tracker-rosters-row is-head"><span>#</span><span>Player</span><span>B/T</span><span>Pos</span><span /></div>{members.length ? members.map((member) => <div className="game-tracker-rosters-row" key={member.id}><span>{member.jerseyNumber ?? '—'}</span><span><strong>{member.displayName}</strong><small>{member.playerId ? 'Organization player' : 'Tracker player'}</small></span><span>{member.bats}/{member.throws}</span><span>{member.position ?? '—'}</span><span className="game-tracker-rosters-row-actions">{!member.playerId ? <button className="is-link" type="button" onClick={() => { setLinkingMember(member); setLinkPlayerId(null); }}>Link</button> : null}{!selectedTeam.isPrimary ? <button type="button" aria-label={`Remove ${member.displayName}`} onClick={() => void removeMember(member)}>×</button> : null}</span></div>) : <div className="game-tracker-rosters-empty">No players yet. Add one above or import a CSV.</div>}</div>
          {linkingMember ? <div className="game-tracker-rosters-link"><span><small>MERGE PLAYER IDENTITY</small><strong>{linkingMember.displayName}</strong></span><select value={linkPlayerId ?? ''} onChange={(event) => setLinkPlayerId(event.target.value ? Number(event.target.value) : null)}><option value="">Choose organization player</option>{data.organizationRoster.map((player) => <option key={player.playerId} value={player.playerId}>{player.fullName}</option>)}</select><button type="button" className="btn btn-primary" disabled={!linkPlayerId || busy} onClick={() => void linkIdentity()}>Link & merge stats</button><button type="button" className="btn btn-ghost" onClick={() => setLinkingMember(null)}>Cancel</button></div> : null}
          <details className="game-tracker-rosters-import"><summary>Import roster from CSV</summary><p>Headers supported: Name, Jersey, Bats, Throws, Position, and optional PCU Player ID.</p><input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setCsvText(await file.text()); }} /><textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder={'Name,Jersey,Bats,Throws,Position\nJane Doe,12,R,R,SS'} /><button type="button" className="btn btn-primary" disabled={busy || !csvText.trim()} onClick={() => void importRoster()}>Import players</button></details>
        </>}
      </div>
    </section>
  </main>;
}
