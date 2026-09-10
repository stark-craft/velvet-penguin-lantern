import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist/wght.css';
import ErrorBoundary from '../shared/components/ErrorBoundary.jsx';
import { GuidePetProvider, useGuidePet } from '../shared/guide/GuidePetContext.jsx';
import { LanguageProvider } from '../news-scrapper/translation/LanguageProvider.jsx';

const GuidePet = lazy(() => Promise.all([
  import('../shared/guide/GuidePet.jsx'),
  import('../shared/guide/guide-pet.css'),
]).then(([module]) => module));

function OptionalGuide() {
  const { enabled } = useGuidePet();
  return enabled ? <Suspense fallback={null}><GuidePet /></Suspense> : null;
}

async function launch() {
  // The original entry never imports Sampark styles. Shared dossier primitives
  // remain available here without changing the original user's theme preference.
  await import('../index.css');
  await import('../news-scrapper/ui-polish.css');
  const { default: SamparkApp } = await import('./SamparkApp.jsx');
  await import('./sampark.css');
  document.documentElement.dataset.theme = 'light';
  document.documentElement.style.colorScheme = 'light';
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><ErrorBoundary><LanguageProvider>
      <BrowserRouter basename="/sampark" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GuidePetProvider><SamparkApp /><OptionalGuide /></GuidePetProvider>
      </BrowserRouter>
    </LanguageProvider></ErrorBoundary></React.StrictMode>,
  );
}

launch().catch((error) => {
  console.error('[TechScout] Sampark bootstrap failed', error);
  const root = document.getElementById('root');
  root.replaceChildren(document.createTextNode('TechScout could not start. Please reload the page.'));
});
