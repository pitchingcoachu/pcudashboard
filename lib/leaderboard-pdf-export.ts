/** Shared tail end of both PDF export functions below: takes a set of
 * already-captured canvas "batches" (each under the browser's canvas-height
 * ceiling), walks them as one continuous source-height timeline, slices
 * that into letter-size pages, and draws the shared header chrome (Pearl
 * lockup + title/subtitle on page 1) on each page. */
async function renderCaptureBatchesToPdf(options: {
  captureBatches: HTMLCanvasElement[];
  captureScale: number;
  isLightTheme: boolean;
  titleText: string;
  /** Optional bold line rendered directly below titleText (e.g. a player's
   * name) -- distinct from subtitleText, which renders smaller/muted below
   * this line instead of right below the title. */
  nameText?: string;
  subtitleText: string;
  fileName: string;
  /** Fit everything on one page by sizing a CUSTOM page height to the
   * content instead of paginating across fixed US Letter pages. The
   * content's own row/heatmap count varies a lot (a pitcher with 6 pitch
   * types has a much taller report than one with 2), so a fixed page size
   * either wastes space or spills onto an awkward, half-empty second page
   * -- fitting the page to the content avoids both. Width stays at Letter
   * width; only height grows. */
  singlePage?: boolean;
}): Promise<void> {
  const { captureBatches, captureScale, isLightTheme, titleText, nameText, subtitleText, fileName, singlePage } = options;
  const { jsPDF } = await import('jspdf');
  const rawW = Math.max(1, ...captureBatches.map((c) => c.width));
  const totalRawH = captureBatches.reduce((sum, c) => sum + c.height, 0);
  const orientation: 'portrait' | 'landscape' = rawW >= totalRawH ? 'landscape' : 'portrait';
  const LETTER_WIDTH_PT = 612;
  const LETTER_HEIGHT_PT = 792;
  const pdf = singlePage
    ? new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        // Placeholder format -- replaced below once the real content
        // height is known (needs pageWidth/scale computed from a real pdf
        // instance first, so this can't be sized in one shot).
        format: [LETTER_WIDTH_PT, LETTER_HEIGHT_PT],
      })
    : new jsPDF({
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
  const titleBandHeight = nameText ? 48 : 34;
  const headerBandHeight = Math.max(logoHeight, titleBandHeight) + 12;
  let pageWidth = pdf.internal.pageSize.getWidth();
  let pageHeight = pdf.internal.pageSize.getHeight();
  const contentTop = margin + headerBandHeight;
  const maxContentWidth = Math.max(1, pageWidth - margin * 2);
  // Filling the full page width unconditionally stretches narrower content
  // wider than it renders on web -- cap the scale factor at 1:1 (CSS px per
  // pt) so content that doesn't naturally need the whole page width isn't
  // blown up just because the page is wide.
  const scale = Math.min(maxContentWidth / rawW, 1 / captureScale);
  const contentWidth = Math.max(1, rawW * scale);
  let contentHeight = Math.max(1, pageHeight - contentTop - margin);
  let pageSourceHeight = Math.max(1, Math.floor(contentHeight / Math.max(scale, 1e-6)));
  if (singlePage) {
    // Now that scale is known, resize the page height to fit the ENTIRE
    // capture on one page (width stays at Letter width) instead of
    // whatever arbitrary placeholder height the pdf was constructed with.
    const neededContentHeight = totalRawH * scale;
    pageHeight = contentTop + neededContentHeight + margin;
    pageWidth = LETTER_WIDTH_PT;
    // jsPDF's type declarations omit setWidth/setHeight even though they
    // exist at runtime on internal.pageSize -- cast to access them.
    const pageSize = pdf.internal.pageSize as unknown as { setWidth(w: number): void; setHeight(h: number): void };
    pageSize.setWidth(pageWidth);
    pageSize.setHeight(pageHeight);
    contentHeight = neededContentHeight;
    pageSourceHeight = Math.max(1, Math.ceil(totalRawH));
  }
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
      const nameY = margin + 32;
      if (nameText) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(13);
        pdf.text(nameText, margin, nameY);
      }
      if (subtitleText) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(isLightTheme ? '#475569' : '#94a3b8');
        pdf.text(subtitleText, margin, nameText ? nameY + 14 : margin + 30);
      }
    }
  };
  // Batches exist purely to keep each individual html2canvas capture under
  // the browser's canvas-height ceiling -- they are NOT page breaks.
  // Treating each batch as its own page would stretch a short batch to
  // fill an entire page by itself. Instead, walk every batch's rows as one
  // continuous source-height timeline sliced into fixed-height page
  // windows, so a page break only happens when a page's worth of content
  // (pageSourceHeight) has actually been filled.
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
    // page.canvas is always allocated at the full pageSourceHeight (the
    // per-page budget), but page.used is usually less than that -- short
    // content never fills a whole page. toDataURL() on the full canvas
    // serializes ALL of it, including the blank space below the real
    // content; addImage() then scales that entire (mostly blank) image
    // into a box sized only for the real content's height (drawHeight),
    // which squashes the real content into a fraction of that box while
    // width scales at the full intended factor -- an asymmetric
    // width-vs-height scale that reads as "stretched" text. Cropping to
    // just the used region before encoding keeps the image's own aspect
    // ratio consistent with drawHeight/contentWidth.
    let sourceCanvas = page.canvas;
    if (page.used < page.canvas.height) {
      const cropped = document.createElement('canvas');
      cropped.width = page.canvas.width;
      cropped.height = page.used;
      cropped.getContext('2d')?.drawImage(page.canvas, 0, 0, page.canvas.width, page.used, 0, 0, page.canvas.width, page.used);
      sourceCanvas = cropped;
    }
    pdf.addImage(sourceCanvas.toDataURL('image/jpeg', 0.82), 'JPEG', margin, contentTop, contentWidth, drawHeight, undefined, 'FAST');
  }
  pdf.save(fileName);
}

