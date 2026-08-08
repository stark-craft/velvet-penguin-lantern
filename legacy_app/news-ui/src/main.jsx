import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ErrorBoundary from "./shared/components/ErrorBoundary.jsx";
import { LanguageProvider } from "./news-scrapper/translation/LanguageProvider.jsx";

async function launch() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const ventureLens = path === "/venturelens" || path.startsWith("/venturelens/");

  let App;
  if (ventureLens) {
    await import("./venture-lens/venture-lens.css");
    App = (await import("./venture-lens/VentureLensApp.jsx")).default;
    document.title = "Venture Lens | Sense.AI";
  } else {
    // CSS order is part of the visual contract. Loading these files in parallel
    // made the final cascade depend on network/cache timing, which could produce
    // a different theme on Windows, macOS, development and production builds.
    await import("./index.css");
    await import("./news-scrapper/archive-search.css");
    await import("./news-scrapper/theme-toggle.css");
    await import("./news-scrapper/ui-polish.css");
    App = (await import("./news-scrapper/App.jsx")).default;
    document.title = "NewsScrapper Intelligence | Sense.AI";
  }

  const application = (
    <LanguageProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
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
