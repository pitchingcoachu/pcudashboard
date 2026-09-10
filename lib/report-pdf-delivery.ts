'use client';

export type ReportPdfProfileOptions = {
  title?: string;
  preferredPlayerId?: number | null;
  preferredPlayerName?: string;
};

type PdfDocument = {
  save(fileName: string): void;
  output(type: 'blob'): Blob;
};

export const REPORT_PDF_READY_EVENT = 'pearl:report-pdf-ready';

let pendingProfileSave: ReportPdfProfileOptions | null = null;

/** Runs an existing PDF exporter in profile-save mode. The exporter still
 * builds the exact same document, but deliverReportPdf sends it to the shared
 * profile picker instead of downloading it. */
export async function prepareReportPdfForProfile(
  generate: () => void | Promise<void>,
  options: ReportPdfProfileOptions = {},
): Promise<void> {
  if (pendingProfileSave) throw new Error('Another report is already being prepared.');
  pendingProfileSave = options;
  try {
    await generate();
    if (pendingProfileSave) throw new Error('This report could not be prepared for profile saving.');
  } finally {
    pendingProfileSave = null;
  }
}

/** Final step for every report PDF. Normal exports download as before; a
 * profile-save request emits the PDF blob to the portal-wide save dialog. */
export function deliverReportPdf(
  pdf: PdfDocument,
  fileName: string,
  fallbackTitle?: string,
): void {
  const request = pendingProfileSave;
  if (!request) {
    pdf.save(fileName);
    return;
  }

  pendingProfileSave = null;
  const title = String(request.title ?? fallbackTitle ?? fileName.replace(/\.pdf$/i, '')).trim();
  const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
  window.dispatchEvent(new CustomEvent(REPORT_PDF_READY_EVENT, {
    detail: {
      file,
      title,
      preferredPlayerId: request.preferredPlayerId ?? null,
      preferredPlayerName: request.preferredPlayerName ?? '',
    },
  }));
}
