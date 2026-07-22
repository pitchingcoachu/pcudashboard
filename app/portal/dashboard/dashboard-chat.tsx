'use client';

import { useMemo, useState } from 'react';

type ChatResponse = {
  answer?: string;
  confidence?: 'low' | 'medium' | 'high' | string;
  evidence?: string[];
  error?: string;
};

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; confidence?: string; evidence?: string[] };

type DashboardChatProps = {
  isPro: boolean;
};

const STARTER_QUESTIONS = [
  'What is Joe Schmoe BB% after 0-1?',
  'What is Joe Schmoe best PV/100 pitch and usage vs lefties and righties?',
  'Show John Doe xWOBA over the last 2 weeks.',
];

function splitSourceTag(text: string): { body: string; source: string | null } {
  const raw = String(text ?? '');
  const match = raw.match(/\s*\[Source:\s*([^\]]+)\]\s*$/i);
  if (!match) return { body: raw, source: null };
  const body = raw.slice(0, match.index).trimEnd();
  const source = String(match[1] ?? '').trim();
  return { body, source: source || null };
}

export default function DashboardChat({ isPro }: DashboardChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const accent = isPro ? 'rgba(109, 153, 220, 0.9)' : 'rgba(var(--portal-accent-rgb, 200, 16, 46), 0.75)';
  const panelBackground = isPro
    ? 'linear-gradient(165deg, rgba(5, 16, 34, 0.97), rgba(10, 24, 52, 0.95))'
    : 'linear-gradient(165deg, rgba(6, 6, 7, 0.97), rgba(14, 6, 9, 0.96))';

  const canSubmit = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const sendQuestion = async (questionRaw?: string) => {
    const question = (questionRaw ?? input).trim();
    if (!question || loading) return;
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as ChatResponse;
      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        text: payload.answer || payload.error || 'No response returned.',
        confidence: payload.confidence,
        evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          text: error instanceof Error ? error.message : 'Chat request failed.',
          confidence: 'low',
          evidence: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-primary dashboard-chat-toggle"
        onClick={() => setOpen((current) => !current)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 60,
          borderColor: accent,
          minWidth: 96,
        }}
      >
        {open ? 'Close Coaching Assistant' : 'Coaching Assistant'}
      </button>
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
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${accent}`, fontWeight: 700 }}>
            Coaching Assistant (V1)
          </div>
          <div style={{ overflowY: 'auto', padding: 12, display: 'grid', gap: 10 }}>
            {messages.length === 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: 'rgba(241, 245, 249, 0.92)' }}>Ask using table metrics (BB%, K%, PV/100, xWOBA, Barrel%, GoZoneSw%).</div>
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
                (() => {
                  const sourceSplit = message.role === 'assistant' ? splitSourceTag(message.text) : { body: message.text, source: null };
                  const evidenceBase = message.role === 'assistant' && Array.isArray(message.evidence) ? message.evidence : [];
                  const evidence = sourceSplit.source
                    ? (evidenceBase.some((item) => item.toLowerCase().includes(sourceSplit.source!.toLowerCase()) || item.toLowerCase().includes('source:'))
                        ? evidenceBase
                        : [...evidenceBase, `Source: ${sourceSplit.source}`])
                    : evidenceBase;
                  return (
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
                      <div style={{ whiteSpace: 'pre-wrap' }}>{sourceSplit.body}</div>
                      {message.role === 'assistant' && message.confidence ? (
                        <div style={{ fontSize: 12, opacity: 0.8 }}>Confidence: {message.confidence}</div>
                      ) : null}
                      {message.role === 'assistant' && evidence.length > 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                          {evidence.join(' | ')}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ))
            )}
            {loading ? <div style={{ fontSize: 13, opacity: 0.8 }}>Analyzing question...</div> : null}
          </div>
          <div style={{ padding: 10, borderTop: `1px solid ${accent}`, display: 'grid', gap: 8 }}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask a question about player/team data..."
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
