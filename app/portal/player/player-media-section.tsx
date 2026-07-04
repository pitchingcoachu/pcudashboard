'use client';

import { useEffect, useMemo, useState } from 'react';
import MediaBreakdownViewer from '../components/media-breakdown-viewer';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';

type PlayerMedia = {
  id: number;
  mediaType: 'photo' | 'video';
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  createdAt: string;
};

type MediaPreview = {
  title: string;
  url: string;
  mimeType: string;
  downloadName: string;
};

export default function PlayerMediaSection({ playerId, isPlayer }: { playerId: number; isPlayer: boolean }) {
  const [media, setMedia] = useState<PlayerMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaCategory, setMediaCategory] = useState('General');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');

  const categoryOptions = useMemo(
    () => Array.from(new Set(media.map((m) => m.category))).sort(),
    [media]
  );

  useEffect(() => {
    if (playerId <= 0) return;
    setLoading(true);
    fetch(`/api/player/media?playerId=${playerId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { media?: PlayerMedia[] }) => {
        if (Array.isArray(data.media)) setMedia(data.media);
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

  return (
    <div style={{ marginTop: 12 }}>
      {/* Upload row */}
      <div className="portal-form-grid" style={{ gridTemplateColumns: 'minmax(180px,1fr) minmax(140px,200px) minmax(140px,200px) auto', alignItems: 'end', marginBottom: 8 }}>
        <label>
          Upload
          <input
            type="file"
            accept="image/*,video/*"
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
            list="player-media-cat-opts"
            value={mediaCategory}
            onChange={(e) => setMediaCategory(e.target.value)}
          />
          <datalist id="player-media-cat-opts">
            {['General', 'Workout', 'Bullpen', 'Mechanics', 'Edger'].map((c) => (
              <option key={c} value={c} />
            ))}
            {categoryOptions.map((c) => <option key={`existing-${c}`} value={c} />)}
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
                onClick={() => setMediaPreview({ title: m.title, url, mimeType, downloadName: m.fileName })}
                style={{ border: 0, borderRadius: 8, minHeight: 100, background: 'rgba(15,23,42,0.92)', color: '#f8fafc', fontWeight: 900, cursor: 'pointer' }}
              >
                {m.mediaType === 'video' ? '▶ Video' : 'Photo'}
              </button>
              <strong style={{ color: '#f8fafc', fontSize: 13 }}>{m.title}</strong>
              <span className="portal-muted-text" style={{ fontSize: 12 }}>{m.category}</span>
              <span className="portal-muted-text" style={{ fontSize: 11 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
            </div>
          );
        })}
      </div>

      {!loading && !media.length && (
        <p className="portal-muted-text" style={{ marginBottom: 0 }}>No videos or photos yet.</p>
      )}

      {mediaPreview && (
        <MediaBreakdownViewer
          title={mediaPreview.title}
          url={mediaPreview.url}
          mimeType={mediaPreview.mimeType}
          downloadName={mediaPreview.downloadName}
          onClose={() => setMediaPreview(null)}
        />
      )}
    </div>
  );
}
