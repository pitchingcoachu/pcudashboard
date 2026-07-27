'use client';

import { useEffect, useMemo, useState } from 'react';

type ScriptTemplate = {
  id: string;
  name: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
};

type ScriptState = {
  current: { title: string; rowCount: number; columns: string[]; rows: string[][] };
  selectedTemplateId: string;
  visibleTemplateIds: string[];
};

function buildRows(rowCount: number, columnCount: number, rows?: string[][]): string[][] {
  const safeRows = Math.max(1, Math.min(300, rowCount || 20));
  const safeCols = Math.max(1, Math.min(16, columnCount || 6));
  const base = Array.isArray(rows)
    ? rows.slice(0, safeRows).map((row) => {
        const values = Array.isArray(row) ? row.slice(0, safeCols).map((value) => String(value ?? '')) : [];
        while (values.length < safeCols) values.push('');
        return values;
      })
    : [];
  while (base.length < safeRows) base.push(Array.from({ length: safeCols }, () => ''));
  return base;
}

export default function SharedScriptReadonly({
  mode,
  templates,
  state,
  notes = '',
}: {
  mode: 'bullpen' | 'velocity';
  templates: ScriptTemplate[];
  state: ScriptState;
  notes?: string;
}) {
  const [exportError, setExportError] = useState('');
  const visibleTemplates = useMemo(() => {
    const visibleSet = new Set((state.visibleTemplateIds ?? []).map((value) => String(value ?? '')));
    const filtered = templates.filter((template) => visibleSet.has(template.id));
    const hasNewSharedTemplates = templates.some((template) => !visibleSet.has(template.id));
    return filtered.length && !hasNewSharedTemplates ? filtered : templates;
  }, [state.visibleTemplateIds, templates]);
  const [selectedId, setSelectedId] = useState(state.selectedTemplateId || visibleTemplates[0]?.id || '');
  useEffect(() => {
    if (!visibleTemplates.length) return;
    if (visibleTemplates.some((template) => template.id === selectedId)) return;
    setSelectedId(visibleTemplates[0]?.id ?? '');
  }, [selectedId, visibleTemplates]);
  const selectedTemplate = visibleTemplates.find((template) => template.id === selectedId) ?? null;
  const current = selectedTemplate
    ? {
        title: selectedTemplate.name,
        columns: selectedTemplate.columns,
        rowCount: selectedTemplate.rowCount,
        rows: selectedTemplate.rows,
      }
    : state.current;

  const downloadScriptPdf = async () => {
    try {
      setExportError('');
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 28;
      const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
      const pearlLogoSrc = isLightTheme
        ? '/pearl-lockup-stacked-black-transparent.png'
        : '/pearl-clam-transparent.png';

      const loadImageDataUrl = async (src: string): Promise<string | null> => {
        try {
          const response = await fetch(src);
          if (!response.ok) return null;
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('Failed reading image.'));
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      const [leftLogo, rightLogo] = await Promise.all([
        loadImageDataUrl(pearlLogoSrc),
        loadImageDataUrl(pearlLogoSrc),
      ]);

      const logoW = 42;
      const logoH = 42;
      if (!isLightTheme) {
        pdf.setFillColor(8, 10, 16);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
      if (leftLogo) pdf.addImage(leftLogo, 'PNG', margin, margin - 8, logoW, logoH);
      if (rightLogo) pdf.addImage(rightLogo, 'PNG', pageWidth - margin - logoW, margin - 8, logoW, logoH);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(isLightTheme ? 15 : 248, isLightTheme ? 23 : 250, isLightTheme ? 42 : 252);
      const scriptTitle = current.title?.trim() || (mode === 'velocity' ? 'Velocity Script' : 'Bullpen Script');
      pdf.text(scriptTitle, pageWidth / 2, margin + 12, { align: 'center' });

      const headers = ['Pitch #', ...current.columns.map((value) => value.trim() || 'Column')];
      const dynamicCount = current.columns.length;
      const dynamicWidths = current.columns.map((_, idx) => {
        if (idx === dynamicCount - 1) return 180;
        if (idx === dynamicCount - 2) return 138;
        return 95;
      });
      const colWidths = [52, ...dynamicWidths];
      const tableWidth = colWidths.reduce((sum, width) => sum + width, 0);
      const startX = Math.max(margin, (pageWidth - tableWidth) / 2);
      let y = margin + 56;
      const rows = buildRows(current.rowCount, current.columns.length, current.rows);
      const rowCountTotal = rows.length + 1;
      const availableHeight = Math.max(1, pageHeight - y - margin);
      const rowHeight = Math.max(8, Math.min(20, availableHeight / Math.max(1, rowCountTotal)));
      const headerFontSize = Math.max(6.5, Math.min(10, rowHeight * 0.46));
      const rowFontSize = Math.max(6, Math.min(9, rowHeight * 0.44));
      const baselineY = rowHeight * 0.68;

      const drawRow = (cells: string[], isHeader = false) => {
        let x = startX;
        pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
        pdf.setFontSize(isHeader ? headerFontSize : rowFontSize);
        for (let i = 0; i < cells.length; i += 1) {
          const width = colWidths[i];
          if (isHeader) {
            if (isLightTheme) pdf.setFillColor(241, 245, 249);
            else pdf.setFillColor(20, 26, 37);
            pdf.rect(x, y, width, rowHeight, 'F');
          }
          pdf.setDrawColor(isLightTheme ? 148 : 71, isLightTheme ? 163 : 85, isLightTheme ? 184 : 105);
          pdf.setLineWidth(0.6);
          pdf.rect(x, y, width, rowHeight);
          pdf.setTextColor(isLightTheme ? 15 : 241, isLightTheme ? 23 : 245, isLightTheme ? 42 : 249);
          pdf.text(String(cells[i] ?? ''), x + width / 2, y + baselineY, { align: 'center', maxWidth: width - 8 });
          x += width;
        }
        y += rowHeight;
      };

      drawRow(headers, true);
      for (let idx = 0; idx < rows.length; idx += 1) {
        const row = rows[idx];
        drawRow([String(idx + 1), ...row.map((value) => String(value ?? ''))]);
      }

      const safeTitle = scriptTitle.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || (mode === 'velocity' ? 'velocity-script' : 'bullpen-script');
      pdf.save(`${safeTitle}.pdf`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export PDF.');
    }
  };

  return (
    <section className="portal-schedule-calendar" style={{ gridColumn: '1 / -1', width: '100%' }}>
      <h3 className="portal-schedule-period">{mode === 'velocity' ? 'Velocity' : 'Bullpens'}</h3>
      <div style={{ display: 'grid', gap: 10 }}>
      {notes.trim() ? (
        <div className="portal-panel" style={{ minHeight: 'unset' }}>
          <h4 style={{ marginTop: 0 }}>Notes</h4>
          <p className="portal-muted-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{notes.trim()}</p>
        </div>
      ) : null}
      {visibleTemplates.length > 0 ? (
        <label style={{ maxWidth: 420 }}>
          Template
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {visibleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div>
        <button type="button" className="btn btn-ghost" onClick={() => void downloadScriptPdf()}>
          Download PDF
        </button>
      </div>
      {exportError ? <p className="auth-error" style={{ margin: 0 }}>{exportError}</p> : null}
      <div
        className="portal-panel"
        style={{
          minHeight: 'unset',
          padding: '0.75rem',
          borderRadius: 10,
          border: '1px solid var(--calendar-grid-border, var(--border))',
          background: 'rgba(0,0,0,0.16)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '56px 1fr 56px',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.6rem',
          }}
        >
          <img src="/pearl-clam-transparent.png" alt="Pearl Player Development" style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'start' }} />
          <h3 style={{ margin: 0, textAlign: 'center', fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.01em' }}>
            {current.title?.trim() || (mode === 'velocity' ? 'Velocity Script' : 'Bullpen Script')}
          </h3>
          <img src="/pearl-clam-transparent.png" alt="Pearl Player Development" style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'end' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                {['Pitch #', ...current.columns.map((value) => value.trim() || 'Column')].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'center',
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      padding: '0.4rem 0.35rem',
                      borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                      borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildRows(current.rowCount, current.columns.length, current.rows).map((row, idx) => (
                <tr key={`row-${idx}`}>
                  <td
                    style={{
                      textAlign: 'center',
                      fontWeight: 700,
                      padding: '0.32rem',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idx + 1}
                  </td>
                  {current.columns.map((_, fieldIdx) => (
                    <td
                      key={`cell-${idx}-${fieldIdx}`}
                      style={{
                        padding: '0.2rem',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                      }}
                    >
                      <input
                        className="portal-schedule-control"
                        value={String(row[fieldIdx] ?? '')}
                        readOnly
                        style={{
                          width: '100%',
                          minWidth:
                            fieldIdx === current.columns.length - 1
                              ? 260
                              : fieldIdx === current.columns.length - 2
                                ? 180
                                : fieldIdx === 2
                                  ? 120
                                  : 95,
                          borderRadius: 7,
                          padding: '0.35rem 0.45rem',
                          textAlign: 'center',
                          fontSize: '1.02rem',
                          fontWeight: 600,
                          opacity: 0.95,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </section>
  );
}