/** For a content block that ISN'T a table -- a mix of summary cards, a
 * heatmap, stat tiles, etc. (e.g. Intended Zones' session export, which
 * needs the stat tiles and miss-direction heatmap alongside the pitch log
 * table, not just the table alone). Screenshots the whole node in
 * height-limited horizontal strips (same technique downloadLeaderboardTablePdf
 * uses for table row batches, generalized to an arbitrary node) and reuses
 * the same paginated-PDF-with-header-chrome renderer. */
export async function downloadContentPdf(options: {
  node: HTMLElement;
  titleText: string;
  /** Optional bold line rendered directly below titleText (e.g. a
   * player's name), distinct from the smaller/muted subtitleText line. */
  nameText?: string;
  subtitleText: string;
  fileName: string;
  /** Size the PDF to exactly one page fit to the content's own height
   * instead of paginating across fixed US Letter pages -- see
   * renderCaptureBatchesToPdf's singlePage option. */
  singlePage?: boolean;
  /** When the live node is squeezed into a narrower container than its
   * "natural" desktop layout (e.g. this same component embedded in a
   * sidebar column elsewhere in the app), force the CLONED node to this
   * width before capture so the export always looks like the component's
   * full desktop layout -- matching what it produces when it has the
   * whole page to itself -- rather than whatever cramped/wrapped shape
   * it happens to be rendered at on screen right now. */
  forceWidth?: number;
}): Promise<void> {
  const { node, titleText, nameText, subtitleText, fileName, singlePage, forceWidth } = options;
  const { default: html2canvas } = await import('html2canvas');
  const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
  const captureScale = Math.min(2, Math.max(1.4, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  // Same reasoning as the table exporter: a single html2canvas(node) call
  // captures the WHOLE node at once, and tall content times captureScale
  // can exceed the browser's canvas-height ceiling (~16,384px). Capturing
  // in fixed-height horizontal strips (cloning nothing -- just scrolling
  // the capture window down the live node) keeps every individual capture
  // well under that limit.
  const MAX_CAPTURE_SOURCE_HEIGHT = 4000;
  // When forcing a wider layout, measure that wider height instead of the
  // live (possibly narrower/taller-from-wrapping) node's own rect -- a
  // dry-run clone-and-measure pass, discarded, just to get an accurate
  // totalHeight for the real capture loop below.
  let totalHeight = Math.max(1, Math.ceil(node.getBoundingClientRect().height));
  if (forceWidth) {
    const probeCanvas = await html2canvas(node, {
      backgroundColor: isLightTheme ? '#f8fafc' : '#000000',
      scale: 1,
      useCORS: true,
      logging: false,
      windowWidth: Math.max(forceWidth + 200, document.documentElement.scrollWidth),
      onclone: (clonedDoc, clonedNode) => {
        clonedNode.style.width = `${forceWidth}px`;
        clonedNode.style.maxWidth = `${forceWidth}px`;
        clonedDoc.querySelectorAll('[data-pdf-hide="true"]').forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      },
    });
    totalHeight = probeCanvas.height;
  }
  const captureBatches: HTMLCanvasElement[] = [];
  let y = 0;
  while (y < totalHeight) {
    const sliceHeight = Math.min(MAX_CAPTURE_SOURCE_HEIGHT, totalHeight - y);
    const canvas = await html2canvas(node, {
      backgroundColor: isLightTheme ? '#f8fafc' : '#000000',
      scale: captureScale,
      useCORS: true,
      logging: false,
      y,
      height: sliceHeight,
      windowWidth: forceWidth ? Math.max(forceWidth + 200, document.documentElement.scrollWidth) : document.documentElement.scrollWidth,
      // Some elements should show on-screen but not in the exported PDF
      // (e.g. a heading that's redundant once the PDF has its own title) --
      // mutating the CLONED document here (rather than the live node) lets
      // that content collapse out of the capture's layout entirely instead
      // of just being painted-over, leaving no gap where it was.
      onclone: (clonedDoc, clonedNode) => {
        if (forceWidth) {
          clonedNode.style.width = `${forceWidth}px`;
          clonedNode.style.maxWidth = `${forceWidth}px`;
        }
        clonedDoc.querySelectorAll('[data-pdf-hide="true"]').forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      },
    });
    captureBatches.push(canvas);
    y += sliceHeight;
  }
  await renderCaptureBatchesToPdf({ captureBatches, captureScale, isLightTheme, titleText, nameText, subtitleText, fileName, singlePage });
}

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
  /** Defaults to 'table.portal-table' (every existing caller's table class).
   * Pass a different selector for a table that isn't tagged with that
   * global class, e.g. a CSS-module table like Intended Zones' .logTable. */
  tableSelector?: string;
}): Promise<void> {
  const { wrapNode, titleText, subtitleText, fileName, tableSelector = 'table.portal-table' } = options;
  const tableNode = wrapNode.querySelector(tableSelector) as HTMLTableElement | null;
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
  const originalTableWidth = tableNode.style.width;
  const originalTableMinWidth = tableNode.style.minWidth;
  const originalTableDisplay = tableNode.style.display;
  try {
    const isLightTheme = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
    wrapNode.style.maxHeight = 'none';
    wrapNode.style.overflowY = 'visible';
    // .portal-table has width:100% AND min-width:720px, so it always
    // stretches to fill its container (or at least 720px) regardless of
    // row/column count -- with few narrow columns that spreads sparse
    // content out with large gaps, which the capture below would otherwise
    // screenshot faithfully. width:auto alone doesn't override min-width
    // (min-width always wins over a smaller computed width), so both must
    // be cleared for the table to actually shrink to its content for the
    // capture; restored in `finally`.
    tableNode.style.display = 'inline-table';
    tableNode.style.width = 'auto';
    tableNode.style.minWidth = '0';
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
    // Capturing theadNode in place (its normal position inside tableNode)
    // is unreliable once the table has been shrunk to its natural content
    // width above: getBoundingClientRect() on the live thead correctly
    // reports the new, narrower width, but offsetWidth/scrollWidth --
    // what html2canvas actually sizes its capture canvas from -- can keep
    // reporting the table's OLD, pre-shrink width (a real, reproduced
    // browser quirk, not a fixed-position/sticky artifact). That stale
    // wide header canvas then wins the rawW = max(...) below, stretching
    // the entire page to the header's old width even though every body
    // batch capture is correctly sized. Cloning the header into its own
    // fixed-width standalone table -- exactly like each body batch already
    // is -- sidesteps the stale-measurement path entirely.
    if (theadNode) {
      const headerWrap = document.createElement('table');
      headerWrap.className = tableNode.className;
      if (headerCellWidths.length) {
        const colgroup = document.createElement('colgroup');
        for (const col of buildColgroup()) colgroup.appendChild(col);
        headerWrap.appendChild(colgroup);
        headerWrap.style.tableLayout = 'fixed';
      }
      headerWrap.appendChild(theadNode.cloneNode(true) as HTMLElement);
      headerWrap.style.position = 'fixed';
      headerWrap.style.top = '-100000px';
      headerWrap.style.left = '0';
      headerWrap.style.width = `${tableWidthPx}px`;
      document.body.appendChild(headerWrap);
      try {
        captureBatches.push(await captureNode(headerWrap));
      } finally {
        document.body.removeChild(headerWrap);
      }
    }
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
    await renderCaptureBatchesToPdf({ captureBatches, captureScale, isLightTheme, titleText, subtitleText, fileName });
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
    tableNode.style.width = originalTableWidth;
    tableNode.style.minWidth = originalTableMinWidth;
    tableNode.style.display = originalTableDisplay;
  }
}
