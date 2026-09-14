import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist/wght.css';
// ArticleModal is the original TechScout briefing dossier. Sampark renders the
// same component, so load its original layout/theme layers before Sampark's
// page-specific overrides instead of maintaining a second modal design.
import '../index.css';
import '../news-scrapper/theme-toggle.css';
import '../news-scrapper/ui-polish.css';
import { LanguageProvider } from '../news-scrapper/translation/LanguageProvider.jsx';
import { SamparkAuthProvider } from './auth/SamparkAuthContext.jsx';
import { applySamparkTheme, readSamparkTheme } from './theme.js';
import SamparkApp from './SamparkApp.jsx';

applySamparkTheme(readSamparkTheme());
try {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applySamparkTheme(readSamparkTheme()));
} catch {}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <SamparkAuthProvider>
        <BrowserRouter basename="/sampark" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SamparkApp />
        </BrowserRouter>
      </SamparkAuthProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
