'use client';

import { useEffect, useMemo, useState } from 'react';
import MediaBreakdownViewer, { type BreakdownAnnotation } from '../components/media-breakdown-viewer';
import NativeDateInput from '../components/native-date-input';
import { NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH, formatNoteAttachmentLimit } from '../../../lib/note-attachment-limits';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';

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
  breakdownAnnotations?: BreakdownAnnotation[];
};
type NoteAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
  mediaId?: number;
  breakdownAnnotations?: BreakdownAnnotation[];
};
type PlayerMedia = {
  id: number;
  mediaType: 'photo' | 'video' | 'pdf';
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sourceType: string | null;
  sourceLabel: string | null;
  createdAt: string;
  breakdownAnnotations?: BreakdownAnnotation[];
};
type MediaPreview = {
  id: string;
  title: string;
  url: string;
  mimeType: string;
  downloadName: string;
  initialAnnotations: BreakdownAnnotation[];
  saveAnnotations?: (annotations: BreakdownAnnotation[]) => Promise<void>;
  deleteMedia?: () => Promise<void> | void;
};
type MediaGalleryItem = MediaPreview;

type PlayerNotesSuiteProps = {
  fixedPlayer?: {
    playerId: number;
    fullName: string;
  } | null;
  embedded?: boolean;
};

function MediaTileFallback({ label }: { label: string }) {
  return (
    <span className="portal-media-tile-fallback">
      <span className="portal-media-tile-fallback-icon" aria-hidden="true">
        {label === 'PDF' ? 'PDF' : label === 'Video' ? 'VID' : 'IMG'}
      </span>
      <span>{label}</span>
    </span>
  );
}

function MediaTilePreview({ url, title, mimeType }: { url: string; title: string; mimeType: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalized = String(mimeType ?? '').toLowerCase();
  const isUnsupportedImagePreview = normalized.includes('heic') || normalized.includes('heif');
  if (normalized.startsWith('image/')) {
    if (isUnsupportedImagePreview || imageFailed) return <MediaTileFallback label="Photo" />;
    return <img src={url} alt={title} className="portal-media-tile-preview-media" loading="lazy" onError={() => setImageFailed(true)} />;
  }
  if (normalized.startsWith('video/')) {
    return <video src={url} className="portal-media-tile-preview-media" muted playsInline preload="metadata" />;
  }
  if (normalized === 'application/pdf') {
    return (
      <>
        <iframe title={`${title} preview`} src={`${url}#toolbar=0&navpanes=0&scrollbar=0&page=1`} className="portal-media-tile-preview-media portal-media-tile-preview-pdf" />
        <span className="portal-media-tile-badge">PDF</span>
      </>
    );
  }
  return <MediaTileFallback label="File" />;
}

const DEFAULT_NOTE_CATEGORIES = ['Player Plan', 'Weight Room', 'Nutrition', 'Mental Training', 'Grips', 'Questionnaires'];
const MULTI_ATTACHMENT_MIME = 'application/x.pcu-note-attachments+json';
const NOTE_ATTACHMENT_LIMIT_LABEL = formatNoteAttachmentLimit();
const PLAYER_MEDIA_LIMIT_BYTES = 350 * 1024 * 1024;
const PLAYER_MEDIA_LIMIT_LABEL = '350 MB';

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
  if (category === 'Questionnaires') return { background: 'rgba(20,184,166,0.2)', color: '#5eead4' };
  return { background: 'rgba(14,165,233,0.2)', color: '#7dd3fc' };
}

