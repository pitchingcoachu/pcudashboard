'use client';

import { useEffect, useRef } from 'react';

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
};

export function MessagesContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="portal-messages-context-menu" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`portal-messages-context-menu-item${item.danger ? ' is-danger' : ''}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
