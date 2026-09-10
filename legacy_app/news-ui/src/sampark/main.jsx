import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist/wght.css';
import { LanguageProvider } from '../news-scrapper/translation/LanguageProvider.jsx';
import SamparkApp from './SamparkApp.jsx';

document.documentElement.dataset.theme = 'light';
document.documentElement.style.colorScheme = 'light';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <BrowserRouter basename="/sampark" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SamparkApp />
      </BrowserRouter>
    </LanguageProvider>
  </React.StrictMode>,
);