function parseNoteAttachments(note: Pick<PlayerPlanNote, 'attachmentName' | 'attachmentMimeType' | 'attachmentDataUrl'>): NoteAttachment[] {
  const dataUrl = String(note.attachmentDataUrl ?? '').trim();
  const mimeType = String(note.attachmentMimeType ?? '').trim();
  const attachmentName = String(note.attachmentName ?? '').trim();
  if (!dataUrl) return [];
  if (mimeType === MULTI_ATTACHMENT_MIME || dataUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(dataUrl) as Array<{ name?: string; mimeType?: string; dataUrl?: string; mediaId?: unknown; breakdownAnnotations?: unknown }>;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => ({
          name: String(entry?.name ?? '').trim() || 'attachment',
          mimeType: String(entry?.mimeType ?? '').trim(),
          dataUrl: String(entry?.dataUrl ?? '').trim(),
          mediaId: Number(entry?.mediaId ?? 0) > 0 ? Number(entry?.mediaId ?? 0) : undefined,
          breakdownAnnotations: Array.isArray(entry?.breakdownAnnotations) ? entry.breakdownAnnotations as BreakdownAnnotation[] : [],
        }))
        .filter((entry) => entry.dataUrl.length > 0);
    } catch {
      return [];
    }
  }
  const mediaMatch = dataUrl.match(/^\/api\/player\/media\/(\d+)$/);
  return [{
    name: attachmentName || 'attachment',
    mimeType,
    dataUrl,
    mediaId: mediaMatch ? Number(mediaMatch[1]) : undefined,
    breakdownAnnotations: [],
  }];
}

