'use client';

import { useEffect, useMemo, useState } from 'react';
import { splitMessageLinks, type MessageLinkPreview } from '../../../lib/message-links';
import styles from './message-body.module.css';

export function MessageBody({ text }: { text: string }) {
  const parts = useMemo(() => splitMessageLinks(text), [text]);
  const url = parts.find((part) => part.url)?.url;
  return <>
    <p className="portal-messages-bubble-text">
      {parts.map((part, index) => part.url ? (
        <a key={index} className={styles.link} href={part.url} target="_blank" rel="noopener noreferrer" onPointerDown={(event) => event.stopPropagation()}>{part.text}</a>
      ) : part.text)}
    </p>
    {url ? <LinkPreview key={url} url={url} /> : null}
  </>;
}

function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<MessageLinkPreview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/messaging/link-preview?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (!controller.signal.aborted) setPreview(data?.preview ?? null); })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);
  return (
    <a className={styles.preview} href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(event) => event.stopPropagation()}>
      {preview?.imagePath && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.image} src={preview.imagePath} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      ) : null}
      <span className={styles.details}>
        <span className={styles.site}>{preview?.siteName ?? new URL(url).hostname}</span>
        <span className={styles.title}>{preview?.title ?? new URL(url).hostname}</span>
        {preview?.description ? <span className={styles.description}>{preview.description}</span> : null}
        <span className={styles.open}>Open link ↗</span>
      </span>
    </a>
  );
}
