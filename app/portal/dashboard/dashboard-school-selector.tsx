'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveSchoolBrand } from '../../../lib/school-brand';

type Props = {
  options: string[];
  initialValue: string;
  logoOnly?: boolean;
};

function formatSchoolCodeLabel(schoolCode: string): string {
  const code = String(schoolCode ?? '').trim().toUpperCase();
  if (code === 'PRO') return 'MLB';
  if (code === 'LEAGUE') return 'NCAA';
  return code;
}

export default function DashboardSchoolSelector({ options, initialValue, logoOnly = false }: Props) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    return options
      .map((schoolCode) => String(schoolCode ?? '').trim().toUpperCase())
      .filter((schoolCode) => {
        if (!schoolCode || seen.has(schoolCode)) return false;
        seen.add(schoolCode);
        return true;
      });
  }, [options]);

  const activeBrand = resolveSchoolBrand(value);

  async function onChange(next: string) {
    setValue(next);
    setSaving(true);
    setOpen(false);
    try {
      const response = await fetch('/api/auth/dashboard-school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolCode: next }),
      });
      if (!response.ok) {
        throw new Error('Failed to switch school.');
      }
      window.location.assign(`/portal/dashboard?school_switch=${Date.now()}`);
    } catch {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  return (
    <div className="portal-school-switcher" aria-label="School selector" ref={containerRef}>
      <button
        type="button"
        className={`portal-school-switcher-trigger${logoOnly ? ' portal-school-switcher-trigger--logo-only' : ''}`}
        onClick={() => setOpen((current) => !current)}
        disabled={saving}
        aria-expanded={open}
        aria-haspopup="menu"
        title={saving ? 'Switching school...' : `School: ${formatSchoolCodeLabel(value)}`}
      >
        <img
          src={activeBrand.logoSrc ?? '/pearl-clam-transparent.png'}
          alt={activeBrand.logoSrc ? activeBrand.logoAlt : 'Pearl Player Development'}
          className={`portal-school-switcher-trigger-logo portal-school-switcher-trigger-logo--${activeBrand.schoolCode}`}
        />
        {!logoOnly ? <span className="portal-school-switcher-trigger-label">{formatSchoolCodeLabel(value)}</span> : null}
        {!logoOnly ? (
          <span className="portal-school-switcher-caret" aria-hidden="true">
            ▾
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="portal-school-switcher-menu" role="menu">
          {normalizedOptions.map((schoolCode) => {
            const brand = resolveSchoolBrand(schoolCode);
            const selected = schoolCode === value;
            return (
              <button
                key={schoolCode}
                type="button"
                className={`portal-school-switcher-option${selected ? ' active' : ''}`}
                onClick={() => void onChange(schoolCode)}
                disabled={saving}
                role="menuitem"
                aria-current={selected ? 'true' : undefined}
              >
                <img
                  src={brand.logoSrc ?? '/pearl-clam-transparent.png'}
                  alt={brand.logoSrc ? brand.logoAlt : 'Pearl Player Development'}
                  className={`portal-school-switcher-option-logo portal-school-switcher-option-logo--${brand.schoolCode}`}
                />
                <span>{formatSchoolCodeLabel(schoolCode)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
