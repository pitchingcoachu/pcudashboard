'use client';

import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './csv-uploads.module.css';

type MetricCoverage = { key: string; label: string; populated: number; total: number };
type CsvPreview = {
  fileName: string;
  provider: 'Rapsodo';
  playerName: string;
  providerPlayerId: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  minDate: string | null;
  maxDate: string | null;
  pitchTypes: Array<{ name: string; count: number }>;
  metricCoverage: MetricCoverage[];
  warnings: string[];
};
type PreviewResult = { fileName: string; preview: CsvPreview | null; error: string | null };
type UploadHistory = {
  id: number;
  provider: string;
  fileName: string;
  pitcherName: string;
  throwingHand: string;
  rowCount: number;
  insertedRows: number;
  skippedRows: number;
  minDate: string | null;
  maxDate: string | null;
  status: string;
  refreshRequestedAt: string | null;
  refreshCompletedAt: string | null;
  createdAt: string;
  duplicateFile?: boolean;
};

const MAX_FILES = 10;

function shortDate(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function CsvUploadsWorkspace({ schoolCode }: { schoolCode: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [hands, setHands] = useState<Record<string, 'Right' | 'Left' | ''>>({});
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'importing'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/csv-uploads', { cache: 'no-store' });
      const payload = (await response.json()) as { uploads?: UploadHistory[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load upload history.');
      setHistory(Array.isArray(payload.uploads) ? payload.uploads : []);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : 'Unable to load upload history.');
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const addFiles = useCallback((incoming: File[]) => {
    setMessage('');
    setError('');
    setPreviews([]);
    setFiles((current) => {
      const seen = new Set(current.map(fileIdentity));
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_FILES) break;
        const identity = fileIdentity(file);
        if (seen.has(identity)) continue;
        seen.add(identity);
        next.push(file);
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
    setPreviews([]);
    setMessage('');
    setError('');
  }, []);

  const analyze = useCallback(async () => {
    if (!files.length) return;
    setPhase('analyzing');
    setError('');
    setMessage('');
    try {
      const formData = new FormData();
      formData.set('action', 'preview');
      files.forEach((file) => formData.append('files', file));
      const response = await fetch('/api/admin/csv-uploads', { method: 'POST', body: formData });
      const payload = (await response.json()) as { previews?: PreviewResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to analyze the selected files.');
      const nextPreviews = Array.isArray(payload.previews) ? payload.previews : [];
      setPreviews(nextPreviews);
      setHands((current) => {
        const next = { ...current };
        nextPreviews.forEach((item, index) => {
          const key = fileIdentity(files[index]);
          if (item.preview && !next[key]) next[key] = '';
        });
        return next;
      });
      const validCount = nextPreviews.filter((item) => item.preview).length;
      const invalidCount = nextPreviews.length - validCount;
      setMessage(`${validCount} file${validCount === 1 ? '' : 's'} ready${invalidCount ? `; ${invalidCount} needs attention` : ''}.`);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Unable to analyze the selected files.');
    } finally {
      setPhase('idle');
    }
  }, [files]);

  const canImport = useMemo(() => {
    if (!files.length || previews.length !== files.length) return false;
    return previews.every((item, index) => item.preview && Boolean(hands[fileIdentity(files[index])]));
  }, [files, hands, previews]);

  const runImport = useCallback(async () => {
    if (!canImport) return;
    setPhase('importing');
    setError('');
    setMessage('');
    try {
      const formData = new FormData();
      formData.set('action', 'import');
      formData.set('throwingHands', JSON.stringify(files.map((file) => hands[fileIdentity(file)])));
      files.forEach((file) => formData.append('files', file));
      const response = await fetch('/api/admin/csv-uploads', { method: 'POST', body: formData });
      const payload = (await response.json()) as {
        uploads?: UploadHistory[];
        refreshQueued?: boolean;
        refreshWarning?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'The CSV import failed.');
      const inserted = (payload.uploads ?? []).reduce((sum, upload) => sum + upload.insertedRows, 0);
      const duplicates = (payload.uploads ?? []).filter((upload) => upload.duplicateFile).length;
      const refreshCopy = payload.refreshQueued ? ' Dashboard refresh is queued.' : '';
      const duplicateCopy = duplicates ? ` ${duplicates} duplicate file${duplicates === 1 ? ' was' : 's were'} left unchanged.` : '';
      setMessage(`${inserted} pitch${inserted === 1 ? '' : 'es'} imported.${duplicateCopy}${refreshCopy}`);
      if (payload.refreshWarning) setError(`Data was saved. ${payload.refreshWarning}`);
      setFiles([]);
      setPreviews([]);
      setHands({});
      if (inputRef.current) inputRef.current.value = '';
      await loadHistory();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The CSV import failed.');
    } finally {
      setPhase('idle');
    }
  }, [canImport, files, hands, loadHistory]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }, [addFiles]);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Data operations · {schoolCode}</span>
          <h1>CSV Uploads</h1>
          <p>Bring bullpen data into the same dashboard your staff already uses.</p>
        </div>
        <div className={styles.providerBadge}>
          <span className={styles.providerDot} aria-hidden="true" />
          Rapsodo pitching
        </div>
      </header>

      <section className={styles.workspace} aria-labelledby="upload-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.step}>01</span>
            <h2 id="upload-heading">Select exports</h2>
          </div>
          <p>Complete pitching CSVs · up to 10 files · 5 MB each</p>
        </div>

        <div
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
          onClick={() => inputRef.current?.click()}
        >
          <div className={styles.uploadMark} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
          </div>
          <strong>Drop Rapsodo CSVs here</strong>
          <span>or click to choose files</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className={styles.fileInput}
            onChange={(event) => addFiles(Array.from(event.currentTarget.files ?? []))}
          />
        </div>

        {files.length ? (
          <div className={styles.fileQueue}>
            {files.map((file, index) => (
              <div className={styles.fileRow} key={fileIdentity(file)}>
                <div className={styles.fileIcon}>CSV</div>
                <div className={styles.fileMeta}>
                  <strong>{file.name}</strong>
                  <span>{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB</span>
                </div>
                <button type="button" className={styles.removeButton} onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-primary" disabled={phase !== 'idle'} onClick={() => void analyze()}>
              {phase === 'analyzing' ? 'Analyzing…' : 'Analyze Files'}
            </button>
          </div>
        ) : null}
      </section>

      {previews.length ? (
        <section className={styles.workspace} aria-labelledby="review-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.step}>02</span>
              <h2 id="review-heading">Review mapping</h2>
            </div>
            <p>Confirm the pitcher and throwing hand before importing.</p>
          </div>
          <div className={styles.previewGrid}>
            {previews.map((item, index) => {
              const file = files[index];
              if (!item.preview) {
                return (
                  <article className={`${styles.previewCard} ${styles.previewCardError}`} key={`${item.fileName}:${index}`}>
                    <span className={styles.statusPill}>Needs attention</span>
                    <h3>{item.fileName}</h3>
                    <p>{item.error}</p>
                    <button type="button" className="btn btn-ghost" onClick={() => removeFile(index)}>Remove file</button>
                  </article>
                );
              }
              const preview = item.preview;
              const handKey = fileIdentity(file);
              return (
                <article className={styles.previewCard} key={`${item.fileName}:${index}`}>
                  <div className={styles.previewTopline}>
                    <span className={styles.statusPill}>Ready</span>
                    <span>{preview.provider}</span>
                  </div>
                  <h3>{preview.playerName}</h3>
                  <p className={styles.fileName}>{preview.fileName}</p>
                  <div className={styles.statStrip}>
                    <div><strong>{preview.validRows}</strong><span>valid pitches</span></div>
                    <div><strong>{shortDate(preview.minDate)}</strong><span>first date</span></div>
                    <div><strong>{preview.pitchTypes.length}</strong><span>pitch types</span></div>
                  </div>
                  <div className={styles.pitchTypes}>
                    {preview.pitchTypes.map((pitchType) => (
                      <span key={pitchType.name}>{pitchType.name} <b>{pitchType.count}</b></span>
                    ))}
                  </div>
                  <div className={styles.coverage}>
                    {preview.metricCoverage.map((metric) => {
                      const percentage = metric.total ? Math.round((100 * metric.populated) / metric.total) : 0;
                      return (
                        <div className={styles.coverageRow} key={metric.key}>
                          <span>{metric.label}</span>
                          <div><i style={{ width: `${percentage}%` }} /></div>
                          <b>{percentage}%</b>
                        </div>
                      );
                    })}
                  </div>
                  <label className={styles.handField}>
                    Throws
                    <select
                      value={hands[handKey] ?? ''}
                      onChange={(event) => setHands((current) => ({ ...current, [handKey]: event.target.value as 'Right' | 'Left' | '' }))}
                    >
                      <option value="">Select throwing hand</option>
                      <option value="Right">Right</option>
                      <option value="Left">Left</option>
                    </select>
                  </label>
                  {preview.warnings.length ? (
                    <details className={styles.warnings}>
                      <summary>{preview.warnings.length} import note{preview.warnings.length === 1 ? '' : 's'}</summary>
                      <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className={styles.importBar}>
            <div>
              <strong>Destination: {schoolCode}</strong>
              <span>Duplicate pitches will be skipped automatically.</span>
            </div>
            <button type="button" className="btn btn-primary" disabled={!canImport || phase !== 'idle'} onClick={() => void runImport()}>
              {phase === 'importing' ? 'Importing…' : 'Import Validated Data'}
            </button>
          </div>
        </section>
      ) : null}

      {message ? <div className={styles.successNotice} role="status">{message}</div> : null}
      {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}

      <section className={styles.workspace} aria-labelledby="history-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.step}>03</span>
            <h2 id="history-heading">Upload history</h2>
          </div>
          <p>Recent files imported into {schoolCode}.</p>
        </div>
        {history.length ? (
          <div className={styles.historyTableWrap}>
            <table className={styles.historyTable}>
              <thead><tr><th>File</th><th>Pitcher</th><th>Date range</th><th>Imported</th><th>Uploaded</th><th>Status</th></tr></thead>
              <tbody>
                {history.map((upload) => (
                  <tr key={upload.id}>
                    <td><strong>{upload.fileName}</strong><span>{upload.provider}</span></td>
                    <td>{upload.pitcherName}<span>{upload.throwingHand}</span></td>
                    <td>{shortDate(upload.minDate)}{upload.maxDate && upload.maxDate !== upload.minDate ? ` – ${shortDate(upload.maxDate)}` : ''}</td>
                    <td>{upload.insertedRows.toLocaleString()}<span>{upload.skippedRows ? `${upload.skippedRows} skipped` : 'No duplicates'}</span></td>
                    <td>{formatTimestamp(upload.createdAt)}</td>
                    <td><span className={styles.tableStatus}>{upload.refreshCompletedAt ? 'Ready' : upload.refreshRequestedAt ? 'Refreshing' : 'Imported'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyHistory}>No CSV imports for this school yet.</div>
        )}
      </section>
    </div>
  );
}