function encodeAttachmentsForApi(files: NoteAttachment[]): {
  attachmentName: string;
  attachmentMimeType: string;
  attachmentDataUrl: string;
} {
  if (!files.length) return { attachmentName: '', attachmentMimeType: '', attachmentDataUrl: '' };
  const hasAnnotations = files.some((file) => Array.isArray(file.breakdownAnnotations) && file.breakdownAnnotations.length > 0);
  if (files.length === 1 && !hasAnnotations) {
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

function getPlayerMediaFromUploadResult(result: { media: unknown[]; createdMedia?: unknown }, file: File): PlayerMedia | null {
  const created = result.createdMedia;
  if (created && typeof created === 'object') return created as PlayerMedia;
  return (result.media as PlayerMedia[]).find((media) => media.fileName === file.name && Number(media.sizeBytes) === file.size) ?? null;
}

function encodePlayerMediaAsNoteAttachments(media: PlayerMedia[]): {
  attachmentName: string;
  attachmentMimeType: string;
  attachmentDataUrl: string;
} {
  const attachments: NoteAttachment[] = media.map((item) => ({
    name: item.title || item.fileName,
    mimeType: item.contentType,
    dataUrl: `/api/player/media/${item.id}`,
    mediaId: item.id,
    breakdownAnnotations: item.breakdownAnnotations ?? [],
  }));
  return {
    attachmentName: media.length === 1 ? (media[0]?.title || media[0]?.fileName || 'attachment') : `${media.length} attachments`,
    attachmentMimeType: MULTI_ATTACHMENT_MIME,
    attachmentDataUrl: JSON.stringify(attachments),
  };
}

export default function PlayerNotesSuite({ fixedPlayer = null, embedded = false }: PlayerNotesSuiteProps = {}) {
  const fixedPlayerId = Number(fixedPlayer?.playerId ?? 0);
  const fixedPlayerName = String(fixedPlayer?.fullName ?? '').trim();
  const isFixedPlayerMode = fixedPlayerId > 0 && fixedPlayerName.length > 0;
  const [dashboardPlayerOptions, setDashboardPlayerOptions] = useState<string[]>([]);
  const [linkedPlayers, setLinkedPlayers] = useState<LinkedPlayerOption[]>([]);
  const [selectedPlayerName, setSelectedPlayerName] = useState(isFixedPlayerMode ? fixedPlayerName : 'All');
  const [playerInputName, setPlayerInputName] = useState(isFixedPlayerMode ? fixedPlayerName : 'All');
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
  const [orgNoteCategories, setOrgNoteCategories] = useState<string[]>([]);
  const [orgMediaCategories, setOrgMediaCategories] = useState<string[]>([]);
  const [newCategoryDraft, setNewCategoryDraft] = useState('');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchText, setSearchText] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [playerMedia, setPlayerMedia] = useState<PlayerMedia[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaCategory, setMediaCategory] = useState('General');
  const [mediaMessage, setMediaMessage] = useState('');
  const [editingMediaId, setEditingMediaId] = useState<number | null>(null);
  const [editingMediaTitle, setEditingMediaTitle] = useState('');
  const [editingMediaCategory, setEditingMediaCategory] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const categoryOptions = useMemo(
    () => uniqueNames([...DEFAULT_NOTE_CATEGORIES, ...orgNoteCategories, ...customCategories, ...notes.map((note) => note.category)]),
    [customCategories, notes, orgNoteCategories]
  );
  const mediaCategoryOptions = useMemo(
    () => uniqueNames(['General', 'Workout', 'Drills', 'Bullpen', 'Video Breakdown', ...orgMediaCategories, ...customCategories, ...playerMedia.map((media) => media.category)]),
    [customCategories, orgMediaCategories, playerMedia]
  );
  const mediaUploadCategorySelectOptions = useMemo(
    () => uniqueNames([...mediaCategoryOptions, mediaCategory]),
    [mediaCategory, mediaCategoryOptions]
  );
  const mediaEditCategorySelectOptions = useMemo(
    () => uniqueNames([...mediaCategoryOptions, editingMediaCategory]),
    [editingMediaCategory, mediaCategoryOptions]
  );
  const selectedLinkedPlayerId = useMemo(() => {
    if (isFixedPlayerMode) return fixedPlayerId;
    const selectedNorm = normalizePersonName(selectedPlayerName);
    if (!selectedNorm || selectedPlayerName === 'All') return 0;
    const match = linkedPlayers.find((player) => normalizePersonName(player.fullName) === selectedNorm);
    return Number(match?.playerId ?? 0);
  }, [fixedPlayerId, isFixedPlayerMode, linkedPlayers, selectedPlayerName]);
  const commitPlayerInput = () => {
    if (isFixedPlayerMode) return;
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
    if (isFixedPlayerMode) {
      setDashboardPlayerOptions([fixedPlayerName]);
      setLinkedPlayers([{ playerId: fixedPlayerId, fullName: fixedPlayerName }]);
      setSelectedPlayerName(fixedPlayerName);
      setPlayerInputName(fixedPlayerName);
      setLoadingPlayers(false);
      return;
    }
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
  }, [fixedPlayerId, fixedPlayerName, isFixedPlayerMode]);

  useEffect(() => {
    if (!selectedPlayerName.trim()) {
      setNotes([]);
      return;
    }
    let active = true;
    setLoadingNotes(true);
    const notesUrl =
      isFixedPlayerMode
        ? `/api/player/plan-notes?domain=General&playerId=${fixedPlayerId}`
        : selectedPlayerName === 'All'
        ? '/api/player/plan-notes?domain=General'
        : selectedLinkedPlayerId > 0
          ? `/api/player/plan-notes?domain=General&playerId=${selectedLinkedPlayerId}`
          : `/api/player/plan-notes?domain=General&dashboardPlayerName=${encodeURIComponent(selectedPlayerName)}`;
    fetch(notesUrl, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { notes?: PlayerPlanNote[]; categories?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load notes.');
        if (!active) return;
        setNotes(Array.isArray(payload.notes) ? payload.notes : []);
        if (Array.isArray(payload.categories)) setOrgNoteCategories(payload.categories);
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
  }, [fixedPlayerId, isFixedPlayerMode, selectedLinkedPlayerId, selectedPlayerName]);

  useEffect(() => {
    if (selectedLinkedPlayerId <= 0) {
      setPlayerMedia([]);
      return;
    }
    let active = true;
    setLoadingMedia(true);
    fetch(`/api/player/media?playerId=${selectedLinkedPlayerId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load media.');
        if (!active) return;
        setPlayerMedia(Array.isArray(payload.media) ? payload.media : []);
        if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Failed to load media.');
      })
      .finally(() => {
        if (active) setLoadingMedia(false);
      });
    return () => {
      active = false;
    };
  }, [selectedLinkedPlayerId]);

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
    const attachmentError = selectedLinkedPlayerId > 0
      ? noteFiles.find((file) => file.size > PLAYER_MEDIA_LIMIT_BYTES)
        ? `Attachment is too large. Please keep each upload under ${PLAYER_MEDIA_LIMIT_LABEL}.`
        : ''
      : validateSelectedAttachments(noteFiles);
    if (attachmentError) {
      setMessage(attachmentError);
      return;
    }
    setMessage('');
    try {
      let encoded = { attachmentName: '', attachmentMimeType: '', attachmentDataUrl: '' };
      let latestMedia: PlayerMedia[] | null = null;
      if (noteFiles.length > 0 && selectedLinkedPlayerId > 0) {
        const uploadedMedia: PlayerMedia[] = [];
        for (let i = 0; i < noteFiles.length; i++) {
          const file = noteFiles[i]!;
          const result = await uploadPlayerMediaFile({
            playerId: selectedLinkedPlayerId,
            file,
            title: file.name.replace(/\.[^.]+$/, '') || file.name,
            category: noteCategory,
            sourceType: 'player_notes',
            sourceLabel: `Note - ${noteDate}`,
          });
          if (!result.ok) throw new Error(result.error);
          if (Array.isArray(result.categories)) setOrgMediaCategories(result.categories);
          latestMedia = result.media as PlayerMedia[];
          const created = getPlayerMediaFromUploadResult(result, file);
          if (!created) throw new Error(`Uploaded ${file.name}, but could not create a note attachment link.`);
          uploadedMedia.push(created);
        }
        encoded = encodePlayerMediaAsNoteAttachments(uploadedMedia);
      } else if (noteFiles.length > 0) {
        const attachments: NoteAttachment[] = await Promise.all(
          noteFiles.map(async (file) => ({
            name: file.name,
            mimeType: file.type,
            dataUrl: await readFileAsDataUrl(file),
          }))
        );
        encoded = encodeAttachmentsForApi(attachments);
        if (encoded.attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
          setMessage(`Attachments are too large. Please keep uploads under ${NOTE_ATTACHMENT_LIMIT_LABEL}.`);
          return;
        }
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
      const payload = (await response.json().catch(() => ({}))) as { error?: string; notes?: PlayerPlanNote[]; categories?: string[] };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save note.');
      setNotes(Array.isArray(payload.notes) ? payload.notes : []);
      if (Array.isArray(payload.categories)) setOrgNoteCategories(payload.categories);
      setCustomCategories((current) => uniqueNames([...current, noteCategory]));
      if (latestMedia) setPlayerMedia(latestMedia);
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

  const noteMediaAttachments = useMemo(() => (
    notes.flatMap((note) =>
      parseNoteAttachments(note)
        .filter((attachment) => !attachment.mediaId && (attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/') || attachment.mimeType === 'application/pdf'))
        .map((attachment, idx) => ({
          id: `note-${note.id}-${idx}`,
          noteId: note.id,
          note,
          attachmentIndex: idx,
          title: attachment.name,
          category: note.category,
          mimeType: attachment.mimeType,
          url: attachment.dataUrl,
          downloadName: attachment.name,
          initialAnnotations: attachment.breakdownAnnotations ?? [],
          sourceLabel: `Note - ${normalizeDateOnly(note.noteDate) || note.noteDate}`,
        }))
    )
  ), [notes]);

  const mediaFilterCategories = useMemo(
    () => uniqueNames([...playerMedia.map((media) => media.category), ...noteMediaAttachments.map((media) => media.category)]),
    [noteMediaAttachments, playerMedia]
  );

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

  async function uploadMedia() {
    if (selectedLinkedPlayerId <= 0) { setMediaMessage('Select a linked player to upload media.'); return; }
    if (!mediaFiles.length) { setMediaMessage('Choose a photo or video first.'); return; }
    setMediaMessage('');
    setUploadingMedia(true);
    try {
      let lastMedia: PlayerMedia[] = playerMedia;
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i]!;
        const title = mediaFiles.length === 1
          ? (mediaTitle.trim() || file.name.replace(/\.[^.]+$/, ''))
          : (mediaTitle.trim() ? `${mediaTitle.trim()} ${i + 1}` : file.name.replace(/\.[^.]+$/, ''));
        const result = await uploadPlayerMediaFile({
          playerId: selectedLinkedPlayerId,
          file,
          title,
          category: mediaCategory.trim() || 'General',
          sourceType: 'player_notes',
        });
        if (!result.ok) throw new Error(result.error);
        if (Array.isArray(result.categories)) setOrgMediaCategories(result.categories);
        lastMedia = result.media as PlayerMedia[];
      }
      setPlayerMedia(lastMedia);
      setCustomCategories((current) => uniqueNames([...current, mediaCategory]));
      setMediaFiles([]);
      setMediaTitle('');
      setMediaMessage(mediaFiles.length > 1 ? `${mediaFiles.length} files uploaded.` : 'Media uploaded.');
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : 'Failed to upload media.');
    } finally {
      setUploadingMedia(false);
    }
  }

  async function deleteMedia(media: PlayerMedia) {
    if (!confirm(`Delete "${media.title}"? This cannot be undone.`)) return;
    setMediaPreview(null);
    setMediaMessage('');
    try {
      const params = new URLSearchParams({ playerId: String(selectedLinkedPlayerId), mediaId: String(media.id) });
      const response = await fetch(`/api/player/media?${params.toString()}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete media.');
      setPlayerMedia(Array.isArray(payload.media) ? payload.media : []);
      if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
      setMediaMessage('Media deleted.');
    } catch (error) {
      setMediaMessage(error instanceof Error ? error.message : 'Failed to delete media.');
    }
  }

  async function saveMediaEdits(media: PlayerMedia) {
    if (selectedLinkedPlayerId <= 0) return;
    try {
      const response = await fetch('/api/player/media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: selectedLinkedPlayerId,
          mediaId: media.id,
          title: editingMediaTitle,
          category: editingMediaCategory,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update media.');
      setPlayerMedia(Array.isArray(payload.media) ? payload.media : []);
      if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
      setEditingMediaId(null);
      setMessage('Media updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update media.');
    }
  }

  async function savePlayerMediaBreakdownAnnotations(media: PlayerMedia, annotations: BreakdownAnnotation[]) {
    if (selectedLinkedPlayerId <= 0) throw new Error('Select a linked player to save markup.');
    const response = await fetch('/api/player/media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: selectedLinkedPlayerId,
        mediaId: media.id,
        breakdownAnnotations: annotations,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to save markup.');
    if (Array.isArray(payload.media)) setPlayerMedia(payload.media);
    if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
    setMediaPreview((current) => current && current.url === `/api/player/media/${media.id}` ? { ...current, initialAnnotations: annotations } : current);
    setMediaMessage('Markup saved.');
  }

  async function saveNoteAttachmentBreakdownAnnotations(note: PlayerPlanNote, attachmentIndex: number, annotations: BreakdownAnnotation[]) {
    const attachments = parseNoteAttachments(note);
    if (!attachments[attachmentIndex]) throw new Error('Attachment not found.');
    const nextAttachments = attachments.map((attachment, idx) => (
      idx === attachmentIndex ? { ...attachment, breakdownAnnotations: annotations } : attachment
    ));
    const encoded = encodeAttachmentsForApi(nextAttachments);
    if (encoded.attachmentDataUrl.length > NOTE_ATTACHMENT_DATA_URL_MAX_LENGTH) {
      throw new Error(`Attachments are too large. Please keep uploads under ${NOTE_ATTACHMENT_LIMIT_LABEL}.`);
    }
    const response = await fetch('/api/player/plan-notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: note.id,
        playerId: note.playerId,
        noteDate: note.noteDate,
        category: note.category,
        noteText: note.noteText,
        attachmentName: encoded.attachmentName,
        attachmentMimeType: encoded.attachmentMimeType,
        attachmentDataUrl: encoded.attachmentDataUrl,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to save markup.');
    setNotes((current) =>
      current.map((item) =>
        item.id === note.id
          ? {
              ...item,
              attachmentName: encoded.attachmentName || null,
              attachmentMimeType: encoded.attachmentMimeType || null,
              attachmentDataUrl: encoded.attachmentDataUrl || null,
            }
          : item
      )
    );
    setMediaPreview((current) => current && current.url === attachments[attachmentIndex]?.dataUrl ? { ...current, initialAnnotations: annotations } : current);
    setMessage('Markup saved.');
  }

  const visiblePlayerMedia = playerMedia.filter((media) => filterCategory === 'All' || media.category === filterCategory);
  const visibleNoteMedia = noteMediaAttachments.filter((media) => filterCategory === 'All' || media.category === filterCategory);
  const mediaGalleryItems: MediaGalleryItem[] = [
    ...visiblePlayerMedia.map((media) => ({
      id: `player-${media.id}`,
      title: media.title,
      url: `/api/player/media/${media.id}`,
      mimeType: media.contentType,
      downloadName: media.fileName,
      initialAnnotations: media.breakdownAnnotations ?? [],
      saveAnnotations: media.contentType === 'application/pdf' ? undefined : (annotations: BreakdownAnnotation[]) => savePlayerMediaBreakdownAnnotations(media, annotations),
      deleteMedia: () => deleteMedia(media),
    })),
    ...visibleNoteMedia.map((media) => ({
      id: media.id,
      title: media.title,
      url: media.url,
      mimeType: media.mimeType,
      downloadName: media.downloadName,
      initialAnnotations: media.initialAnnotations,
      saveAnnotations: media.mimeType === 'application/pdf' ? undefined : (annotations: BreakdownAnnotation[]) => saveNoteAttachmentBreakdownAnnotations(media.note, media.attachmentIndex, annotations),
    })),
  ];
  const previewIndex = mediaPreview ? mediaGalleryItems.findIndex((item) => item.id === mediaPreview.id) : -1;
  const openMediaGalleryItem = (item: MediaGalleryItem) => setMediaPreview(item);

  return (
    <section className={embedded ? 'portal-admin-card' : 'portal-panel portal-admin-panel'} style={{ padding: '1rem' }}>
      <div style={{ display: 'grid', gap: 12 }}>
        <article className="portal-admin-card">
          <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))' }}>
            {isFixedPlayerMode ? (
              <label>
                Player
                <input value={fixedPlayerName} readOnly />
              </label>
            ) : (
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
            )}
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

        <article className="portal-admin-card">
          <div className="portal-row-between" style={{ alignItems: 'start', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Photos & Videos</h3>
              <p className="portal-muted-text" style={{ margin: '0.25rem 0 0' }}>
                Uploaded media and note attachments for the selected player.
              </p>
            </div>
            {loadingMedia ? <span className="portal-muted-text">Loading media...</span> : null}
          </div>
          {selectedLinkedPlayerId > 0 ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div className="portal-form-grid" style={{ gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 220px) minmax(160px, 220px) auto', alignItems: 'end' }}>
                <label>
                  Upload Photos/Videos/PDFs
                  <input
                    type="file"
                    accept="image/*,video/*,application/pdf,.pdf"
                    multiple={true}
                    onChange={(event) => {
                      const files = event.target.files ? Array.from(event.target.files) : [];
                      setMediaFiles(files);
                      if (files.length === 1 && !mediaTitle.trim()) setMediaTitle(files[0]!.name.replace(/\.[^.]+$/, ''));
                      setMediaMessage('');
                    }}
                  />
                </label>
                <label>
                  Name
                  <input value={mediaTitle} onChange={(event) => setMediaTitle(event.target.value)} placeholder="Media name..." />
                </label>
                <label>
                  Category
                  <select
                    className="portal-desktop-category-input"
                    value={mediaCategory}
                    onChange={(event) => setMediaCategory(event.target.value)}
                  >
                    {mediaUploadCategorySelectOptions.map((category) => <option key={`media-cat-desktop-select-${category}`} value={category}>{category}</option>)}
                  </select>
                  <select
                    className="portal-mobile-category-select"
                    value={mediaCategory}
                    onChange={(event) => setMediaCategory(event.target.value)}
                  >
                    {mediaUploadCategorySelectOptions.map((category) => <option key={`media-cat-select-${category}`} value={category}>{category}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-primary" onClick={() => void uploadMedia()} disabled={!mediaFiles.length || uploadingMedia}>
                  {uploadingMedia ? 'Uploading...' : 'Upload'}
                </button>
              </div>
              {mediaFiles.length > 0 ? (
                <p className="portal-muted-text" style={{ margin: 0 }}>{mediaFiles.map((f) => f.name).join(', ')}</p>
              ) : null}
              {mediaMessage ? (
                <p className={mediaMessage.includes('Failed') || mediaMessage.includes('not configured') ? 'auth-error' : 'auth-message'} style={{ margin: 0 }}>
                  {mediaMessage}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="portal-muted-text" style={{ marginBottom: 0 }}>Select a specific linked player to upload and organize media.</p>
          )}
          {mediaFilterCategories.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button type="button" className={filterCategory === 'All' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilterCategory('All')}>All Media</button>
              {mediaFilterCategories.map((category) => (
                <button key={`media-filter-${category}`} type="button" className={filterCategory === category ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilterCategory(category)}>
                  {category}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginTop: 12 }}>
            {visiblePlayerMedia
              .map((media) => {
                return (
                  <div key={`player-media-${media.id}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.16)', display: 'grid', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const item = mediaGalleryItems.find((entry) => entry.id === `player-${media.id}`);
                        if (item) openMediaGalleryItem(item);
                      }}
                      className="portal-media-tile-preview"
                    >
                      <MediaTilePreview url={`/api/player/media/${media.id}`} title={media.title} mimeType={media.contentType} />
                      <span className="portal-media-tile-kind">{media.mediaType === 'video' ? 'Video' : media.mediaType === 'pdf' || media.contentType === 'application/pdf' ? 'PDF' : 'Photo'}</span>
                    </button>
                    {editingMediaId === media.id ? (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <input value={editingMediaTitle} onChange={(event) => setEditingMediaTitle(event.target.value)} />
                        <select
                          className="portal-desktop-category-input"
                          value={editingMediaCategory}
                          onChange={(event) => setEditingMediaCategory(event.target.value)}
                        >
                          {mediaEditCategorySelectOptions.map((category) => <option key={`media-edit-cat-desktop-select-${category}`} value={category}>{category}</option>)}
                        </select>
                        <select
                          className="portal-mobile-category-select"
                          value={editingMediaCategory}
                          onChange={(event) => setEditingMediaCategory(event.target.value)}
                        >
                          {mediaEditCategorySelectOptions.map((category) => <option key={`media-edit-cat-select-${category}`} value={category}>{category}</option>)}
                        </select>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="btn btn-primary" onClick={() => void saveMediaEdits(media)}>Save</button>
                          <button type="button" className="btn btn-ghost" onClick={() => setEditingMediaId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong style={{ color: '#f8fafc' }}>{media.title}</strong>
                        <span className="portal-muted-text">{media.category}{media.sourceLabel ? ` - ${media.sourceLabel}` : ''}</span>
                        <span className="portal-muted-text" style={{ fontSize: 11 }}>{new Date(media.createdAt).toLocaleDateString()}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setEditingMediaId(media.id);
                              setEditingMediaTitle(media.title);
                              setEditingMediaCategory(media.category);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ color: '#f87171' }}
                            onClick={() => void deleteMedia(media)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            {visibleNoteMedia
              .map((media) => (
                <div key={media.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.12)', display: 'grid', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const item = mediaGalleryItems.find((entry) => entry.id === media.id);
                      if (item) openMediaGalleryItem(item);
                    }}
                    className="portal-media-tile-preview"
                  >
                    <MediaTilePreview url={media.url} title={media.title} mimeType={media.mimeType} />
                    <span className="portal-media-tile-kind">{media.mimeType.startsWith('video/') ? 'Video Attachment' : media.mimeType === 'application/pdf' ? 'PDF Attachment' : 'Photo Attachment'}</span>
                  </button>
                  <strong style={{ color: '#f8fafc' }}>{media.title}</strong>
                  <span className="portal-muted-text">{media.category} - {media.sourceLabel}</span>
                </div>
              ))}
          </div>
          {!playerMedia.length && !noteMediaAttachments.length ? <p className="portal-muted-text" style={{ marginBottom: 0 }}>No photos or videos yet.</p> : null}
        </article>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(420px, 560px) minmax(0, 1fr)', alignItems: 'start' }}>
          <article className="portal-admin-card" style={{ position: 'sticky', top: 8 }}>
            <h3 style={{ marginTop: 0 }}>New Note</h3>
            <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                Date
                <NativeDateInput value={noteDate} onChange={setNoteDate} ariaLabel="Date" />
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
              Attachments (Photos/Videos/PDFs)
              <input
                type="file"
                accept="image/*,video/*,application/pdf,.pdf"
                multiple={true}
                onChange={(event) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  setNoteFiles(files);
                  const attachmentError = selectedLinkedPlayerId > 0
                    ? files.find((file) => file.size > PLAYER_MEDIA_LIMIT_BYTES)
                      ? `Attachment is too large. Please keep each upload under ${PLAYER_MEDIA_LIMIT_LABEL}.`
                      : ''
                    : validateSelectedAttachments(files);
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
                {` (${selectedLinkedPlayerId > 0 ? `${PLAYER_MEDIA_LIMIT_LABEL} max each` : `${NOTE_ATTACHMENT_LIMIT_LABEL} max`})`}
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
                <NativeDateInput value={filterStartDate} onChange={setFilterStartDate} ariaLabel="Start Date" />
              </label>
              <label>
                End Date
                <NativeDateInput value={filterEndDate} onChange={setFilterEndDate} ariaLabel="End Date" />
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
                                    onClick={() => {
                                      if (attachment.mediaId) {
                                        const item = mediaGalleryItems.find((entry) => entry.id === `player-${attachment.mediaId}`);
                                        if (item) {
                                          openMediaGalleryItem(item);
                                          return;
                                        }
                                      }
                                      if (attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/') || attachment.mimeType === 'application/pdf') {
                                        const galleryId = `note-${note.id}-${idx}`;
                                        const item = mediaGalleryItems.find((entry) => entry.id === galleryId);
                                        openMediaGalleryItem(item ?? {
                                          id: galleryId,
                                          title: attachment.name,
                                          url: attachment.dataUrl,
                                          mimeType: attachment.mimeType,
                                          downloadName: attachment.name,
                                          initialAnnotations: attachment.breakdownAnnotations ?? [],
                                          saveAnnotations: attachment.mimeType === 'application/pdf' ? undefined : (annotations) => saveNoteAttachmentBreakdownAnnotations(note, idx, annotations),
                                        });
                                        return;
                                      }
                                      setAttachmentPreview(attachment);
                                    }}
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
        {mediaPreview ? (
          <MediaBreakdownViewer
            title={mediaPreview.title}
            url={mediaPreview.url}
            mimeType={mediaPreview.mimeType}
            downloadName={mediaPreview.downloadName}
            onClose={() => setMediaPreview(null)}
            players={linkedPlayers}
            initialAnnotations={mediaPreview.initialAnnotations}
            onSaveAnnotations={mediaPreview.saveAnnotations}
            onDelete={mediaPreview.deleteMedia}
            hasPrevious={previewIndex > 0}
            hasNext={previewIndex >= 0 && previewIndex < mediaGalleryItems.length - 1}
            positionLabel={previewIndex >= 0 ? `${previewIndex + 1} / ${mediaGalleryItems.length}` : undefined}
            onPrevious={previewIndex > 0 ? () => openMediaGalleryItem(mediaGalleryItems[previewIndex - 1]!) : undefined}
            onNext={previewIndex >= 0 && previewIndex < mediaGalleryItems.length - 1 ? () => openMediaGalleryItem(mediaGalleryItems[previewIndex + 1]!) : undefined}
          />
        ) : null}
      </div>
    </section>
  );
}
