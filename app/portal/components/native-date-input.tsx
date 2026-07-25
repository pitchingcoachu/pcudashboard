'use client';

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

type NativeDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  disabled?: boolean;
};

type DateInputElement = HTMLInputElement & {
  showPicker?: () => void;
};

export default function NativeDateInput({ value, onChange, className, style, ariaLabel, disabled }: NativeDateInputProps) {
  const inputRef = useRef<DateInputElement | null>(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input || disabled) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // Some browsers only allow showPicker from specific user gestures.
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLInputElement>) {
    // Mobile browsers already open their native date UI from the normal touch
    // event. Preventing that event and calling showPicker() ourselves can cause
    // the native sheet to open and immediately dismiss on iOS/Android.
    if (event.pointerType !== 'mouse') return;
    const input = inputRef.current;
    if (!input?.showPicker || disabled) return;
    event.preventDefault();
    openPicker();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const input = inputRef.current;
    if (!input?.showPicker || disabled) return;
    event.preventDefault();
    openPicker();
  }

  return (
    <input
      ref={inputRef}
      type="date"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      style={style}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
