import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

export default function ThemeToggle({ theme, onToggle, language = "en" }) {
  const isLight = theme === "light";
  const nextTheme = isLight ? "dark" : "light";
  const [sweep, setSweep] = useState(null);
  const timeoutRef = useRef(null);
  const isKorean = language === "ko";
  const actionLabel = isKorean
    ? `${nextTheme === "light" ? "라이트" : "다크"} 테마로 전환`
    : `Switch to ${nextTheme} theme`;
  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleToggle = () => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!reducedMotion) {
      setSweep({ target: nextTheme, id: Date.now() });
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setSweep(null), 1260);
    }
    onToggle?.();
  };

  return (
    <>
      <button
        aria-label={actionLabel}
        aria-pressed={isLight}
        className={`theme-toggle premium-theme-toggle is-${theme}`}
        data-no-translate
        onClick={handleToggle}
        title={actionLabel}
        type="button"
      >
        <span className="premium-theme-track" aria-hidden="true">
          <span className="premium-theme-glyph premium-theme-sun"><SunIcon /></span>
          <span className="premium-theme-glyph premium-theme-moon"><MoonIcon /></span>
          <span className="premium-theme-thumb" />
        </span>
      </button>
      {sweep && typeof document !== "undefined"
        ? createPortal(
            <span
              aria-hidden="true"
              className={`premium-theme-sweep to-${sweep.target}`}
              key={`${sweep.target}-${sweep.id}`}
            />,
            document.body,
          )
        : null}
    </>
  );
}
