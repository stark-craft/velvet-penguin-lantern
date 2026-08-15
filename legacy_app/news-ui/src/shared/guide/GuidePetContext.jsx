import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const GUIDE_ENABLED_KEY = "sense-guide-pet-enabled-v1";

const GuidePetContext = createContext(null);

function readGuideEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GUIDE_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function GuidePetProvider({ children }) {
  const [enabled, setEnabledState] = useState(readGuideEnabled);
  const [requestId, setRequestId] = useState(0);

  const setEnabled = useCallback((nextValue) => {
    const next = Boolean(nextValue);
    setEnabledState(next);
    try {
      window.localStorage.setItem(GUIDE_ENABLED_KEY, String(next));
    } catch {
      // Storage can be blocked by browser policy. The in-memory preference
      // still applies for the current visit.
    }
    if (next) setRequestId((current) => current + 1);
  }, []);

  const requestGuide = useCallback(() => {
    setEnabledState(true);
    try {
      window.localStorage.setItem(GUIDE_ENABLED_KEY, "true");
    } catch {
      // Keep the current-session behavior when storage is unavailable.
    }
    setRequestId((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({ enabled, setEnabled, requestGuide, requestId }),
    [enabled, requestGuide, requestId, setEnabled],
  );

  return <GuidePetContext.Provider value={value}>{children}</GuidePetContext.Provider>;
}

export function useGuidePet() {
  const context = useContext(GuidePetContext);
  if (!context) {
    throw new Error("useGuidePet must be used inside GuidePetProvider");
  }
  return context;
}
