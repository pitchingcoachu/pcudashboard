'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { GameTrackerGame, GameType } from '../../lib/game-tracker/types';
import styles from './game-tracker-hub.module.css';

const GAME_TYPE_LABELS: Record<GameType, string> = { game: 'Game', scrimmage: 'Scrimmage', live_bp: 'Live BP' };

export default function GameTrackerHub({ logoSrc }: { logoSrc: string }) {
  const [games, setGames] = useState<GameTrackerGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadGames() {
    setLoading(true);
    const response = await fetch('/api/game-tracker/games', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Could not load games.');
    else setGames(body.games ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadGames(); }, []);

  async function createGame(formData: FormData) {
    setSaving(true);
    setError('');
    const response = await fetch('/api/game-tracker/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameType: formData.get('gameType'), gameDate: formData.get('gameDate'), season: formData.get('season'),
        opponentName: formData.get('opponentName'), location: formData.get('location') || null,
        homeAway: formData.get('homeAway'), inningsScheduled: Number(formData.get('inningsScheduled') || 9),
      }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) return setError(body.error ?? 'Could not create the game.');
    window.location.href = `/portal/admin/game-tracker/${body.game.id}`;
  }

  async function deleteGame(gameId: number) {
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    setDeletingId(gameId);
    setError('');
    const response = await fetch(`/api/game-tracker/games/${gameId}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({}));
    setDeletingId(null);
    if (!response.ok) return setError(body.error ?? 'Could not delete the game.');
    setGames((prev) => prev.filter((game) => game.id !== gameId));
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className={`${styles.shell} game-tracker-shell`}>
      <section className="game-tracker-hero">
        <img className="game-tracker-hero-logo" src={logoSrc} alt="" aria-hidden="true" />
        <div>
          <p className="game-tracker-eyebrow">LIVE SCORING + TEAM ANALYTICS</p>
          <h1>Game Tracker</h1>
          <p>Score every pitch, manage runners, and turn each game, scrimmage, or live BP into searchable season data.</p>
        </div>
      </section>
      <div className="game-tracker-hero-actions">
        <Link href="/portal/admin/game-tracker/stats" className="btn btn-primary as-link">Season Stats</Link>
      </div>

      <section className="game-tracker-grid game-tracker-grid--top">
        <article className="game-tracker-card game-tracker-card--new">
          <div className="game-tracker-card-heading"><span className="game-tracker-step">01</span><div><h2>Start a session</h2><p>Set the game context, then build the lineups.</p></div></div>
          <form action={createGame} className="game-tracker-form">
            <label>Type<select name="gameType" defaultValue="game"><option value="game">Game</option><option value="scrimmage">Scrimmage</option><option value="live_bp">Live BP</option></select></label>
            <label>Date<input name="gameDate" type="date" defaultValue={today} required /></label>
            <label>Season<input name="season" defaultValue={today.slice(0, 4)} required /></label>
            <label>Opponent / session<input name="opponentName" placeholder="Lake Erie or Green vs. White" required /></label>
            <label>Location<input name="location" placeholder="Optional" /></label>
            <label>Our side<select name="homeAway" defaultValue="home"><option value="home">Home</option><option value="away">Away</option></select></label>
            <label>Scheduled innings<input name="inningsScheduled" type="number" min="1" max="30" defaultValue="9" /></label>
            <button className="btn btn-primary game-tracker-submit" disabled={saving}>{saving ? 'Creating…' : 'Create & build lineup'}</button>
          </form>
          {error ? <p className="game-tracker-error" role="alert">{error}</p> : null}
        </article>

        <article className="game-tracker-card">
          <div className="game-tracker-card-heading"><span className="game-tracker-step">02</span><div><h2>Recent sessions</h2><p>Resume live scoring or review completed games.</p></div></div>
          <div className="game-tracker-game-list">
            {loading ? <p className="game-tracker-muted">Loading sessions…</p> : games.length === 0 ? <p className="game-tracker-empty">No sessions yet. Create the first one at left.</p> : games.map((game) => (
              <div key={game.id} className="game-tracker-game-row-wrap">
                <Link href={`/portal/admin/game-tracker/${game.id}`} className="game-tracker-game-row">
                  <span className={`game-tracker-status game-tracker-status--${game.status}`}>{game.status}</span>
                  <span><strong>{game.opponentName}</strong><small>{GAME_TYPE_LABELS[game.gameType]} · {game.gameDate}</small></span>
                  <span className="game-tracker-score">{game.state.score.us}<small>–</small>{game.state.score.opponent}</span>
                  <span aria-hidden>→</span>
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost game-tracker-game-row-delete"
                  disabled={deletingId === game.id}
                  onClick={() => void deleteGame(game.id)}
                >
                  {deletingId === game.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
