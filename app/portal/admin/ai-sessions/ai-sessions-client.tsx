'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './ai-sessions.module.css';

type Player = { playerId: number; fullName: string };
type Session = {
  id: number;
  title: string;
  sessionType: string;
  sourceKind: 'audio' | 'video';
  status: string;
  summaryBullets: string[];
  transcriptText: string;
  playerVisible: boolean;
  keepAudio: boolean;
  audioAvailable: boolean;
  playerIds: number[];
  playerNames: string[];
  createdAt: string;
  errorMessage: string | null;
};

const TYPES = ['Bullpen', 'Game/Postgame', 'Meeting', 'Assessment', 'Rehab', 'General'];

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>;
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" /></svg>;
}

function UploadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v5h14v-5" /></svg>;
}

export default function AiSessionsClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [sessionType, setSessionType] = useState('Bullpen');
  const [playerIds, setPlayerIds] = useState<number[]>([]);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [keepAudio, setKeepAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function load() {
    const [sessionsResponse, playersResponse] = await Promise.all([
      fetch('/api/ai/sessions', { cache: 'no-store' }),
      fetch('/api/admin/clients', { cache: 'no-store' }),
    ]);
    const sessionsPayload = await sessionsResponse.json();
    const playersPayload = await playersResponse.json();
    setSessions(sessionsPayload.sessions ?? []);
    setPlayers(playersPayload.players ?? []);
  }

  useEffect(() => { void load(); }, []);

  const filteredPlayers = useMemo(() => {
    const query = playerSearch.trim().toLowerCase();
    if (!query) return players;
    return players.filter((player) => player.fullName.toLowerCase().includes(query));
  }, [playerSearch, players]);

  const filteredSessions = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => `${session.title} ${session.sessionType} ${session.playerNames.join(' ')} ${session.summaryBullets.join(' ')}`.toLowerCase().includes(query));
  }, [librarySearch, sessions]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const nextRecorder = new MediaRecorder(stream);
      chunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || 'audio/webm' });
        setFile(new File([blob], `session-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.current = nextRecorder;
      nextRecorder.start(1000);
      setRecording(true);
      setMessage('Recording in progress…');
    } catch {
      setMessage('Microphone access was not available.');
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setMessage('Recording ready to process.');
  }

  function togglePlayer(playerId: number) {
    setPlayerIds((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);
  }

  async function create() {
    if (!file || !title.trim()) return setMessage('Add a title and recording first.');
    setBusy(true);
    setMessage('Uploading recording…');
    try {
      const presignResponse = await fetch('/api/ai/sessions/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presign.error);
      const upload = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': presign.contentType }, body: file });
      if (!upload.ok) throw new Error('Upload failed.');
      const createResponse = await fetch('/api/ai/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, sessionType, playerIds, playerVisible, keepAudio, r2Key: presign.r2Key, fileName: file.name, contentType: presign.contentType, sizeBytes: file.size, sourceKind: file.type.startsWith('video/') ? 'video' : 'audio' }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error);
      setMessage('Transcribing and writing the coaching summary…');
      const processResponse = await fetch(`/api/ai/sessions/${created.id}/process`, { method: 'POST' });
      const result = await processResponse.json();
      if (!processResponse.ok) throw new Error(result.error);
      setFile(null);
      setTitle('');
      setPlayerIds([]);
      setPlayerSearch('');
      setMessage(playerVisible ? 'Ready and shared to the associated player notes.' : 'Transcript and summary are ready.');
      await load();
      setOpenId(created.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Processing failed.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function save(item: Session) {
    setBusy(true);
    try {
      const response = await fetch('/api/ai/sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setMessage(item.playerVisible ? 'Session saved and player notes updated.' : 'Session saved.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm('Delete this transcript, summary, retained audio, and linked player notes?')) return;
    await fetch(`/api/ai/sessions?id=${id}`, { method: 'DELETE' });
    await load();
  }

  async function retry(id: number) {
    setBusy(true);
    setMessage('Retrying transcription…');
    try {
      const response = await fetch(`/api/ai/sessions/${id}/process`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setMessage('Transcript and summary are ready.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry failed.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Pearl Intelligence</span>
          <h2>Capture the session.<br /><span>Keep the coaching.</span></h2>
          <p>Record live or upload audio and video. Pearl turns it into a complete transcript and a clean set of coaching takeaways.</p>
        </div>
        <div className={styles.heroStats}>
          <div><strong>{sessions.length}</strong><span>Sessions</span></div>
          <div><strong>{sessions.filter((session) => session.status === 'ready').length}</strong><span>Ready</span></div>
          <div><strong>{sessions.filter((session) => session.playerVisible).length}</strong><span>Shared</span></div>
        </div>
      </section>

      <div className={styles.composerGrid}>
        <section className={styles.composer}>
          <div className={styles.sectionHeading}><span>01</span><div><h3>Session details</h3><p>Name it and choose the type of work.</p></div></div>
          <div className={styles.twoColumns}>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Bullpen with Logan" /></label>
            <label>Session type<select value={sessionType} onChange={(event) => setSessionType(event.target.value)}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          </div>

          <div className={styles.rule} />
          <div className={styles.sectionHeading}><span>02</span><div><h3>Add recording</h3><p>Use your microphone or choose an audio/video file.</p></div></div>
          <div className={styles.captureOptions}>
            <button type="button" className={`${styles.captureCard} ${recording ? styles.recording : ''}`} onClick={recording ? stopRecording : startRecording} disabled={busy}>
              <span className={styles.captureIcon}><MicIcon /></span><strong>{recording ? 'Stop recording' : 'Record audio'}</strong><small>{recording ? 'Recording now' : 'Use this device'}</small>
            </button>
            <label className={styles.captureCard}>
              <span className={styles.captureIcon}><UploadIcon /></span><strong>Upload a file</strong><small>Audio or video</small>
              <input type="file" accept="audio/*,video/*" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          {file ? <div className={styles.fileReady}><span>Ready</span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small><button type="button" onClick={() => setFile(null)}>Remove</button></div> : null}

          <div className={styles.rule} />
          <div className={styles.sectionHeading}><span>03</span><div><h3>Associate players</h3><p>Select everyone this session belongs to.</p></div></div>
          <div className={styles.playerPicker}>
            <label className={styles.searchField}><SearchIcon /><input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Search players…" /></label>
            <div className={styles.playerList}>
              {filteredPlayers.map((player) => <label key={player.playerId} className={playerIds.includes(player.playerId) ? styles.playerSelected : ''}><input type="checkbox" checked={playerIds.includes(player.playerId)} onChange={() => togglePlayer(player.playerId)} /><span>{player.fullName}</span></label>)}
            </div>
          </div>

          <div className={styles.sharingRow}>
            <label className={styles.setting}><input type="checkbox" checked={playerVisible} onChange={(event) => setPlayerVisible(event.target.checked)} /><span><strong>Share to player notes</strong><small>Add the finished summary and transcript to each selected player’s notes.</small></span></label>
            <label className={styles.setting}><input type="checkbox" checked={keepAudio} onChange={(event) => setKeepAudio(event.target.checked)} /><span><strong>Keep source audio</strong><small>Retain it beyond the standard 30-day window.</small></span></label>
          </div>
          <button className={styles.createButton} onClick={() => void create()} disabled={busy || recording || !file || !title.trim()}>{busy ? 'Processing session…' : 'Create transcript & summary'}<span>→</span></button>
          {message ? <p className={styles.statusMessage}>{message}</p> : null}
        </section>

        <aside className={styles.guide}>
          <span className={styles.guideMark}>AI</span>
          <h3>What Pearl captures</h3>
          <ul><li>Coaching cues and adjustments</li><li>Player feedback and intent</li><li>Measurements and pitch details</li><li>Decisions and next steps</li></ul>
          <div className={styles.privacy}><strong>Built for private coaching work</strong><p>Source recordings are discarded after processing unless you choose to retain the audio.</p></div>
        </aside>
      </div>

      <section className={styles.library}>
        <div className={styles.libraryHeader}><div><span className={styles.eyebrow}>Archive</span><h3>Session Library</h3></div><label className={styles.searchField}><SearchIcon /><input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search sessions, players, or summaries…" /></label></div>
        {filteredSessions.length === 0 ? <div className={styles.emptyState}><strong>No matching sessions</strong><span>Your processed sessions will appear here.</span></div> : <div className={styles.sessionList}>{filteredSessions.map((item) => <article className={styles.sessionCard} key={item.id}><button type="button" className={styles.sessionSummary} onClick={() => setOpenId(openId === item.id ? null : item.id)}><span className={`${styles.statusDot} ${styles[item.status] ?? ''}`} /><span className={styles.sessionMain}><strong>{item.title}</strong><small>{item.playerNames.join(', ') || 'Unassigned'} · {new Date(item.createdAt).toLocaleString()}</small></span><span className={styles.typeBadge}>{item.sessionType}</span><span className={styles.chevron}>{openId === item.id ? '−' : '+'}</span></button>{openId === item.id ? <SessionEditor item={item} busy={busy} onSave={save} onDelete={remove} onRetry={retry} /> : null}</article>)}</div>}
      </section>
    </div>
  );
}

function SessionEditor({ item, busy, onSave, onDelete, onRetry }: { item: Session; busy: boolean; onSave: (item: Session) => void; onDelete: (id: number) => void; onRetry: (id: number) => void }) {
  const [draft, setDraft] = useState(item);
  return <div className={styles.editor}>{draft.errorMessage ? <p className="auth-error">{draft.errorMessage}</p> : null}{draft.status === 'failed' ? <button className="btn btn-ghost" disabled={busy} onClick={() => onRetry(draft.id)}>Retry transcription</button> : null}{draft.audioAvailable ? <audio controls preload="metadata" src={`/api/ai/sessions/${draft.id}/audio`} /> : null}<div className={styles.editorGrid}><label>Summary bullets<textarea rows={8} value={draft.summaryBullets.map((bullet) => `• ${bullet}`).join('\n')} onChange={(event) => setDraft({ ...draft, summaryBullets: event.target.value.split('\n').map((line) => line.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean) })} /></label><label>Full transcript<textarea rows={14} value={draft.transcriptText} onChange={(event) => setDraft({ ...draft, transcriptText: event.target.value })} /></label></div><div className={styles.editorFooter}><div><label><input type="checkbox" checked={draft.playerVisible} onChange={(event) => setDraft({ ...draft, playerVisible: event.target.checked })} /> Share to player notes</label><label><input type="checkbox" checked={draft.keepAudio} onChange={(event) => setDraft({ ...draft, keepAudio: event.target.checked })} /> Keep audio</label></div><div><button className="btn btn-primary" disabled={busy} onClick={() => onSave(draft)}>Save edits</button><button className="btn btn-danger" disabled={busy} onClick={() => onDelete(draft.id)}>Delete</button></div></div></div>;
}
