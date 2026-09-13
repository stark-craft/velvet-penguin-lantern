import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist/wght.css';
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
