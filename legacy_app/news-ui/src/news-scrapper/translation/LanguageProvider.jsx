import React, { createContext, useContext, useMemo, useState } from "react";
import {
  readStoredLanguage,
  usePageTranslation,
} from "./usePageTranslation.js";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(readStoredLanguage);
  const translationState = usePageTranslation(language);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => {
        setLanguage((current) => (current === "ko" ? "en" : "ko"));
      },
      translationState,
    }),
    [language, translationState],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider.");
  }
  return context;
}
