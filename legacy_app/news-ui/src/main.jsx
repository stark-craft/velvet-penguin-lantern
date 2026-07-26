import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ErrorBoundary from "./shared/components/ErrorBoundary.jsx";

async function launch() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const ventureLens = path === "/venturelens" || path.startsWith("/venturelens/");

  let App;
  if (ventureLens) {
    await import("./venture-lens/venture-lens.css");
    App = (await import("./venture-lens/VentureLensApp.jsx")).default;
    document.title = "Venture Lens | Sense.AI";
  } else {
    await Promise.all([
      import("./index.css"),
      import("./news-scrapper/archive-search.css"),
      import("./news-scrapper/theme-toggle.css"),
    ]);
    App = (await import("./news-scrapper/App.jsx")).default;
    document.title = "NewsScrapper Intelligence | Sense.AI";
  }

  const application = (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
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
