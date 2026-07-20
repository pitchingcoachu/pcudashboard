'use client';

import { useRef, type CSSProperties } from 'react';

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

  return (
    <span className="portal-native-date-input">
      <input
        ref={inputRef}
        type="date"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
        style={style}
        onClick={openPicker}
        onFocus={openPicker}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="portal-native-date-button"
        aria-label={ariaLabel ? `Open ${ariaLabel} calendar` : 'Open calendar'}
        disabled={disabled}
        onPointerDown={(event) => {
          event.preventDefault();
          openPicker();
        }}
        onClick={(event) => {
          event.preventDefault();
          openPicker();
        }}
      >
        <span aria-hidden="true">▦</span>
      </button>
    </span>
  );
}
