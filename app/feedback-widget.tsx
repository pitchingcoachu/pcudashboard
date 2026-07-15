'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type FeedbackStatus = 'idle' | 'sending' | 'sent' | 'error';

const MAX_FEEDBACK_LENGTH = 4000;

function usePagePath() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  }, [pathname, searchParams]);
}

function PagePathReader({ onPath }: { onPath: (p: string) => void }) {
  const path = usePagePath();
  useEffect(() => { onPath(path); }, [path, onPath]);
  return null;
}

export default function FeedbackWidget({
  forceVisible = false,
}: {
  forceVisible?: boolean;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<FeedbackStatus>('idle');
  const [error, setError] = useState('');
  const [pagePath, setPagePath] = useState('');

  const showFeedback = forceVisible || pathname.startsWith('/portal') || pathname.startsWith('/profiles');
  if (!showFeedback) return null;

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setStatus('error');
      setError('Type a note before submitting.');
      return;
    }

    setStatus('sending');
    setError('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          pagePath,
          pageTitle: document.title,
          browserUrl: window.location.href,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Feedback could not be sent.');
      }
      setMessage('');
      setStatus('sent');
      window.setTimeout(() => {
        setIsOpen(false);
        setStatus('idle');
      }, 1200);
    } catch (submitError) {
      setStatus('error');
      setError(submitError instanceof Error ? submitError.message : 'Feedback could not be sent.');
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        <PagePathReader onPath={setPagePath} />
      </Suspense>
      <button
        type="button"
        className="global-feedback-button"
        aria-label="Send page feedback"
        title="Send page feedback"
        onClick={() => {
          setIsOpen(true);
          setStatus('idle');
          setError('');
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 5.5A3.5 3.5 0 0 1 8 2h8a3.5 3.5 0 0 1 3.5 3.5v6A3.5 3.5 0 0 1 16 15h-3.2l-4.1 4.1A1 1 0 0 1 7 18.4V15A3.5 3.5 0 0 1 4.5 11.5v-6Zm3.5-1A1.5 1.5 0 0 0 6.5 6v5.5A1.5 1.5 0 0 0 8 13h1a1 1 0 0 1 1 1v2l1.7-1.7A1 1 0 0 1 12.4 14H16a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 16 4.5H8Z" />
          <path d="M8.7 7.5h6.6a1 1 0 1 1 0 2H8.7a1 1 0 0 1 0-2Zm0 3.3h4.4a1 1 0 0 1 0 2H8.7a1 1 0 0 1 0-2Z" />
        </svg>
      </button>

      {isOpen ? (
        <div className="global-feedback-overlay" role="presentation">
          <div className="global-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="global-feedback-title">
            <div className="global-feedback-header">
              <h2 id="global-feedback-title">Send feedback</h2>
              <button
                type="button"
                className="global-feedback-close"
                aria-label="Close feedback"
                onClick={() => {
                  setIsOpen(false);
                  setStatus('idle');
                  setError('');
                }}
              >
                x
              </button>
            </div>
            <form className="global-feedback-form" onSubmit={submitFeedback}>
              <label>
                <span>Note</span>
                <textarea
                  value={message}
                  maxLength={MAX_FEEDBACK_LENGTH}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (status === 'error') {
                      setStatus('idle');
                      setError('');
                    }
                  }}
                  placeholder="Type what is broken, confusing, or what you want changed on this page..."
                  autoFocus
                />
              </label>
              <div className="global-feedback-footer">
                <span>{message.length}/{MAX_FEEDBACK_LENGTH}</span>
                <button type="submit" className="global-feedback-submit" disabled={status === 'sending'}>
                  {status === 'sending' ? 'Sending...' : 'Submit'}
                </button>
              </div>
              {status === 'sent' ? <p className="global-feedback-success">Sent.</p> : null}
              {status === 'error' && error ? <p className="global-feedback-error">{error}</p> : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
