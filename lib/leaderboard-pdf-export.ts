// Shared by pitching/hitting/catching suites' leaderboard "Download PDF"
// button -- screenshots the actual rendered <table> (batched to stay under
// the browser's canvas-height ceiling for large leaderboards), inlines any
// MLB/proxied team logos as real PNG data so they survive the capture, and
// lays the result out across letter-size PDF pages with a shared header
// band (Pearl lockup + title/subtitle).
export async function downloadLeaderboardTablePdf(options: {
  wrapNode: HTMLElement;
  titleText: string;
  subtitleText: string;
  fileName: string;
}): Promise<void> {
  const { wrapNode, titleText, subtitleText, fileName } = options;
  const tableNode = wrapNode.querySelector('table.portal-table') as HTMLTableElement | null;
  if (!tableNode) return;
  const headerCells = Array.from(tableNode.querySelectorAll('thead th')) as HTMLElement[];
  const originalWrapMaxHeight = wrapNode.style.maxHeight;
  const originalWrapOverflowY = wrapNode.style.overflowY;
  const originalHeaderStyles = headerCells.map((cell) => ({
    node: cell,
    position: cell.style.position,
    top: cell.style.top,
    zIndex: cell.style.zIndex,
    background: cell.style.background,
    color: cell.style.color,
  }));
  const originalColoredCellStyles: Array<{ node: HTMLElement; color: string; textShadow: string }> = [];
  const originalLogoAttrs: Array<{ node: HTMLImageElement; src: string | null; srcset: string | null }> = [];
  const imageBlobToPngDataUrl = async (blob: Blob, width: number, height: number): Promise<string | null> => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        next.onload = () => resolve(next);
        next.onerror = () => reject(new Error('Failed to decode image blob for export.'));
        next.src = objectUrl;
      });
      const exportScale = 4;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * exportScale));
      canvas.height = Math.max(1, Math.round(height * exportScale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };
  try {
    const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
    wrapNode.style.maxHeight = 'none';
    wrapNode.style.overflowY = 'visible';
    for (const entry of originalHeaderStyles) {
      entry.node.style.position = 'static';
      entry.node.style.top = 'auto';
      entry.node.style.zIndex = 'auto';
      if (isLightTheme) {
        entry.node.style.background = 'rgba(248,250,252,0.98)';
        entry.node.style.color = '#0f172a';
      }
    }
    if (isLightTheme) {
      const allCells = Array.from(tableNode.querySelectorAll('td, th')) as HTMLElement[];
      for (const cell of allCells) {
        const style = window.getComputedStyle(cell);
        const bg = String(style.backgroundColor || '').trim();
        const match = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
        if (!match) continue;
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (!Number.isFinite(alpha) || alpha <= 0.03) continue;
        const r = Number(match[1]);
        const g = Number(match[2]);
        const b = Number(match[3]);
        if (![r, g, b].every(Number.isFinite)) continue;
        const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        const nextColor = luminance >= 170 ? '#0f172a' : '#f8fafc';
        originalColoredCellStyles.push({ node: cell, color: cell.style.color, textShadow: cell.style.textShadow });
        cell.style.color = nextColor;
        cell.style.textShadow = 'none';
      }
    }
    const logoNodes = Array.from(tableNode.querySelectorAll('img')) as HTMLImageElement[];
    for (const logoNode of logoNodes) {
      const srcRaw = (logoNode.getAttribute('src') || logoNode.src || '').trim();
      if (!srcRaw) continue;
      let parsed: URL | null = null;
      try {
        parsed = new URL(srcRaw, window.location.origin);
      } catch {
        parsed = null;
      }
      const parsedUrl = parsed ? parsed.toString() : '';
      const isMlbStaticLogo = !!parsed && ['www.mlbstatic.com', 'mlbstatic.com'].includes(parsed.hostname.toLowerCase());
      const isProxyLogo = parsedUrl.includes('/api/dashboard/image-proxy?url=');
      if (!isMlbStaticLogo && !isProxyLogo) continue;
      const captureSrc = isMlbStaticLogo
        ? `/api/dashboard/image-proxy?url=${encodeURIComponent(parsedUrl)}`
        : parsedUrl;
      originalLogoAttrs.push({
        node: logoNode,
        src: logoNode.getAttribute('src'),
        srcset: logoNode.getAttribute('srcset'),
      });
      logoNode.setAttribute('src', captureSrc);
      logoNode.removeAttribute('srcset');
      await new Promise<void>((resolve) => {
        if (logoNode.complete && logoNode.naturalWidth > 0) {
          resolve();
          return;
        }
        const onDone = () => {
          logoNode.onload = null;
          logoNode.onerror = null;
          resolve();
        };
        logoNode.onload = onDone;
        logoNode.onerror = onDone;
      });
      try {
        const rect = logoNode.getBoundingClientRect();
        const width = Math.max(1, rect.width || logoNode.naturalWidth || 16);
        const height = Math.max(1, rect.height || logoNode.naturalHeight || 16);
        const response = await fetch(captureSrc, { cache: 'force-cache' });
        if (!response.ok) continue;
        const blob = await response.blob();
        const pngDataUrl = await imageBlobToPngDataUrl(blob, width, height);
        if (!pngDataUrl) continue;
        logoNode.setAttribute('src', pngDataUrl);
        await new Promise<void>((resolve) => {
          if (logoNode.complete && logoNode.naturalWidth > 0) {
            resolve();
            return;
          }
          const onDone = () => {
            logoNode.onload = null;
            logoNode.onerror = null;
            resolve();
          };
          logoNode.onload = onDone;
          logoNode.onerror = onDone;
        });
      } catch {
        // Keep proxied src if PNG inlining fails.
      }
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const captureScale = Math.min(2, Math.max(1.4, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    // Most browsers silently blank out (or corrupt) canvas content beyond
    // ~16,384px in either dimension -- a single html2canvas(tableNode, ...)
    // call captures the WHOLE table at once, so a large table (LEAGUE's
    // leaderboard can be hundreds of rows) times captureScale routinely
    // exceeds that ceiling and produces a canvas that reports a huge
    // height but renders blank past the limit -- every downstream PDF
    // page slice from that region is then blank too. Capturing the table
    // header once and the body in row-count batches that each stay well
    // under the limit avoids ever asking the browser for an oversized
    // canvas in the first place.
    const MAX_CAPTURE_SOURCE_HEIGHT = 8000;
    const theadNode = tableNode.querySelector('thead') as HTMLElement | null;
    const tbodyNode = tableNode.querySelector('tbody') as HTMLElement | null;
    const bodyRows = tbodyNode ? (Array.from(tbodyNode.children) as HTMLElement[]) : [];
    const captureBatches: HTMLCanvasElement[] = [];
    const captureNode = async (node: HTMLElement): Promise<HTMLCanvasElement> =>
      html2canvas(node, {
        backgroundColor: isLightTheme ? '#f8fafc' : '#000000',
        scale: captureScale,
        useCORS: true,
        logging: false,
      });
    // The real table has no fixed layout -- column widths come from auto
    // layout across ALL rows at once. A batch containing only a subset of
    // body rows in its own standalone <table> would auto-size its columns
    // independently, misaligning it against the header capture and every
    // other batch. Measuring the live header cells' actual pixel widths
    // and pinning every batch table to those same widths via <colgroup>
    // keeps every batch's columns identical to the real table's.
    const headerCellWidths = theadNode
      ? (Array.from(theadNode.querySelectorAll('tr:last-child > *')) as HTMLElement[]).map(
          (cell) => cell.getBoundingClientRect().width
        )
      : [];
    const tableWidthPx = tableNode.getBoundingClientRect().width;
    const buildColgroup = (): HTMLTableColElement[] =>
      headerCellWidths.map((w) => {
        const col = document.createElement('col');
        col.style.width = `${w}px`;
        return col;
      });
    if (theadNode) captureBatches.push(await captureNode(theadNode));
    if (bodyRows.length > 0) {
      let batchStart = 0;
      while (batchStart < bodyRows.length) {
        let batchEnd = batchStart;
        let batchHeight = 0;
        while (batchEnd < bodyRows.length) {
          const rowHeight = bodyRows[batchEnd].getBoundingClientRect().height || 0;
          if (batchEnd > batchStart && batchHeight + rowHeight > MAX_CAPTURE_SOURCE_HEIGHT) break;
          batchHeight += rowHeight;
          batchEnd += 1;
        }
        const batchWrap = document.createElement('table');
        batchWrap.className = tableNode.className;
        if (headerCellWidths.length) {
          const colgroup = document.createElement('colgroup');
          for (const col of buildColgroup()) colgroup.appendChild(col);
          batchWrap.appendChild(colgroup);
          batchWrap.style.tableLayout = 'fixed';
        }
        const batchTbody = document.createElement('tbody');
        for (const row of bodyRows.slice(batchStart, batchEnd)) batchTbody.appendChild(row.cloneNode(true) as HTMLElement);
        batchWrap.appendChild(batchTbody);
        batchWrap.style.position = 'fixed';
        batchWrap.style.top = '-100000px';
        batchWrap.style.left = '0';
        batchWrap.style.width = `${tableWidthPx}px`;
        document.body.appendChild(batchWrap);
        try {
          captureBatches.push(await captureNode(batchWrap));
        } finally {
          document.body.removeChild(batchWrap);
        }
        batchStart = batchEnd;
      }
    } else if (!theadNode) {
      captureBatches.push(await captureNode(tableNode));
    }
    const rawW = Math.max(1, ...captureBatches.map((c) => c.width));
    const totalRawH = captureBatches.reduce((sum, c) => sum + c.height, 0);
    const orientation: 'portrait' | 'landscape' = rawW >= totalRawH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'pt',
      format: 'letter',
    });
    // Pearl lockup, top-right of every page. Loaded once as a data URL
    // (jsPDF's addImage needs actual image data, not a URL) and reused
    // across pages -- a fetch failure just means no logo, not a broken PDF.
    const pearlLogoDataUrl = await (async () => {
      try {
        const response = await fetch('/pearl-lockup-transparent.png', { cache: 'force-cache' });
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
    const PEARL_LOGO_ASPECT = 1554 / 402;
    const margin = 18;
    const logoHeight = pearlLogoDataUrl ? 22 : 0;
    const logoWidth = logoHeight * PEARL_LOGO_ASPECT;
    const titleBandHeight = 34;
    const headerBandHeight = Math.max(logoHeight, titleBandHeight) + 12;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentTop = margin + headerBandHeight;
    const maxContentWidth = Math.max(1, pageWidth - margin * 2);
    const contentHeight = Math.max(1, pageHeight - contentTop - margin);
    // Filling the full page width unconditionally stretches a narrower
    // table's columns wider than they render on web -- cap the scale
    // factor at 1:1 (CSS px per pt) so a table that doesn't naturally need
    // the whole page width isn't blown up just because the page is wide.
    const scale = Math.min(maxContentWidth / rawW, 1 / captureScale);
    const contentWidth = Math.max(1, rawW * scale);
    const pageSourceHeight = Math.max(1, Math.floor(contentHeight / Math.max(scale, 1e-6)));
    const drawPageChrome = (isFirst: boolean) => {
      if (isLightTheme) pdf.setFillColor(248, 250, 252);
      else pdf.setFillColor(4, 5, 7);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      if (pearlLogoDataUrl) {
        pdf.addImage(pearlLogoDataUrl, 'PNG', pageWidth - margin - logoWidth, margin, logoWidth, logoHeight, undefined, 'FAST');
      }
      if (isFirst) {
        pdf.setTextColor(isLightTheme ? '#0f172a' : '#f8fafc');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text(titleText, margin, margin + 16);
        if (subtitleText) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor(isLightTheme ? '#475569' : '#94a3b8');
          pdf.text(subtitleText, margin, margin + 30);
        }
      }
    };
    // Batches exist purely to keep each individual html2canvas capture
    // under the browser's canvas-height ceiling -- they are NOT page
    // breaks. Treating each batch as its own page (the previous version)
    // stretched the short header batch to fill an entire page by itself,
    // pushing all body rows onto page 2. Instead, walk every batch's rows
    // as one continuous source-height timeline sliced into fixed-height
    // page windows, so a page break only happens when a page's worth of
    // content (pageSourceHeight) has actually been filled -- the header
    // and the first chunk of body rows land on the same page together,
    // same as the single-canvas version did before batching was added.
    type PageState = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; used: number };
    const pages: PageState[] = [];
    const newPageState = (): PageState => {
      const canvas = document.createElement('canvas');
      canvas.width = rawW;
      canvas.height = pageSourceHeight;
      return { canvas, ctx: canvas.getContext('2d'), used: 0 };
    };
    let current = newPageState();
    pages.push(current);
    for (const batchCanvas of captureBatches) {
      const batchW = Math.max(1, batchCanvas.width);
      const batchH = Math.max(1, batchCanvas.height);
      let sourceY = 0;
      while (sourceY < batchH) {
        if (pageSourceHeight - current.used <= 0) {
          current = newPageState();
          pages.push(current);
          continue;
        }
        const chunkHeight = Math.min(pageSourceHeight - current.used, batchH - sourceY);
        current.ctx?.drawImage(batchCanvas, 0, sourceY, batchW, chunkHeight, 0, current.used, batchW, chunkHeight);
        current.used += chunkHeight;
        sourceY += chunkHeight;
      }
    }
    let isFirstPage = true;
    for (const page of pages) {
      if (!page.used) continue;
      if (!isFirstPage) pdf.addPage('letter', orientation);
      drawPageChrome(isFirstPage);
      isFirstPage = false;
      const drawHeight = page.used * scale;
      pdf.addImage(page.canvas.toDataURL('image/jpeg', 0.82), 'JPEG', margin, contentTop, contentWidth, drawHeight, undefined, 'FAST');
    }
    pdf.save(fileName);
  } finally {
    for (const entry of originalLogoAttrs) {
      if (entry.src === null) entry.node.removeAttribute('src');
      else entry.node.setAttribute('src', entry.src);
      if (entry.srcset === null) entry.node.removeAttribute('srcset');
      else entry.node.setAttribute('srcset', entry.srcset);
    }
    for (const entry of originalHeaderStyles) {
      entry.node.style.position = entry.position;
      entry.node.style.top = entry.top;
      entry.node.style.zIndex = entry.zIndex;
      entry.node.style.background = entry.background;
      entry.node.style.color = entry.color;
    }
    for (const entry of originalColoredCellStyles) {
      entry.node.style.color = entry.color;
      entry.node.style.textShadow = entry.textShadow;
    }
    wrapNode.style.maxHeight = originalWrapMaxHeight;
    wrapNode.style.overflowY = originalWrapOverflowY;
  }
}
