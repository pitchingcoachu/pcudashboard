'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type PageLink = { title: string; href: string };

type ChatResponse = {
  answer?: string;
  confidence?: 'low' | 'medium' | 'high' | string;
  evidence?: string[];
  error?: string;
  page_link?: PageLink | null;
};

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; pageLink?: PageLink | null };

type DashboardChatProps = {
  isPro?: boolean;
  currentSuite?: string;
};

const STARTER_QUESTIONS = [
  'What is Joe Schmoe BB% after 0-1?',
  'What is Joe Schmoe best PV/100 pitch and usage vs lefties and righties?',
  'Show John Doe xWOBA over the last 2 weeks.',
  'Where can I see player notes?',
];

const HIDDEN_STORAGE_KEY = 'pcu-chat-hidden:v1';

function toApiMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((message) => ({ role: message.role, content: message.text }));
}

export default function DashboardChat({ isPro = false, currentSuite }: DashboardChatProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hidden, setHidden] = useState(false);
  const [hiddenStateReady, setHiddenStateReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const accent = isPro ? 'rgba(109, 153, 220, 0.9)' : 'rgba(var(--portal-accent-rgb, 200, 16, 46), 0.75)';
  const panelBackground = isPro
    ? 'linear-gradient(165deg, rgba(5, 16, 34, 0.97), rgba(10, 24, 52, 0.95))'
    : 'linear-gradient(165deg, rgba(6, 6, 7, 0.97), rgba(14, 6, 9, 0.96))';

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_STORAGE_KEY) === '1');
    } catch {
      // Ignore storage access errors (e.g. private browsing).
    } finally {
      setHiddenStateReady(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages, loading]);

  const hideWidget = () => {
    setOpen(false);
    setHidden(true);
    try {
      window.localStorage.setItem(HIDDEN_STORAGE_KEY, '1');
    } catch {
      // Ignore storage access errors.
    }
  };

  const showWidget = () => {
    setHidden(false);
    try {
      window.localStorage.removeItem(HIDDEN_STORAGE_KEY);
    } catch {
      // Ignore storage access errors.
    }
  };

  const canSubmit = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const sendQuestion = async (questionRaw?: string) => {
    const question = (questionRaw ?? input).trim();
    if (!question || loading) return;
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(nextMessages),
          pageContext: { suite: currentSuite ?? pathname },
        }),
      });
      const payload = (await response.json()) as ChatResponse;
      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        text: payload.answer || payload.error || 'No response returned.',
        pageLink: payload.page_link ?? null,
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          text: error instanceof Error ? error.message : 'Chat request failed.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
  };

  if (!hiddenStateReady) {
    // Avoid a flash of the full button before the persisted hidden-state loads.
    return null;
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={showWidget}
        aria-label="Show Coaching Assistant"
        title="Show Coaching Assistant"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 60,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: `1px solid ${accent}`,
          background: 'rgba(2, 6, 23, 0.55)',
          opacity: 0.55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16, fill: '#f8fafc' }}>
          <path d="M4.5 5.5A3.5 3.5 0 0 1 8 2h8a3.5 3.5 0 0 1 3.5 3.5v6A3.5 3.5 0 0 1 16 15h-3.2l-4.1 4.1A1 1 0 0 1 7 18.4V15A3.5 3.5 0 0 1 4.5 11.5v-6Z" />
        </svg>
      </button>
    );
  }

  return (
    <>
      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60 }}>
        <button
          type="button"
          className="btn btn-primary dashboard-chat-toggle"
          onClick={() => setOpen((current) => !current)}
          style={{
            borderColor: accent,
            minWidth: 96,
          }}
        >
          {open ? 'Close Coaching Assistant' : 'Coaching Assistant'}
        </button>
        {!open ? (
          <button
            type="button"
            onClick={hideWidget}
            aria-label="Hide Coaching Assistant button"
            title="Hide Coaching Assistant"
            style={{
              position: 'absolute',
              top: -8,
              right: -8,
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: `1px solid ${accent}`,
              background: 'rgba(2, 6, 23, 0.9)',
              color: '#f8fafc',
              fontSize: 12,
              lineHeight: '18px',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <aside
          className="dashboard-chat-panel"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 66,
            width: 'min(560px, calc(100vw - 24px))',
            maxHeight: 'min(70vh, 720px)',
            zIndex: 59,
            border: `1px solid ${accent}`,
            borderRadius: 12,
            background: panelBackground,
            boxShadow: '0 14px 40px rgba(0, 0, 0, 0.45)',
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 700 }}>Coaching Assistant</span>
            {messages.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={clearConversation}
                style={{ fontSize: 12, padding: '4px 8px' }}
              >
                Clear conversation
              </button>
            ) : null}
          </div>
          <div style={{ overflowY: 'auto', padding: 12, display: 'grid', gap: 10 }}>
            {messages.length === 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: 'rgba(241, 245, 249, 0.92)' }}>Ask about stats, or ask where to find something in the app.</div>
                {STARTER_QUESTIONS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => sendQuestion(starter)}
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    border: `1px solid ${message.role === 'user' ? 'rgba(148,163,184,0.35)' : accent}`,
                    borderRadius: 10,
                    padding: '8px 10px',
                    background: message.role === 'user' ? 'rgba(15, 23, 42, 0.58)' : 'rgba(2, 6, 23, 0.68)',
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{message.role === 'user' ? 'You' : 'AI'}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
                  {message.role === 'assistant' && message.pageLink ? (
                    <Link
                      href={message.pageLink.href}
                      className="btn btn-ghost"
                      style={{ justifySelf: 'flex-start', fontSize: 13 }}
                    >
                      Go to {message.pageLink.title} →
                    </Link>
                  ) : null}
                </div>
              ))
            )}
            {loading ? <div style={{ fontSize: 13, opacity: 0.8 }}>Analyzing question...</div> : null}
            <div ref={messagesEndRef} />
          </div>
          <div style={{ padding: 10, borderTop: `1px solid ${accent}`, display: 'grid', gap: 8 }}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask a question about player/team data, or how to find something..."
              rows={3}
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 66,
                borderRadius: 10,
                border: `1px solid ${accent}`,
                background: 'rgba(2, 6, 23, 0.8)',
                color: '#f8fafc',
                padding: 10,
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void sendQuestion();
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void sendQuestion()} disabled={!canSubmit}>
              {loading ? 'Working...' : 'Ask'}
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
