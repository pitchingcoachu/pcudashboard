'use client';

import { useRef } from 'react';

type EmailTemplateEditorProps = {
  initialFromName: string;
  initialFromEmail: string;
  initialSubject: string;
  initialBodyText: string;
  initialBodyHtml: string;
};

const toolbarButtonStyle = {
  padding: '0.45rem 0.7rem',
  minHeight: 0,
};

export default function EmailTemplateEditor({
  initialFromName,
  initialFromEmail,
  initialSubject,
  initialBodyText,
  initialBodyHtml,
}: EmailTemplateEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const bodyHtmlInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextInputRef = useRef<HTMLInputElement | null>(null);
  const initialEditorHtml = initialBodyHtml || textToHtml(initialBodyText);

  const syncFromEditor = () => {
    const html = editorRef.current?.innerHTML ?? '';
    if (bodyHtmlInputRef.current) bodyHtmlInputRef.current.value = html;
    if (bodyTextInputRef.current) bodyTextInputRef.current.value = htmlToText(html);
  };

  const runCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncFromEditor();
  };

  const applyTextColor = (color: string) => {
    editorRef.current?.focus();
    document.execCommand('foreColor', false, color);
    syncFromEditor();
  };

  const addLink = () => {
    const url = window.prompt('Paste link URL');
    if (!url?.trim()) return;
    const safeUrl = normalizeUrl(url);
    runCommand('createLink', safeUrl);
    decorateLinks(safeUrl);
  };

  const addVideoBlock = () => {
    const url = window.prompt('Paste video URL');
    if (!url?.trim()) return;
    const safeUrl = normalizeUrl(url);
    editorRef.current?.focus();
    const selection = window.getSelection();
    const hasSelectedText =
      selection &&
      selection.rangeCount > 0 &&
      editorRef.current?.contains(selection.anchorNode) &&
      selection.toString().trim().length > 0;
    if (hasSelectedText) {
      document.execCommand('createLink', false, safeUrl);
      decorateLinks(safeUrl);
    } else {
      document.execCommand(
        'insertHTML',
        false,
        `<p><a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color: inherit;"><strong>Watch video</strong></a></p>`
      );
    }
    syncFromEditor();
  };

  const decorateLinks = (href: string) => {
    editorRef.current
      ?.querySelectorAll<HTMLAnchorElement>('a')
      .forEach((anchor) => {
        if (anchor.href === href || anchor.getAttribute('href') === href) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.style.color = 'inherit';
        }
      });
  };

  return (
    <form method="post" action="/api/admin/email-templates" className="portal-form-grid" onSubmit={syncFromEditor}>
      <label>
        From Name
        <input name="fromName" defaultValue={initialFromName} placeholder="Pitching Coach U" />
      </label>
      <label>
        From Email
        <input
          name="fromEmail"
          type="email"
          defaultValue={initialFromEmail}
          placeholder="Uses DEMO_REQUEST_CONFIRMATION_FROM_EMAIL if blank"
        />
      </label>
      <label className="portal-form-span-2">
        Subject
        <input name="subject" defaultValue={initialSubject} required />
      </label>
      <div className="portal-form-span-2" style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')}>
            Bold
          </button>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')}>
            Italic
          </button>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')}>
            Underline
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
            Color
            <input
              type="color"
              defaultValue="#ffffff"
              onMouseDown={(event) => event.preventDefault()}
              onChange={(event) => applyTextColor(event.target.value)}
              aria-label="Text color"
              style={{ width: 42, height: 38, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: 2, background: 'transparent' }}
            />
          </label>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={addLink}>
            Link
          </button>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={addVideoBlock}>
            Video Link
          </button>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('insertUnorderedList')}>
            Bullets
          </button>
          <button type="button" className="btn btn-ghost" style={toolbarButtonStyle} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('removeFormat')}>
            Clear Format
          </button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          spellCheck
          suppressContentEditableWarning
          onBlur={syncFromEditor}
          dangerouslySetInnerHTML={{ __html: initialEditorHtml }}
          style={{
            minHeight: 320,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 10,
            padding: '0.85rem',
            background: 'rgba(255,255,255,0.04)',
            color: 'inherit',
            lineHeight: 1.5,
            outline: 'none',
          }}
        />
        <input ref={bodyHtmlInputRef} type="hidden" name="bodyHtml" defaultValue={initialEditorHtml} />
        <input ref={bodyTextInputRef} type="hidden" name="bodyText" defaultValue={initialBodyText || htmlToText(initialEditorHtml)} />
      </div>
      <button type="submit" className="btn btn-primary">
        Save Email Template
      </button>
    </form>
  );
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
