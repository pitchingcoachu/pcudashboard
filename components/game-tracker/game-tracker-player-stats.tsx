'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { GameTrackerStats } from '../../lib/game-tracker/stats';
import type { GameTrackerGame } from '../../lib/game-tracker/types';
import styles from './game-tracker-player-stats.module.css';

type Detail = {
  playerKey: string;
  playerName: string;
  totals: GameTrackerStats;
  games: Array<{
    game: GameTrackerGame;
    stats: GameTrackerStats;
    appearances: Array<{ teamSide: 'us' | 'opponent'; battingOrder: number | null; position: string | null }>;
  }>;
};

const value = (input: unknown) => input === null || input === undefined ? '—' : String(input);
const rate = (input: unknown) => input === null || input === undefined ? '—' : Number(input).toFixed(3).replace(/^0/, '');
const pct = (input: unknown) => input === null || input === undefined ? '—' : `${Number(input).toFixed(1)}%`;

export default function GameTrackerPlayerStats({ playerKey }: { playerKey: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/game-tracker/stats/player?playerKey=${encodeURIComponent(playerKey)}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Could not load player stats.'); else setDetail(body);
  }, [playerKey]);
  useEffect(() => { void load(); }, [load]);

  if (!detail) return <main className={`${styles.shell} game-tracker-player-shell`}><div className="game-tracker-back"><Link href="/portal/admin/game-tracker/stats">← Season Stats</Link></div><p className="game-tracker-player-status">{error || 'Building player report…'}</p></main>;
  const batting = detail.totals.batting[0];
  const pitching = detail.totals.pitching[0];
  const fielding = detail.totals.fielding[0];
  const highlights = batting ? [
    ['PA', value(batting.pa)], ['AVG', rate(batting.avg)], ['OPS', rate(batting.ops)], ['HR', value(batting.homeRuns)], ['RBI', value(batting.rbi)], ['BB%', pct(batting.bbPct)],
  ] : pitching ? [
    ['IP', value(pitching.ip)], ['ERA', pitching.era?.toFixed(2) ?? '—'], ['WHIP', pitching.whip?.toFixed(2) ?? '—'], ['K', value(pitching.strikeouts)], ['K%', pct(pitching.kPct)], ['CSW%', pct(pitching.cswPct)],
  ] : fielding ? [['G', value(fielding.games)], ['PO', value(fielding.putouts)], ['A', value(fielding.assists)], ['E', value(fielding.errors)], ['FLD%', rate(fielding.fieldingPct)]] : [];

  return <main className={`${styles.shell} game-tracker-player-shell`}>
    <div className="game-tracker-back"><Link href="/portal/admin/game-tracker/stats">← Season Stats</Link><Link href="/portal/admin/game-tracker">Game Tracker</Link></div>
    <section className="game-tracker-player-hero"><div><p>PLAYER FILE / ALL TEAM APPEARANCES</p><h1>{detail.playerName}</h1><span>{detail.games.length} tracked game{detail.games.length === 1 ? '' : 's'} · one statistical identity</span></div><div className="game-tracker-player-monogram">{detail.playerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div></section>
    <section className="game-tracker-player-highlights">{highlights.map(([label, stat]) => <article key={label}><small>{label}</small><strong>{stat}</strong></article>)}</section>
    <section className="game-tracker-player-grid">
      {batting ? <article className="game-tracker-player-card"><header><h2>Batting</h2><span>{batting.games} G</span></header><div className="game-tracker-player-stat-grid">{[['AB',batting.ab],['R',batting.runs],['H',batting.hits],['2B',batting.doubles],['3B',batting.triples],['HR',batting.homeRuns],['BB',batting.walks],['K',batting.strikeouts],['OBP',rate(batting.obp)],['SLG',rate(batting.slg)],['Whiff%',pct(batting.whiffPct)]].map(([label,stat]) => <span key={label}><small>{label}</small><b>{value(stat)}</b></span>)}</div></article> : null}
      {pitching ? <article className="game-tracker-player-card"><header><h2>Pitching</h2><span>{pitching.games} G</span></header><div className="game-tracker-player-stat-grid">{[['IP',pitching.ip],['P',pitching.pitches],['H',pitching.hits],['ER',pitching.earnedRuns],['BB',pitching.walks],['K',pitching.strikeouts],['ERA',pitching.era?.toFixed(2)],['WHIP',pitching.whip?.toFixed(2)],['Strike%',pct(pitching.strikePct)],['Whiff%',pct(pitching.whiffPct)],['CSW%',pct(pitching.cswPct)]].map(([label,stat]) => <span key={label}><small>{label}</small><b>{value(stat)}</b></span>)}</div></article> : null}
      {fielding ? <article className="game-tracker-player-card"><header><h2>Fielding</h2><span>{fielding.games} G</span></header><div className="game-tracker-player-stat-grid">{[['PO',fielding.putouts],['A',fielding.assists],['E',fielding.errors],['DP',fielding.doublePlays],['TC',fielding.totalChances],['FLD%',rate(fielding.fieldingPct)]].map(([label,stat]) => <span key={label}><small>{label}</small><b>{value(stat)}</b></span>)}</div></article> : null}
    </section>
    <section className="game-tracker-player-log"><header><div><small>CHRONOLOGICAL RECORD</small><h2>Game Log</h2></div><span>{detail.games.length} ENTRIES</span></header><div className="game-tracker-player-log-table">{detail.games.map(({ game, stats, appearances }) => {
      const bat = stats.batting[0]; const pitch = stats.pitching[0]; const field = stats.fielding[0];
      const sides = Array.from(new Set(appearances.map((appearance) => appearance.teamSide === 'us' ? game.usTeamName : game.opponentName)));
      return <Link href={`/portal/admin/game-tracker/${game.id}`} className="game-tracker-player-log-row" key={game.id}><time>{game.gameDate}</time><span><strong>{game.usTeamName} vs. {game.opponentName}</strong><small>{sides.join(' / ')} · {appearances.map((appearance) => appearance.position).filter(Boolean).join(', ') || '—'}</small></span><span>{bat ? `${bat.hits}-${bat.ab}, ${bat.rbi} RBI` : '—'}</span><span>{pitch ? `${pitch.ip} IP, ${pitch.strikeouts} K` : field ? `${field.totalChances} TC` : '—'}</span><b>{game.state.score.us}–{game.state.score.opponent}</b><i>→</i></Link>;
    })}</div></section>
  </main>;
}
