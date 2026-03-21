'use client';

import { useEffect, useMemo, useState } from 'react';

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

type AttachmentPreview = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

const DEFAULT_NOTE_CATEGORIES = ['Player Plan', 'Weight Room', 'Nutrition', 'Mental Training', 'Grips'];

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
  const [last, first] = trimmed.split(',').map((part) => part.trim());
  if (!last || !first) return trimmed;
  return `${first} ${last}`;
}

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
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

export default function PlayerNotesSuite() {
  const [dashboardPlayerOptions, setDashboardPlayerOptions] = useState<string[]>([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState('All');
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<PlayerPlanNote[]>([]);
  const [noteDate, setNoteDate] = useState(todayIsoDate());
  const [noteCategory, setNoteCategory] = useState('Player Plan');
  const [noteText, setNoteText] = useState('');
  const [noteFile, setNoteFile] = useState<File | null>(null);
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

  useEffect(() => {
    let active = true;
    setLoadingPlayers(true);
    Promise.all([
      fetch('/api/dashboard/player-plans/domain-players?domain=Pitching', { cache: 'no-store' }),
      fetch('/api/dashboard/player-plans/domain-players?domain=Hitting', { cache: 'no-store' }),
      fetch('/api/dashboard/player-plans/domain-players?domain=Catching', { cache: 'no-store' }),
    ])
      .then(async (responses) => {
        const payloads = await Promise.all(
          responses.map(async (response) => {
            const payload = (await response.json().catch(() => ({}))) as { players?: string[] };
            return response.ok ? payload : { players: [] };
          })
        );
        if (!active) return;
        const combined = uniqueNames(payloads.flatMap((payload) => payload.players ?? []));
        const options = ['All', ...combined];
        setDashboardPlayerOptions(options);
        setSelectedPlayerName((current) => (options.includes(current) ? current : 'All'));
      })
      .catch(() => {
        if (!active) return;
        setDashboardPlayerOptions(['All']);
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
  }, [selectedPlayerName]);

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
    setMessage('');
    try {
      const attachmentDataUrl = noteFile ? await readFileAsDataUrl(noteFile) : '';
      const response = await fetch('/api/player/plan-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dashboardPlayerName: selectedPlayerName,
          domain: 'General',
          noteDate,
          category: noteCategory,
          noteText: noteText.trim(),
          attachmentName: noteFile?.name ?? '',
          attachmentMimeType: noteFile?.type ?? '',
          attachmentDataUrl,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; notes?: PlayerPlanNote[] };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save note.');
      setNotes(Array.isArray(payload.notes) ? payload.notes : []);
      setCustomCategories((current) => uniqueNames([...current, noteCategory]));
      setNoteText('');
      setNoteFile(null);
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

  async function deleteNote(noteId: number) {
    setMessage('');
    try {
      const response = await fetch(`/api/player/plan-notes?noteId=${noteId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete note.');
      if (editingNoteId === noteId) setEditingNoteId(null);
      setNotes((current) => current.filter((note) => note.id !== noteId));
      setMessage('Note deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete note.');
    }
  }

  const filteredNotes = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return notes.filter((note) => {
      if (filterCategory !== 'All' && note.category !== filterCategory) return false;
      if (filterStartDate && note.noteDate < filterStartDate) return false;
      if (filterEndDate && note.noteDate > filterEndDate) return false;
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
              <select value={selectedPlayerName} onChange={(event) => setSelectedPlayerName(event.target.value)}>
                {!dashboardPlayerOptions.length ? <option value="">No players available</option> : null}
                {dashboardPlayerOptions.map((playerName) => (
                  <option key={playerName} value={playerName}>
                    {formatNameFirstLast(playerName)}
                  </option>
                ))}
              </select>
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
                onChange={(event) => setNoteFile(event.target.files && event.target.files[0] ? event.target.files[0] : null)}
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
            {noteFile ? <p className="portal-muted-text" style={{ margin: 0 }}>{`Attached: ${noteFile.name}`}</p> : null}
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
                        <article key={`note-${note.id}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.16)' }}>
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
                            {note.attachmentDataUrl ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  setAttachmentPreview({
                                    name: note.attachmentName ?? 'attachment',
                                    mimeType: note.attachmentMimeType ?? '',
                                    dataUrl: note.attachmentDataUrl ?? '',
                                  })
                                }
                              >
                                Open Attachment
                              </button>
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
                            <button type="button" className="btn btn-ghost" onClick={() => void deleteNote(note.id)}>
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
