import React from 'react';

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.2 15.4A8.4 8.4 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
    </svg>
  );
}

export default function ThemeToggle({ theme, onToggle }) {
  const isLight = theme === 'light';
  const nextTheme = isLight ? 'dark' : 'light';
  const label = `Switch to ${nextTheme} theme`;

  return (
    <button
      aria-label={label}
      aria-pressed={isLight}
      className="theme-toggle"
      onClick={onToggle}
      title={label}
      type="button"
    >
      <span className="theme-toggle-icon">
        {isLight ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="theme-toggle-copy">
        <span className="theme-toggle-name">{isLight ? 'Dark' : 'Light'}</span>
        <span className="theme-toggle-hint">theme</span>
      </span>
    </button>
  );
}
