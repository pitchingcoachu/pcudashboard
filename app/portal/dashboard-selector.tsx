'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type AppOption = {
  id: string;
  name: string;
};

type DashboardSelectorProps = {
  apps: AppOption[];
  selectedAppId?: string;
};

export default function DashboardSelector({ apps, selectedAppId }: DashboardSelectorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current) return;
      const target = event.target as Node;
      if (!wrapperRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const selected = apps.find((app) => app.id === selectedAppId);
  const label = selected?.name ?? 'Select Dashboard';

  const handleSelect = (appId: string) => {
    setIsOpen(false);
    router.push(`/portal?app=${encodeURIComponent(appId)}`);
  };

  return (
    <div className="portal-app-dropdown" ref={wrapperRef}>
      <button
        type="button"
        className="portal-app-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="portal-app-current">{label}</span>
      </button>
      {isOpen && (
        <div className="portal-app-menu" role="menu" aria-label="App Selection">
          {apps.map((app) => {
            const isActive = app.id === selectedAppId;
            return (
              <button
                key={app.id}
                type="button"
                className={`portal-app-option${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(app.id)}
              >
                {app.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
