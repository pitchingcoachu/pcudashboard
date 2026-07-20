'use client';

import { useEffect, useMemo, useState } from 'react';
import MediaBreakdownViewer, { type BreakdownAnnotation } from '../components/media-breakdown-viewer';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';

type PlayerMedia = {
  id: number;
  mediaType: 'photo' | 'video' | 'pdf';
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  createdAt: string;
  breakdownAnnotations?: BreakdownAnnotation[];
};

type MediaPreview = {
  title: string;
  url: string;
  mimeType: string;
  downloadName: string;
  mediaId: number;
  initialAnnotations: BreakdownAnnotation[];
};

type OrgPlayer = { playerId: number; fullName: string };

function uniqueCategoryNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = String(value ?? '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

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

function MediaTilePreview({ url, title, contentType, mediaType }: { url: string; title: string; contentType: string; mediaType: PlayerMedia['mediaType'] }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalized = String(contentType ?? '').toLowerCase();
  const isUnsupportedImagePreview = normalized.includes('heic') || normalized.includes('heif');
  if (mediaType === 'photo' || normalized.startsWith('image/')) {
    if (isUnsupportedImagePreview || imageFailed) return <MediaTileFallback label="Photo" />;
    return <img src={url} alt={title} className="portal-media-tile-preview-media" loading="lazy" onError={() => setImageFailed(true)} />;
  }
  if (mediaType === 'video' || normalized.startsWith('video/')) {
    return <video src={url} className="portal-media-tile-preview-media" muted playsInline preload="metadata" />;
  }
  if (mediaType === 'pdf' || normalized === 'application/pdf') {
    return (
      <>
        <iframe title={`${title} preview`} src={`${url}#toolbar=0&navpanes=0&scrollbar=0&page=1`} className="portal-media-tile-preview-media portal-media-tile-preview-pdf" />
        <span className="portal-media-tile-badge">PDF</span>
      </>
    );
  }
  return <MediaTileFallback label="File" />;
}

export default function PlayerMediaSection({ playerId, isPlayer }: { playerId: number; isPlayer: boolean }) {
  const [media, setMedia] = useState<PlayerMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [orgPlayers, setOrgPlayers] = useState<OrgPlayer[]>([]);
  const [orgMediaCategories, setOrgMediaCategories] = useState<string[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaCategory, setMediaCategory] = useState('General');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');

  const categoryOptions = useMemo(
    () => uniqueCategoryNames(media.map((m) => m.category)),
    [media]
  );
  const uploadCategoryOptions = useMemo(
    () => uniqueCategoryNames(['General', 'Workout', 'Drills', 'Bullpen', 'Mechanics', 'Edger', ...orgMediaCategories, ...media.map((m) => m.category)]),
    [media, orgMediaCategories]
  );
  const uploadCategorySelectOptions = useMemo(
    () => uniqueCategoryNames([...uploadCategoryOptions, mediaCategory]),
    [mediaCategory, uploadCategoryOptions]
  );

  useEffect(() => {
    fetch('/api/dashboard/player-plans/players', { cache: 'no-store' })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { players?: OrgPlayer[] };
        if (Array.isArray(data.players)) setOrgPlayers(data.players);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (playerId <= 0) return;
    setLoading(true);
    fetch(`/api/player/media?playerId=${playerId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { media?: PlayerMedia[]; categories?: string[] }) => {
        if (Array.isArray(data.media)) setMedia(data.media);
        if (Array.isArray(data.categories)) setOrgMediaCategories(data.categories);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [playerId]);

  async function upload() {
    if (!mediaFiles.length) { setMessage('Choose a file first.'); return; }
    setMessage('');
    setUploading(true);
    try {
      let lastMedia: PlayerMedia[] = media;
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i]!;
        const title = mediaFiles.length === 1
          ? (mediaTitle.trim() || file.name.replace(/\.[^.]+$/, ''))
          : (mediaTitle.trim() ? `${mediaTitle.trim()} ${i + 1}` : file.name.replace(/\.[^.]+$/, ''));
        const result = await uploadPlayerMediaFile({
          playerId,
          file,
          title,
          category: mediaCategory.trim() || 'General',
          sourceType: 'player_self',
        });
        if (!result.ok) throw new Error(result.error);
        lastMedia = result.media as PlayerMedia[];
        if (Array.isArray(result.categories)) setOrgMediaCategories(result.categories);
      }
      setMedia(lastMedia);
      setMediaFiles([]);
      setMediaTitle('');
      setMessage(mediaFiles.length > 1 ? `${mediaFiles.length} files uploaded.` : 'Uploaded.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  const filtered = filterCategory === 'All' ? media : media.filter((m) => m.category === filterCategory);
  const previewIndex = mediaPreview ? filtered.findIndex((item) => item.id === mediaPreview.mediaId) : -1;

  function mediaKindLabel(item: PlayerMedia): string {
    if (item.mediaType === 'pdf' || item.contentType === 'application/pdf') return 'PDF';
    if (item.mediaType === 'video') return 'Video';
    return 'Photo';
  }

  function openMediaPreview(item: PlayerMedia) {
    const url = `/api/player/media/${item.id}`;
    const mimeType = item.contentType || 'video/quicktime';
    setMediaPreview({
      title: item.title,
      url,
      mimeType,
      downloadName: item.fileName,
      mediaId: item.id,
      initialAnnotations: item.breakdownAnnotations ?? [],
    });
  }

  async function saveBreakdownAnnotations(mediaId: number, annotations: BreakdownAnnotation[]) {
    const response = await fetch('/api/player/media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, mediaId, breakdownAnnotations: annotations }),
    });
    const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to save markup.');
    if (Array.isArray(payload.media)) setMedia(payload.media);
    if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
    setMediaPreview((current) => current && current.mediaId === mediaId ? { ...current, initialAnnotations: annotations } : current);
    setMessage('Markup saved.');
  }

  async function deleteMedia(mediaId: number, title: string) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/player/media?${new URLSearchParams({ playerId: String(playerId), mediaId: String(mediaId) }).toString()}`, { method: 'DELETE' });
    const payload = (await response.json().catch(() => ({}))) as { media?: PlayerMedia[]; categories?: string[]; error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? 'Delete failed.');
      return;
    }
    setMedia(Array.isArray(payload.media) ? payload.media : []);
    if (Array.isArray(payload.categories)) setOrgMediaCategories(payload.categories);
    setMediaPreview(null);
    setMessage('Media deleted.');
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Upload row */}
      <div className="portal-form-grid" style={{ gridTemplateColumns: 'minmax(180px,1fr) minmax(140px,200px) minmax(140px,200px) auto', alignItems: 'end', marginBottom: 8 }}>
        <label>
          Upload
          <input
            type="file"
            accept="image/*,video/*,application/pdf,.pdf"
            multiple
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              setMediaFiles(files);
              if (files.length === 1 && !mediaTitle.trim()) setMediaTitle(files[0]!.name.replace(/\.[^.]+$/, ''));
              setMessage('');
            }}
          />
        </label>
        <label>
          Name
          <input value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} placeholder="Optional name..." />
        </label>
        <label>
          Category
          <input
            className="portal-desktop-category-input"
            list="player-media-cat-opts"
            value={mediaCategory}
            onChange={(e) => setMediaCategory(e.target.value)}
          />
          <select
            className="portal-mobile-category-select"
            value={mediaCategory}
            onChange={(e) => setMediaCategory(e.target.value)}
          >
            {uploadCategorySelectOptions.map((c) => <option key={`media-category-select-${c}`} value={c}>{c}</option>)}
          </select>
          <datalist id="player-media-cat-opts">
            {uploadCategoryOptions.map((c) => <option key={`media-category-${c}`} value={c} />)}
          </datalist>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void upload()} disabled={!mediaFiles.length || uploading}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {mediaFiles.length > 0 && (
        <p className="portal-muted-text" style={{ margin: '0 0 8px' }}>{mediaFiles.map((f) => f.name).join(', ')}</p>
      )}
      {message && (
        <p className={message.includes('Failed') || message.includes('failed') ? 'auth-error' : 'auth-message'} style={{ margin: '0 0 8px' }}>
          {message}
        </p>
      )}

      {/* Category filter */}
      {categoryOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button type="button" className={filterCategory === 'All' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilterCategory('All')}>All</button>
          {categoryOptions.map((c) => (
            <button key={c} type="button" className={filterCategory === c ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setFilterCategory(c)}>{c}</button>
          ))}
        </div>
      )}

      {loading ? <p className="portal-muted-text">Loading...</p> : null}

      {/* Media grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        {filtered.map((m) => {
          const url = `/api/player/media/${m.id}`;
          const mimeType = m.contentType || 'video/quicktime';
          return (
            <div key={m.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, background: 'rgba(0,0,0,0.16)', display: 'grid', gap: 6 }}>
              <button
                type="button"
                onClick={() => openMediaPreview(m)}
                className="portal-media-tile-preview"
              >
                <MediaTilePreview url={url} title={m.title} contentType={mimeType} mediaType={m.mediaType} />
                <span className="portal-media-tile-kind">{mediaKindLabel(m)}</span>
              </button>
              <strong style={{ color: '#f8fafc', fontSize: 13 }}>{m.title}</strong>
              <span className="portal-muted-text" style={{ fontSize: 12 }}>{m.category}</span>
              <span className="portal-muted-text" style={{ fontSize: 11 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
            </div>
          );
        })}
      </div>

      {!loading && !media.length && (
        <p className="portal-muted-text" style={{ marginBottom: 0 }}>No videos, photos, or PDFs yet.</p>
      )}

      {mediaPreview && (
        <MediaBreakdownViewer
          title={mediaPreview.title}
          url={mediaPreview.url}
          mimeType={mediaPreview.mimeType}
          downloadName={mediaPreview.downloadName}
          onClose={() => setMediaPreview(null)}
          players={orgPlayers}
          initialAnnotations={mediaPreview.initialAnnotations}
          onSaveAnnotations={mediaPreview.mimeType === 'application/pdf' ? undefined : (annotations) => saveBreakdownAnnotations(mediaPreview.mediaId, annotations)}
          onDelete={() => void deleteMedia(mediaPreview.mediaId, mediaPreview.title)}
          hasPrevious={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < filtered.length - 1}
          positionLabel={previewIndex >= 0 ? `${previewIndex + 1} / ${filtered.length}` : undefined}
          onPrevious={previewIndex > 0 ? () => openMediaPreview(filtered[previewIndex - 1]!) : undefined}
          onNext={previewIndex >= 0 && previewIndex < filtered.length - 1 ? () => openMediaPreview(filtered[previewIndex + 1]!) : undefined}
        />
      )}
    </div>
  );
}
