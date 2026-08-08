'use client';

import { useEffect, useMemo, useState } from 'react';
import NativeDateInput from '../components/native-date-input';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';

type NoteAttachment = {
  id: number;
  mediaType: 'photo' | 'video' | 'pdf';
  title: string;
  fileName: string;
  contentType: string;
};

type PlayerPlanNote = {
  id: number;
  playerId: number;
  domain: 'Pitching' | 'Hitting' | 'Catching' | 'General';
  noteDate: string;
  category: string;
  noteText: string;
  playerVisible: boolean;
  createdAt: string;
  createdByUserId: number | null;
  attachments?: NoteAttachment[];
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function attachmentIcon(mediaType: NoteAttachment['mediaType']): string {
  if (mediaType === 'video') return '🎬';
  if (mediaType === 'pdf') return '📄';
  return '🖼️';
}

export default function PlayerOwnNotes({ playerId, currentUserId }: { playerId: number; currentUserId: number | null }) {
  const [notes, setNotes] = useState<PlayerPlanNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [noteDate, setNoteDate] = useState(todayIsoDate());
  const [noteText, setNoteText] = useState('');
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function loadNotes() {
    setLoading(true);
    try {
      const response = await fetch(`/api/player/plan-notes?domain=General&playerId=${playerId}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { notes?: PlayerPlanNote[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load notes.');
      setNotes(Array.isArray(payload.notes) ? payload.notes : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load notes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => (b.noteDate === a.noteDate ? b.createdAt.localeCompare(a.createdAt) : b.noteDate.localeCompare(a.noteDate))),
    [notes]
  );

  async function saveNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      const mediaIds: number[] = [];
      for (const file of noteFiles) {
        const result = await uploadPlayerMediaFile({
          playerId,
          file,
          title: file.name.replace(/\.[^.]+$/, '') || file.name,
          category: 'Player Note',
          sourceType: 'player_self_note',
          sourceLabel: `Note - ${noteDate}`,
        });
        if (!result.ok) throw new Error(result.error);
        const created = result.createdMedia as { id?: number } | undefined;
        if (created?.id) mediaIds.push(created.id);
      }

      const response = await fetch('/api/player/plan-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          domain: 'General',
          noteDate,
          category: 'Player Note',
          noteText: noteText.trim(),
          mediaIds,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; notes?: PlayerPlanNote[] };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save note.');
      setNotes(Array.isArray(payload.notes) ? payload.notes : []);
      setNoteText('');
      setNoteFiles([]);
      setMessage('Note saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save note.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteOwnNote(note: PlayerPlanNote) {
    if (!window.confirm('Delete this note?')) return;
    try {
      const params = new URLSearchParams({ noteId: String(note.id), playerId: String(playerId) });
      const response = await fetch(`/api/player/plan-notes?${params.toString()}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete note.');
      setNotes((current) => current.filter((item) => item.id !== note.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete note.');
    }
  }

  return (
    <article className="portal-admin-card">
      <h3 style={{ marginTop: 0 }}>Notes</h3>
      <p className="portal-muted-text" style={{ marginTop: 0 }}>
        Notes you write here are visible to your coaches. Notes from your coaches marked visible to you also show up here.
      </p>

      <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label>
          Date <NativeDateInput value={noteDate} onChange={setNoteDate} ariaLabel="Date" />
        </label>
      </div>
      <label className="portal-inline-filter" style={{ marginTop: 8 }}>
        Attachments (Photos/Videos/PDFs)
        <input
          type="file"
          accept="image/*,video/*,application/pdf,.pdf"
          multiple
          onChange={(event) => setNoteFiles(event.target.files ? Array.from(event.target.files) : [])}
        />
      </label>
      <label className="portal-inline-filter" style={{ marginTop: 8 }}>
        Note
        <textarea rows={5} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Write a note..." />
      </label>
      <div className="portal-choice-line-actions">
        <button type="button" className="btn btn-primary" onClick={() => void saveNote()} disabled={saving || !noteText.trim()}>
          {saving ? 'Saving...' : 'Save Note'}
        </button>
      </div>
      {message ? <p className="portal-muted-text" style={{ margin: 0 }}>{message}</p> : null}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? <p className="portal-muted-text">Loading notes...</p> : null}
        {!loading && sortedNotes.length === 0 ? <p className="portal-muted-text">No notes yet.</p> : null}
        {sortedNotes.map((note) => {
          const isOwn = note.createdByUserId !== null && note.createdByUserId === currentUserId;
          return (
            <article key={note.id} className="portal-admin-card" style={{ padding: 12 }}>
              <div className="portal-row-between">
                <small className="portal-muted-text">{note.noteDate}</small>
                <small className="portal-muted-text">{isOwn ? 'You' : 'Coach'}</small>
              </div>
              <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{note.noteText}</p>
              {note.attachments && note.attachments.length > 0 ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {note.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={`/api/player/media/${attachment.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost"
                    >
                      {attachmentIcon(attachment.mediaType)} {attachment.title}
                    </a>
                  ))}
                </div>
              ) : null}
              {isOwn ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => void deleteOwnNote(note)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </article>
  );
}
