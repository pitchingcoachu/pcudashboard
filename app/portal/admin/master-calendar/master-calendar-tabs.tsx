'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type ThrowingDayEntry = Record<string, string>;
type ThrowingFieldDef = { key: string; label: string };

type PlayerRow = {
  playerId: number;
  fullName: string;
};

type ProgramItem = {
  dayDate: string;
  itemType: 'exercise' | 'workout';
  itemName: string;
};

type MasterCalendarTab = 'overall' | 'throwing' | 'workouts';

type ThrowingClipboard = {
  playerId: number;
  entries: ThrowingDayEntry[];
};

type ThrowingMenuState = {
  playerId: number;
  day: string;
  x: number;
  y: number;
};

const TABS: { key: MasterCalendarTab; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'throwing', label: 'Throwing' },
  { key: 'workouts', label: 'Workouts' },
];

function labelDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const STICKY_HEADER_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: 'var(--panel-strong, #0b0b10)',
};

const STICKY_PLAYER_COL_STYLE: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: 'var(--panel-strong, #0b0b10)',
};

const STICKY_CORNER_STYLE: CSSProperties = {
  ...STICKY_HEADER_STYLE,
  ...STICKY_PLAYER_COL_STYLE,
  zIndex: 4,
};

export default function MasterCalendarTabs({
  players,
  dayKeys,
  itemsByPlayer,
  throwingByPlayer,
  throwingFieldSchema,
  defaultTab = 'overall',
  initialTitle = 'Master Calendar',
  schoolLogoSrc,
  schoolLogoAlt = 'School logo',
  dateRangeLabel = '',
}: {
  players: PlayerRow[];
  dayKeys: string[];
  itemsByPlayer: Record<number, ProgramItem[]>;
  throwingByPlayer: Record<number, Record<string, ThrowingDayEntry>>;
  throwingFieldSchema: ThrowingFieldDef[];
  defaultTab?: MasterCalendarTab;
  initialTitle?: string;
  schoolLogoSrc?: string | null;
  schoolLogoAlt?: string;
  dateRangeLabel?: string;
}) {
  const [tab, setTab] = useState<MasterCalendarTab>(defaultTab);
  const [throwing, setThrowing] = useState(throwingByPlayer);
  const [savingThrowingKey, setSavingThrowingKey] = useState<string | null>(null);
  const [throwingClipboard, setThrowingClipboard] = useState<ThrowingClipboard | null>(null);
  const [throwingMenu, setThrowingMenu] = useState<ThrowingMenuState | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!throwingMenu) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setThrowingMenu(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [throwingMenu]);

  async function saveThrowingField(playerId: number, day: string, fieldKey: string, value: string) {
    const key = `${playerId}-${day}-${fieldKey}`;
    setSavingThrowingKey(key);
    try {
      await fetch('/api/admin/master-calendar/throwing-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, dayDate: day, fieldKey, value }),
      });
    } finally {
      setSavingThrowingKey((current) => (current === key ? null : current));
    }
  }

  function updateThrowingFieldText(playerId: number, day: string, fieldKey: string, value: string) {
    setThrowing((current) => ({
      ...current,
      [playerId]: {
        ...(current[playerId] ?? {}),
        [day]: { ...(current[playerId]?.[day] ?? {}), [fieldKey]: value },
      },
    }));
  }

  function copyThrowingPeriod(playerId: number, startDay: string) {
    const entries = dayKeys.map((_, idx) => ({ ...(throwing[playerId]?.[addDays(startDay, idx)] ?? {}) }));
    setThrowingClipboard({ playerId, entries });
    setThrowingMenu(null);
  }

  async function pasteThrowingPeriod(playerId: number, startDay: string) {
    if (!throwingClipboard) return;
    const { entries } = throwingClipboard;
    setThrowingMenu(null);
    setThrowing((current) => {
      const next = { ...current, [playerId]: { ...(current[playerId] ?? {}) } };
      entries.forEach((entry, idx) => {
        const targetDay = addDays(startDay, idx);
        next[playerId][targetDay] = { ...entry };
      });
      return next;
    });
    const writes: Promise<unknown>[] = [];
    entries.forEach((entry, idx) => {
      const targetDay = addDays(startDay, idx);
      for (const field of throwingFieldSchema) {
        writes.push(saveThrowingField(playerId, targetDay, field.key, entry[field.key] ?? ''));
      }
    });
    await Promise.all(writes);
  }

  function clearThrowingPeriod(playerId: number, startDay: string) {
    setThrowingMenu(null);
    setThrowing((current) => {
      const next = { ...current, [playerId]: { ...(current[playerId] ?? {}) } };
      dayKeys.forEach((_, idx) => {
        next[playerId][addDays(startDay, idx)] = {};
      });
      return next;
    });
    dayKeys.forEach((_, idx) => {
      const targetDay = addDays(startDay, idx);
      for (const field of throwingFieldSchema) {
        void saveThrowingField(playerId, targetDay, field.key, '');
      }
    });
  }

  async function saveTitle(value: string) {
    const trimmed = value.trim() || 'Master Calendar';
    setTitle(trimmed);
    await fetch('/api/admin/master-calendar/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
  }

  async function exportPdf() {
    const node = tableScrollRef.current;
    if (!node || isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfError(null);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
      const pageBackground = isLightTheme ? '#f8fafc' : '#05060a';

      const loadImageDataUrl = async (src: string): Promise<string | null> => {
        try {
          const response = await fetch(src);
          if (!response.ok) return null;
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('Failed reading logo.'));
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      const pearlLogoSrc = isLightTheme ? '/pearl-lockup-stacked-black-transparent.png' : '/pearl-clam-transparent.png';
      const [pearlLogoData, schoolLogoData] = await Promise.all([
        loadImageDataUrl(pearlLogoSrc),
        schoolLogoSrc ? loadImageDataUrl(schoolLogoSrc) : Promise.resolve(null),
      ]);

      // Row boundaries must be measured on the *cloned* document html2canvas
      // actually rasterizes (captured below, inside onclone), not the live
      // page -- the clone has overflow:visible/maxHeight:none and swaps
      // <input> fields for plain <div>s, both of which can shift row heights
      // slightly versus the live, scroll-clipped page. Measuring the live
      // DOM instead produced boundaries a few hundred px taller than the
      // actual rendered canvas, leaving a trailing blank page.
      let rowBoundaries: { top: number; bottom: number }[] = [];
      let theadHeight = 0;

      const exportScale = 1.5;
      const canvas = await html2canvas(node, {
        backgroundColor: pageBackground,
        scale: exportScale,
        useCORS: true,
        onclone: (doc) => {
          if (isLightTheme) doc.body.classList.add('theme-light');
          else doc.body.classList.remove('theme-light');
          const clonedRoot = doc.body.querySelector('[data-master-calendar-export-root="true"]');
          if (!(clonedRoot instanceof HTMLElement)) return;
          clonedRoot.style.overflow = 'visible';
          clonedRoot.style.maxHeight = 'none';
          clonedRoot.style.background = pageBackground;
          // html2canvas doesn't handle `position: sticky` correctly and can
          // wildly inflate the captured canvas when combined with the
          // overflow:visible override above -- the export is a static
          // document anyway, so drop sticky positioning entirely on the clone.
          clonedRoot.querySelectorAll('th, td').forEach((cell) => {
            if (cell instanceof HTMLElement && cell.style.position === 'sticky') {
              cell.style.position = 'static';
            }
          });
          const formFields = clonedRoot.querySelectorAll('input.portal-throwing-field');
          formFields.forEach((field) => {
            if (!(field instanceof HTMLInputElement)) return;
            const computed = doc.defaultView?.getComputedStyle(field);
            const replacement = doc.createElement('div');
            replacement.textContent = field.value || '';
            replacement.className = field.className;
            replacement.style.boxSizing = 'border-box';
            replacement.style.width = '100%';
            // Tighter than the live field's own min-height/padding -- this
            // clone is only ever rasterized for the PDF, so shrinking it
            // here (not on the live inputs) packs more player rows per
            // printed page without changing the on-screen web density.
            replacement.style.minHeight = '20px';
            replacement.style.padding = '0.12rem 0.4rem';
            replacement.style.border = computed?.border || '1px solid rgba(255, 255, 255, 0.24)';
            replacement.style.borderRadius = computed?.borderRadius || '6px';
            replacement.style.background = computed?.background || 'rgba(17, 20, 28, 0.92)';
            replacement.style.color = computed?.color || '#e7edf7';
            replacement.style.fontSize = computed?.fontSize || '12px';
            replacement.style.display = 'flex';
            replacement.style.alignItems = 'center';
            replacement.style.overflow = 'hidden';
            replacement.style.whiteSpace = 'nowrap';
            field.replaceWith(replacement);
          });
          clonedRoot.querySelectorAll('.portal-throwing-cell').forEach((cell) => {
            if (cell instanceof HTMLElement) {
              cell.style.gap = '0.14rem';
              cell.style.padding = '0.24rem';
            }
          });

          // Measure row boundaries here, on the clone, after every
          // clone-only style change above -- reading getBoundingClientRect()
          // forces layout, so these reflect exactly what html2canvas
          // rasterizes. offsetTop/offsetParent walking was tried first but
          // broke once the sticky->static override above changed some
          // cells' offsetParent chain, overshooting the measured height --
          // getBoundingClientRect() relative to the clone's own rect sidesteps
          // that (the clone isn't scrolled, so no live-scroll-offset issue).
          const cloneRootRect = clonedRoot.getBoundingClientRect();
          const clonedRowEls = Array.from(clonedRoot.querySelectorAll('tr[data-export-row="true"]')) as HTMLElement[];
          rowBoundaries = clonedRowEls.map((row) => {
            const rect = row.getBoundingClientRect();
            return { top: rect.top - cloneRootRect.top, bottom: rect.bottom - cloneRootRect.top };
          });
          const clonedThead = clonedRoot.querySelector('thead') as HTMLElement | null;
          theadHeight = clonedThead ? clonedThead.getBoundingClientRect().height : 0;
        },
      });

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const logoBoxSize = 28;
      const headerHeight = 34;
      const targetWidth = pageWidth - margin * 2;

      const getImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('Failed to read logo dimensions.'));
          img.src = dataUrl;
        });

      // Fit each logo inside the logoBoxSize square while preserving its
      // native aspect ratio (matches the web header's objectFit: 'contain').
      const fitLogo = (naturalWidth: number, naturalHeight: number) => {
        const scale = Math.min(logoBoxSize / naturalWidth, logoBoxSize / naturalHeight);
        return { width: naturalWidth * scale, height: naturalHeight * scale };
      };

      const [schoolLogoSize, pearlLogoSize] = await Promise.all([
        schoolLogoData ? getImageSize(schoolLogoData).catch(() => null) : Promise.resolve(null),
        pearlLogoData ? getImageSize(pearlLogoData).catch(() => null) : Promise.resolve(null),
      ]);

      const drawHeader = () => {
        if (isLightTheme) pdf.setFillColor(248, 250, 252);
        else pdf.setFillColor(5, 6, 10);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        if (schoolLogoData && schoolLogoSize) {
          const { width, height } = fitLogo(schoolLogoSize.width, schoolLogoSize.height);
          pdf.addImage(schoolLogoData, margin + (logoBoxSize - width) / 2, margin + (logoBoxSize - height) / 2, width, height);
        }
        if (pearlLogoData && pearlLogoSize) {
          const { width, height } = fitLogo(pearlLogoSize.width, pearlLogoSize.height);
          const boxX = pageWidth - margin - logoBoxSize;
          pdf.addImage(pearlLogoData, boxX + (logoBoxSize - width) / 2, margin + (logoBoxSize - height) / 2, width, height);
        }
        pdf.setTextColor(isLightTheme ? 15 : 255, isLightTheme ? 23 : 255, isLightTheme ? 42 : 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text(title, pageWidth / 2, margin + 20, { align: 'center' });
      };

      const pageContentHeight = pageHeight - margin * 2 - headerHeight; // pt
      // The final image is drawn `targetWidth` pt wide, downscaled from
      // `canvas.width` canvas-px wide -- that ratio converts a pt budget
      // into canvas-px. (canvasScale, i.e. exportScale, is CSS-px-to-canvas-px
      // and is used separately below to convert row measurements.)
      const canvasScale = exportScale;
      const ptToCanvasPx = canvas.width / targetWidth;
      const pageContentHeightPx = pageContentHeight * ptToCanvasPx;
      const theadHeightPx = theadHeight * canvasScale;

      // Build page slices that break between player rows -- never through
      // one -- so a name/row is never cut across a page boundary. Each page
      // repeats the header row (thead) above its slice of player rows.
      type PageSlice = { bodyTop: number; bodyBottom: number };
      const slices: PageSlice[] = [];
      {
        const availableBodyHeightPx = pageContentHeightPx - theadHeightPx;
        let cursor = 0; // index into rowBoundaries
        while (cursor < rowBoundaries.length) {
          const sliceStartPx = rowBoundaries[cursor].top * canvasScale;
          let sliceEndRow = cursor;
          while (
            sliceEndRow + 1 < rowBoundaries.length &&
            (rowBoundaries[sliceEndRow + 1].bottom * canvasScale - sliceStartPx) <= availableBodyHeightPx
          ) {
            sliceEndRow += 1;
          }
          // Always include at least one row per page, even if a single
          // row's block is taller than the available space (rare, but
          // safer than an infinite loop / an empty page).
          // Clamp to the actual rasterized canvas height as a safety net
          // against any residual sub-pixel rounding between the CSS-px row
          // measurements and the canvas html2canvas actually produced.
          const sliceEndPx = Math.min(rowBoundaries[sliceEndRow].bottom * canvasScale, canvas.height);
          slices.push({ bodyTop: Math.min(sliceStartPx, canvas.height), bodyBottom: sliceEndPx });
          cursor = sliceEndRow + 1;
        }
      }
      if (slices.length === 0) slices.push({ bodyTop: 0, bodyBottom: canvas.height });

      const theadTopPx = 0; // thead is the first element captured in the canvas

      for (let i = 0; i < slices.length; i += 1) {
        if (i > 0) pdf.addPage();
        drawHeader();
        const { bodyTop, bodyBottom } = slices[i];
        const bodyHeightPx = bodyBottom - bodyTop;
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = theadHeightPx + bodyHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          if (!isLightTheme) {
            ctx.fillStyle = pageBackground;
            ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          }
          // Repeat the thead (column date headers) at the top of every page slice.
          if (theadHeightPx > 0) {
            ctx.drawImage(canvas, 0, theadTopPx, canvas.width, theadHeightPx, 0, 0, canvas.width, theadHeightPx);
          }
          ctx.drawImage(canvas, 0, bodyTop, canvas.width, bodyHeightPx, 0, theadHeightPx, canvas.width, bodyHeightPx);
          const sliceImage = sliceCanvas.toDataURL('image/jpeg', 0.85);
          const sliceDisplayHeight = (sliceCanvas.height * targetWidth) / canvas.width;
          pdf.addImage(sliceImage, 'JPEG', margin, margin + headerHeight, targetWidth, sliceDisplayHeight);
        }
      }

      const fileNameDate = dateRangeLabel.split(' ')[0] || 'export';
      pdf.save(`master-calendar-${tab}-${fileNameDate}.pdf`);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Failed to generate PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  }

  function parseIntensityValue(raw: string): number | null {
    const match = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function getThrowingCellHighlightStyle(entry: ThrowingDayEntry): CSSProperties {
    const intensity = parseIntensityValue(entry?.intensity ?? '');
    if (intensity == null) return {};
    // Use a real `border` (not `boxShadow`) here -- html2canvas renders inset
    // box-shadows thicker/blurrier than the DOM does, so the PDF export's
    // highlight ring came out visibly heavier than on the web page.
    if (intensity <= 60) return { background: 'rgba(153, 27, 27, 0.30)', border: '1px solid rgba(239, 68, 68, 0.55)' };
    if (intensity >= 65 && intensity <= 85) return { background: 'rgba(202, 138, 4, 0.28)', border: '1px solid rgba(250, 204, 21, 0.55)' };
    if (intensity >= 90) return { background: 'rgba(21, 128, 61, 0.30)', border: '1px solid rgba(74, 222, 128, 0.55)' };
    return {};
  }

  function renderThrowingCell(playerId: number, day: string) {
    const entry = throwing[playerId]?.[day] ?? {};
    return (
      <div
        className="portal-throwing-cell"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('input, textarea')) return;
          setThrowingMenu({ playerId, day, x: event.clientX, y: event.clientY });
        }}
        style={{
          display: 'grid',
          gap: '0.28rem',
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.18)',
          padding: '0.4rem',
          minWidth: 170,
          cursor: 'pointer',
          ...getThrowingCellHighlightStyle(entry),
        }}
      >
        {throwingFieldSchema.map((field) => {
          const savingKeyForField = `${playerId}-${day}-${field.key}`;
          return (
            <div
              key={field.key}
              style={{ display: 'grid', gridTemplateColumns: '68px 1fr', alignItems: 'center', gap: '0.3rem', minWidth: 0 }}
            >
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {field.label}:
              </span>
              <input
                className="portal-throwing-field"
                value={entry[field.key] ?? ''}
                onChange={(event) => updateThrowingFieldText(playerId, day, field.key, event.target.value)}
                onBlur={(event) => saveThrowingField(playerId, day, field.key, event.target.value)}
                style={{
                  width: '100%',
                  minHeight: 28,
                  padding: '0.3rem 0.45rem',
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  boxSizing: 'border-box',
                  opacity: savingThrowingKey === savingKeyForField ? 0.6 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  function renderItemsCell(playerId: number, day: string, filterType?: 'workout') {
    const rows = itemsByPlayer[playerId] ?? [];
    const names = rows
      .filter((row) => row.dayDate === day && (!filterType || row.itemType === filterType))
      .map((row) => row.itemName)
      .filter(Boolean);
    if (!names.length) return <span style={{ color: 'rgba(248,113,113,0.95)' }}>None</span>;
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        {names.map((name, idx) => (
          <Link
            key={idx}
            href={`/portal/admin/schedule?playerId=${playerId}`}
            className="portal-inline-link portal-muted-text"
          >
            {name}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div className="portal-suite-page-tabs" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pdfError ? <span style={{ color: '#f87171', fontSize: '0.8rem' }}>{pdfError}</span> : null}
          <button type="button" className="btn btn-ghost" disabled={isExportingPdf} onClick={() => void exportPdf()}>
            {isExportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 56, display: 'flex', justifyContent: 'flex-start' }}>
          {schoolLogoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={schoolLogoSrc} alt={schoolLogoAlt} style={{ maxWidth: 56, maxHeight: 56, objectFit: 'contain' }} />
          ) : null}
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={(event) => void saveTitle(event.target.value)}
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: '1.5rem',
            fontWeight: 700,
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 8,
            padding: '0.25rem 0.5rem',
            color: 'var(--text-main)',
          }}
          aria-label="Master Calendar title"
        />
        <div style={{ width: 56, display: 'flex', justifyContent: 'flex-end' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pearl-clam-transparent.png"
            alt="Pearl Player Development"
            style={{ maxWidth: 56, maxHeight: 56, objectFit: 'contain' }}
          />
        </div>
      </div>

      <article className="portal-admin-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div ref={tableScrollRef} data-master-calendar-export-root="true" style={{ overflow: 'auto', maxHeight: '75vh' }}>
        <table className="portal-table" style={{ minWidth: 980, borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...STICKY_CORNER_STYLE, textAlign: 'center' }}>Player</th>
              {dayKeys.map((day) => (
                <th key={`head-${day}`} style={{ ...STICKY_HEADER_STYLE, textAlign: 'center' }}>{labelDate(day)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player.playerId} data-export-row="true">
                <td style={{ ...STICKY_PLAYER_COL_STYLE, textAlign: 'center', verticalAlign: 'middle' }}>
                  <Link href={`/portal/admin/schedule?playerId=${player.playerId}`} className="portal-inline-link">
                    <strong>{player.fullName}</strong>
                  </Link>
                </td>
                {dayKeys.map((day) => (
                  <td key={`${player.playerId}-${day}`} style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
                      {tab === 'overall' ? (
                        <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
                          {renderThrowingCell(player.playerId, day)}
                          {renderItemsCell(player.playerId, day)}
                        </div>
                      ) : tab === 'throwing' ? (
                        renderThrowingCell(player.playerId, day)
                      ) : (
                        renderItemsCell(player.playerId, day, 'workout')
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </article>

      {throwingMenu ? (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: throwingMenu.x,
            top: throwingMenu.y,
            zIndex: 80,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.95)',
            padding: '0.35rem',
            display: 'grid',
            gap: '0.25rem',
            minWidth: '190px',
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={() => copyThrowingPeriod(throwingMenu.playerId, throwingMenu.day)}>
            Copy {dayKeys.length} Day{dayKeys.length === 1 ? '' : 's'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => clearThrowingPeriod(throwingMenu.playerId, throwingMenu.day)}>
            Clear {dayKeys.length} Day{dayKeys.length === 1 ? '' : 's'}
          </button>
          {throwingClipboard ? (
            <button type="button" className="btn btn-primary" onClick={() => void pasteThrowingPeriod(throwingMenu.playerId, throwingMenu.day)}>
              Paste
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
