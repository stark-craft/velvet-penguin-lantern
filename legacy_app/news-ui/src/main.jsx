import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/geist/wght.css";
import ErrorBoundary from "./shared/components/ErrorBoundary.jsx";
import { GuidePetProvider, useGuidePet } from "./shared/guide/GuidePetContext.jsx";
import { LanguageProvider } from "./news-scrapper/translation/LanguageProvider.jsx";

const GuidePet = lazy(() => Promise.all([
  import("./shared/guide/GuidePet.jsx"),
  import("./shared/guide/guide-pet.css"),
]).then(([module]) => module));

function OptionalGuide() {
  const { enabled } = useGuidePet();
  if (!enabled) return null;
  return <Suspense fallback={null}><GuidePet /></Suspense>;
}

async function launch() {
  // Keep one visual shell across NewsScrapper, Research and Venture Lens.
  await import("./index.css");
  await import("./news-scrapper/archive-search.css");
  await import("./news-scrapper/theme-toggle.css");
  await import("./news-scrapper/ui-polish.css");
  await import("./venture-lens/venture-lens.css");
  const App = (await import("./news-scrapper/App.jsx")).default;
  document.title = "Sense.AI Intelligence";

  const application = (
    <LanguageProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GuidePetProvider>
          <App />
          <OptionalGuide />
        </GuidePetProvider>
      </BrowserRouter>
    </LanguageProvider>
  );

  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary>
        {application}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

launch();
