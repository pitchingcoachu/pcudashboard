'use client';

import { useEffect, useMemo, useState } from 'react';
import { NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH, formatNoteAttachmentLimit } from '../../../lib/note-attachment-limits';

type Domain = 'Pitching' | 'Hitting' | 'Catching' | 'General';

type PlayerPlanNote = {
  id: number;
  playerId?: number;
  dashboardPlayerName?: string;
  domain: Domain;
  noteDate: string;
  category: string;
  noteText: string;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentDataUrl: string | null;
  createdAt: string;
};

type LinkedPlayerOption = {
  playerId: number;
  fullName: string;
};

type AttachmentPreview = {
  name: string;
  mimeType: string;
  dataUrl: string;
};
type NoteAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

const DEFAULT_NOTE_CATEGORIES = ['Player Plan', 'Weight Room', 'Nutrition', 'Mental Training', 'Grips'];
const MULTI_ATTACHMENT_MIME = 'application/x.pcu-note-attachments+json';
const NOTE_ATTACHMENT_LIMIT_LABEL = formatNoteAttachmentLimit();

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNameFirstLast(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, ...rest] = trimmed.split(',').map((part) => part.trim());
  const first = rest.join(' ').trim();
  if (!last || !first) return trimmed;
  return `${first} ${last}`;
}

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function uniqueCanonicalNames(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of values) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = normalizePersonName(trimmed);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (existing.includes(',') && !trimmed.includes(','))) map.set(key, trimmed);
  }
  return Array.from(map.values());
}

function uniqueDisplayNames(values: string[]): string[] {
  const byNormalized = new Map<string, string>();
  for (const raw of values) {
    const display = formatNameFirstLast(String(raw ?? '').trim());
    const key = normalizePersonName(display);
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, display);
  }
  return Array.from(byNormalized.values()).sort((a, b) => a.localeCompare(b));
}

function normalizePersonName(value: string): string {
  return formatNameFirstLast(String(value ?? ''))
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeDateOnly(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const direct = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveTypedPlayerInput(inputName: string, candidates: string[]): string {
  const typed = String(inputName ?? '').trim();
  if (!typed) return 'All';
  const exact = candidates.find((value) => value === typed);
  if (exact) return exact;
  const typedNorm = normalizePersonName(typed);
  const normalized = candidates.find((value) => normalizePersonName(value) === typedNorm);
  return normalized ?? typed;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function categoryBadgeStyle(category: string): React.CSSProperties {
  if (category === 'Player Plan') return { background: 'rgba(59,130,246,0.22)', color: '#bfdbfe' };
  if (category === 'Weight Room') return { background: 'rgba(249,115,22,0.2)', color: '#fdba74' };
  if (category === 'Nutrition') return { background: 'rgba(34,197,94,0.2)', color: '#86efac' };
  if (category === 'Mental Training') return { background: 'rgba(168,85,247,0.2)', color: '#d8b4fe' };
  return { background: 'rgba(14,165,233,0.2)', color: '#7dd3fc' };
}

function parseNoteAttachments(note: Pick<PlayerPlanNote, 'attachmentName' | 'attachmentMimeType' | 'attachmentDataUrl'>): NoteAttachment[] {
  const dataUrl = String(note.attachmentDataUrl ?? '').trim();
  const mimeType = String(note.attachmentMimeType ?? '').trim();
  const attachmentName = String(note.attachmentName ?? '').trim();
  if (!dataUrl) return [];
  if (mimeType === MULTI_ATTACHMENT_MIME || dataUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(dataUrl) as Array<{ name?: string; mimeType?: string; dataUrl?: string }>;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => ({
          name: String(entry?.name ?? '').trim() || 'attachment',
          mimeType: String(entry?.mimeType ?? '').trim(),
          dataUrl: String(entry?.dataUrl ?? '').trim(),
        }))
        .filter((entry) => entry.dataUrl.length > 0);
    } catch {
      return [];
    }
  }
  return [{ name: attachmentName || 'attachment', mimeType, dataUrl }];
}

function encodeAttachmentsForApi(files: NoteAttachment[]): {
  attachmentName: string;
  attachmentMimeType: string;
  attachmentDataUrl: string;
} {
  if (!files.length) return { attachmentName: '', attachmentMimeType: '', attachmentDataUrl: '' };
  if (files.length === 1) {
    const only = files[0];
    return {
      attachmentName: only.name,
      attachmentMimeType: only.mimeType,
      attachmentDataUrl: only.dataUrl,
    };
  }
  return {
    attachmentName: `${files.length} attachments`,
    attachmentMimeType: MULTI_ATTACHMENT_MIME,
    attachmentDataUrl: JSON.stringify(files),
  };
}

function estimateDataUrlLength(file: File): number {
  const metadataLength = `data:${file.type || 'application/octet-stream'};base64,`.length;
  return metadataLength + Math.ceil(file.size / 3) * 4;
}

function validateSelectedAttachments(files: File[]): string {
  const estimatedLength = files.reduce((sum, file) => sum + estimateDataUrlLength(file), 0);
  if (files.length > 1) {
    const jsonOverhead = files.reduce((sum, file) => sum + file.name.length + file.type.length + 48, 2);
    if (estimatedLength + jsonOverhead > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
      return `Attachments are too large. Please keep uploads under ${NOTE_ATTACHMENT_LIMIT_LABEL}.`;
    }
  } else if (estimatedLength > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
    return `Attachment is too large. Please keep uploads under ${NOTE_ATTACHMENT_LIMIT_LABEL}.`;
  }
  return '';
}

export default function PlayerNotesSuite() {
  const [dashboardPlayerOptions, setDashboardPlayerOptions] = useState<string[]>([]);
  const [linkedPlayers, setLinkedPlayers] = useState<LinkedPlayerOption[]>([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('All');
  const [playerInputName, setPlayerInputName] = useState('All');
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<PlayerPlanNote[]>([]);
  const [noteDate, setNoteDate] = useState(todayIsoDate());
  const [noteCategory, setNoteCategory] = useState('Player Plan');
  const [noteText, setNoteText] = useState('');
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [filterCategory, setFilterCategory] = useState('All');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [newCategoryDraft, setNewCategoryDraft] = useState('');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchText, setSearchText] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const categoryOptions = useMemo(
    () => uniqueNames([...DEFAULT_NOTE_CATEGORIES, ...customCategories, ...notes.map((note) => note.category)]),
    [customCategories, notes]
  );
  const selectedLinkedPlayerId = useMemo(() => {
    const selectedNorm = normalizePersonName(selectedPlayerName);
    if (!selectedNorm || selectedPlayerName === 'All') return 0;
    const match = linkedPlayers.find((player) => normalizePersonName(player.fullName) === selectedNorm);
    return Number(match?.playerId ?? 0);
  }, [linkedPlayers, selectedPlayerName]);
  const commitPlayerInput = () => {
    const resolved = resolveTypedPlayerInput(playerInputName, dashboardPlayerOptions);
    const match = dashboardPlayerOptions.find((name) => normalizePersonName(name) === normalizePersonName(resolved));
    const next = match ?? 'All';
    setSelectedPlayerName(next);
    setPlayerInputName(next);
  };
  useEffect(() => {
    setPlayerInputName(selectedPlayerName);
  }, [selectedPlayerName]);

  useEffect(() => {
    let active = true;
    setLoadingPlayers(true);
    Promise.all([
      fetch('/api/dashboard/player-plans/domain-players?domain=Pitching', { cache: 'no-store' }),
      fetch('/api/dashboard/player-plans/domain-players?domain=Hitting', { cache: 'no-store' }),
      fetch('/api/dashboard/player-plans/domain-players?domain=Catching', { cache: 'no-store' }),
      fetch('/api/dashboard/player-plans/players', { cache: 'no-store' }),
    ])
      .then(async (responses) => {
        const payloads = await Promise.all(
          responses.slice(0, 3).map(async (response) => {
            const payload = (await response.json().catch(() => ({}))) as { players?: string[] };
            return response.ok ? payload : { players: [] };
          })
        );
        const linkedPayload = (await responses[3].json().catch(() => ({}))) as { players?: Array<{ playerId: number; fullName: string }> };
        if (!active) return;
        const linked = Array.isArray(linkedPayload.players)
          ? linkedPayload.players
              .map((player) => String(player?.fullName ?? '').trim())
              .filter(Boolean)
          : [];
        const combined = uniqueDisplayNames(uniqueCanonicalNames([...payloads.flatMap((payload) => payload.players ?? []), ...linked]));
        const options = ['All', ...combined];
        setDashboardPlayerOptions(options);
        setLinkedPlayers(
          Array.isArray(linkedPayload.players)
            ? linkedPayload.players
                .map((player) => ({ playerId: Number(player.playerId ?? 0), fullName: String(player.fullName ?? '').trim() }))
                .filter((player) => player.playerId > 0 && player.fullName.length > 0)
            : []
        );
        setSelectedPlayerName((current) => (options.includes(current) ? current : 'All'));
      })
      .catch(() => {
        if (!active) return;
        setDashboardPlayerOptions(['All']);
        setLinkedPlayers([]);
        setSelectedPlayerName('All');
      })
      .finally(() => {
        if (!active) return;
        setLoadingPlayers(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPlayerName.trim()) {
      setNotes([]);
      return;
    }
    let active = true;
    setLoadingNotes(true);
    const notesUrl =
      selectedPlayerName === 'All'
        ? '/api/player/plan-notes?domain=General'
        : selectedLinkedPlayerId > 0
          ? `/api/player/plan-notes?domain=General&playerId=${selectedLinkedPlayerId}`
          : `/api/player/plan-notes?domain=General&dashboardPlayerName=${encodeURIComponent(selectedPlayerName)}`;
    fetch(notesUrl, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { notes?: PlayerPlanNote[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load notes.');
        if (!active) return;
        setNotes(Array.isArray(payload.notes) ? payload.notes : []);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Failed to load notes.');
      })
      .finally(() => {
        if (active) setLoadingNotes(false);
      });
    return () => {
      active = false;
    };
  }, [selectedLinkedPlayerId, selectedPlayerName]);

  useEffect(() => {
    if (!notes.length) {
      setFilterStartDate('');
      setFilterEndDate('');
      return;
    }
    const dates = notes.map((note) => normalizeDateOnly(note.noteDate)).filter(Boolean).sort();
    if (!dates.length) {
      setFilterStartDate('');
      setFilterEndDate('');
      return;
    }
    setFilterStartDate(dates[0]);
    setFilterEndDate(dates[dates.length - 1]);
  }, [notes]);

  async function saveNote() {
    if (!selectedPlayerName.trim()) {
      setMessage('Select a player first.');
      return;
    }
    if (selectedPlayerName === 'All') {
      setMessage('Select a specific player to save notes.');
      return;
    }
    if (!noteText.trim()) return;
    const attachmentError = validateSelectedAttachments(noteFiles);
    if (attachmentError) {
      setMessage(attachmentError);
      return;
    }
    setMessage('');
    try {
      const attachments: NoteAttachment[] = await Promise.all(
        noteFiles.map(async (file) => ({
          name: file.name,
          mimeType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        }))
      );
      const encoded = encodeAttachmentsForApi(attachments);
      if (encoded.attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
        setMessage(`Attachments are too large. Please keep uploads under ${NOTE_ATTACHMENT_LIMIT_LABEL}.`);
        return;
      }
      const response = await fetch('/api/player/plan-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: selectedLinkedPlayerId > 0 ? selectedLinkedPlayerId : undefined,
          dashboardPlayerName: selectedLinkedPlayerId > 0 ? undefined : selectedPlayerName,
          domain: 'General',
          noteDate,
          category: noteCategory,
          noteText: noteText.trim(),
          attachmentName: encoded.attachmentName,
          attachmentMimeType: encoded.attachmentMimeType,
          attachmentDataUrl: encoded.attachmentDataUrl,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; notes?: PlayerPlanNote[] };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save note.');
      setNotes(Array.isArray(payload.notes) ? payload.notes : []);
      setCustomCategories((current) => uniqueNames([...current, noteCategory]));
      setNoteText('');
      setNoteFiles([]);
      setMessage('Note saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save note.');
    }
  }

  async function saveEditedNote(note: PlayerPlanNote) {
    if (!editingText.trim()) {
      setMessage('Note text is required.');
      return;
    }
    setMessage('');
    try {
      const response = await fetch('/api/player/plan-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: note.id,
          playerId: note.playerId,
          noteDate: note.noteDate,
          category: note.category,
          noteText: editingText.trim(),
          attachmentName: note.attachmentName ?? '',
          attachmentMimeType: note.attachmentMimeType ?? '',
          attachmentDataUrl: note.attachmentDataUrl ?? '',
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update note.');
      setEditingNoteId(null);
      setNotes((current) =>
        current.map((item) =>
          item.id === note.id
            ? {
                ...item,
                noteText: editingText.trim(),
              }
            : item
        )
      );
      setMessage('Note updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update note.');
    }
  }

  async function deleteNote(note: PlayerPlanNote) {
    setMessage('');
    try {
      const params = new URLSearchParams({ noteId: String(note.id) });
      if (note.playerId && note.playerId > 0) params.set('playerId', String(note.playerId));
      const response = await fetch(`/api/player/plan-notes?${params.toString()}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete note.');
      if (editingNoteId === note.id) setEditingNoteId(null);
      setNotes((current) =>
        current.filter((item) => !(item.id === note.id && Number(item.playerId ?? 0) === Number(note.playerId ?? 0)))
      );
      setMessage('Note deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete note.');
    }
  }

  const filteredNotes = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const startDate = normalizeDateOnly(filterStartDate);
    const endDate = normalizeDateOnly(filterEndDate);
    return notes.filter((note) => {
      const noteDate = normalizeDateOnly(note.noteDate);
      if (filterCategory !== 'All' && note.category !== filterCategory) return false;
      if (startDate && noteDate && noteDate < startDate) return false;
      if (endDate && noteDate && noteDate > endDate) return false;
      if (!query) return true;
      const text = `${note.noteText} ${note.category} ${note.attachmentName ?? ''} ${note.dashboardPlayerName ?? ''}`.toLowerCase();
      return text.includes(query);
    });
  }, [notes, filterCategory, filterStartDate, filterEndDate, searchText]);

  const notesByDate = useMemo(() => {
    const grouped = new Map<string, PlayerPlanNote[]>();
    for (const note of filteredNotes) {
      if (!grouped.has(note.noteDate)) grouped.set(note.noteDate, []);
      grouped.get(note.noteDate)?.push(note);
    }
    return Array.from(grouped.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredNotes]);

  const noteCountsByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categoryOptions) counts.set(category, 0);
    for (const note of notes) counts.set(note.category, (counts.get(note.category) ?? 0) + 1);
    return counts;
  }, [categoryOptions, notes]);

  const handleCategorySelect = (value: string) => {
    if (value === '__add_new__') {
      setShowNewCategoryInput(true);
      return;
    }
    setShowNewCategoryInput(false);
    setNoteCategory(value || 'Player Plan');
  };

  const commitNewCategory = () => {
    const trimmed = newCategoryDraft.trim();
    if (!trimmed) return;
    setCustomCategories((current) => uniqueNames([...current, trimmed]));
    setNoteCategory(trimmed);
    setNewCategoryDraft('');
    setShowNewCategoryInput(false);
  };

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <div style={{ display: 'grid', gap: 12 }}>
        <article className="portal-admin-card">
          <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))' }}>
            <label>
              Player
              <input
                list="player-notes-player-options"
                value={playerInputName}
                onChange={(event) => setPlayerInputName(event.target.value)}
                onBlur={commitPlayerInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitPlayerInput();
                  }
                }}
                placeholder={dashboardPlayerOptions.length ? 'Type or choose player...' : 'No players available'}
              />
              <datalist id="player-notes-player-options">
                {dashboardPlayerOptions.map((playerName) => (
                  <option key={playerName} value={playerName} />
                ))}
              </datalist>
            </label>
            <label>
              Search Notes
              <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search text, category, attachment..." />
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {categoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                className={filterCategory === category ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setFilterCategory((current) => (current === category ? 'All' : category))}
              >
                {`${category} (${noteCountsByCategory.get(category) ?? 0})`}
              </button>
            ))}
            <button type="button" className={filterCategory === 'All' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilterCategory('All')}>
              All
            </button>
          </div>
        </article>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(420px, 560px) minmax(0, 1fr)', alignItems: 'start' }}>
          <article className="portal-admin-card" style={{ position: 'sticky', top: 8 }}>
            <h3 style={{ marginTop: 0 }}>New Note</h3>
            <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                Date
                <input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} />
              </label>
              <label>
                Category
                <select value={noteCategory} onChange={(event) => handleCategorySelect(event.target.value)}>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value="__add_new__">+ Add New Category</option>
                </select>
              </label>
            </div>
            {showNewCategoryInput ? (
              <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr auto auto', gap: 8, marginTop: 8 }}>
                <label style={{ marginBottom: 0 }}>
                  Add New Category
                  <input
                    value={newCategoryDraft}
                    onChange={(event) => setNewCategoryDraft(event.target.value)}
                    placeholder="e.g. Bullpen Notes"
                  />
                </label>
                <div style={{ display: 'grid', alignContent: 'end' }}>
                  <button type="button" className="btn btn-ghost" onClick={commitNewCategory}>
                    Add
                  </button>
                </div>
                <div style={{ display: 'grid', alignContent: 'end' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowNewCategoryInput(false);
                      setNewCategoryDraft('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <label className="portal-inline-filter" style={{ marginTop: 8 }}>
              Attachment (Photo/Video/PDF)
              <input
                type="file"
                accept="image/*,video/*,application/pdf"
                multiple
                onChange={(event) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  setNoteFiles(files);
                  const attachmentError = validateSelectedAttachments(files);
                  if (attachmentError) setMessage(attachmentError);
                  else if (message.includes('too large')) setMessage('');
                }}
              />
            </label>
            <label className="portal-inline-filter" style={{ marginTop: 8 }}>
              Note
              <textarea rows={8} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Write note..." />
            </label>
            <div className="portal-choice-line-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveNote()}
                disabled={!selectedPlayerName.trim() || selectedPlayerName === 'All' || !noteText.trim()}
              >
                Save Note
              </button>
            </div>
            {!selectedPlayerName.trim() ? <p className="portal-muted-text" style={{ margin: 0 }}>Select a player to save notes.</p> : null}
            {selectedPlayerName === 'All' ? <p className="portal-muted-text" style={{ margin: 0 }}>Select a specific player to save notes.</p> : null}
            {noteFiles.length > 0 ? (
              <div className="portal-muted-text" style={{ margin: 0 }}>
                {noteFiles.map((file) => file.name).join(', ')}
                {` (${NOTE_ATTACHMENT_LIMIT_LABEL} max)`}
              </div>
            ) : null}
            {message ? <p className={message.includes('Failed') || message.includes('Unauthorized') ? 'auth-error' : 'auth-message'}>{message}</p> : null}
          </article>

          <article className="portal-admin-card">
            <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))' }}>
              <label>
                Category Filter
                <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value || 'All')}>
                  <option value="All">All</option>
                  {categoryOptions.map((category) => (
                    <option key={`filter-${category}`} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Date
                <input type="date" value={filterStartDate} onChange={(event) => setFilterStartDate(event.target.value)} />
              </label>
              <label>
                End Date
                <input type="date" value={filterEndDate} onChange={(event) => setFilterEndDate(event.target.value)} />
              </label>
            </div>
            {loadingPlayers || loadingNotes ? <p className="portal-muted-text">Loading notes...</p> : null}
            {!notesByDate.length ? (
              <p className="portal-muted-text">No notes match your filters.</p>
            ) : (
              <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
                {notesByDate.map(([noteDateKey, dayNotes]) => (
                  <section key={`notes-day-${noteDateKey}`} className="portal-day-card" style={{ borderLeft: '3px solid rgba(239,68,68,0.7)' }}>
                    <div className="portal-row-between" style={{ marginBottom: 6 }}>
                      <h4 style={{ margin: 0 }}>{new Date(`${noteDateKey}T00:00:00Z`).toLocaleDateString()}</h4>
                      <span className="portal-muted-text">{`${dayNotes.length} note${dayNotes.length === 1 ? '' : 's'}`}</span>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {dayNotes.map((note) => (
                        <article key={`note-${note.playerId ?? 'dashboard'}-${note.id}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.16)' }}>
                          <div className="portal-row-between" style={{ alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {selectedPlayerName === 'All' ? (
                                <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
                                  {formatNameFirstLast(note.dashboardPlayerName ?? '')}
                                </span>
                              ) : null}
                              <span style={{ ...categoryBadgeStyle(note.category), borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
                                {note.category}
                              </span>
                            </div>
                            {parseNoteAttachments(note).length > 0 ? (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {parseNoteAttachments(note).map((attachment, idx) => (
                                  <button
                                    key={`att-${note.id}-${idx}`}
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => setAttachmentPreview(attachment)}
                                  >
                                    {parseNoteAttachments(note).length > 1 ? `Attachment ${idx + 1}` : 'Open Attachment'}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {editingNoteId === note.id ? (
                            <textarea
                              rows={5}
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                              style={{
                                marginTop: 12,
                                marginBottom: 18,
                                color: '#ffffff',
                                width: '100%',
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: 8,
                                padding: 8,
                                fontSize: 16,
                                lineHeight: 1.45,
                              }}
                            />
                          ) : (
                            <p style={{ margin: '12px 0 18px 0', whiteSpace: 'pre-wrap', color: '#ffffff' }}>{note.noteText}</p>
                          )}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            {editingNoteId === note.id ? (
                              <>
                                <button type="button" className="btn btn-primary" onClick={() => void saveEditedNote(note)}>
                                  Save
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={() => setEditingNoteId(null)}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditingText(note.noteText);
                                }}
                              >
                                Edit
                              </button>
                            )}
                            <button type="button" className="btn btn-ghost" onClick={() => void deleteNote(note)}>
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </article>
        </div>
        {attachmentPreview ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setAttachmentPreview(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              background: 'rgba(0,0,0,0.72)',
              display: 'grid',
              placeItems: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 'min(960px, 96vw)',
                maxHeight: '92vh',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.2)',
                background: '#0b1220',
                padding: 12,
                display: 'grid',
                gap: 10,
              }}
            >
              <div className="portal-row-between" style={{ alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>{attachmentPreview.name}</h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="btn btn-ghost" href={attachmentPreview.dataUrl} download={attachmentPreview.name}>
                    Download
                  </a>
                  <button type="button" className="btn btn-ghost" onClick={() => setAttachmentPreview(null)}>
                    Close
                  </button>
                </div>
              </div>
              <div style={{ overflow: 'auto', maxHeight: 'calc(92vh - 72px)' }}>
                {attachmentPreview.mimeType.startsWith('image/') ? (
                  <img src={attachmentPreview.dataUrl} alt={attachmentPreview.name} style={{ width: '100%', borderRadius: 8 }} />
                ) : attachmentPreview.mimeType.startsWith('video/') ? (
                  <video src={attachmentPreview.dataUrl} controls style={{ width: '100%', borderRadius: 8 }} />
                ) : attachmentPreview.mimeType.includes('pdf') ? (
                  <iframe title={attachmentPreview.name} src={attachmentPreview.dataUrl} style={{ width: '100%', height: '70vh', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8 }} />
                ) : (
                  <a className="btn btn-ghost" href={attachmentPreview.dataUrl} target="_blank" rel="noreferrer">
                    Open Attachment
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
