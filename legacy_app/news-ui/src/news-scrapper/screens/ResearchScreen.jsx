import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { getVentureOverview } from "../../venture-lens/api.js";
import "../styles/sense-expansion.css";

const categories = [
  { icon: "note", title: "Research Papers", text: "Track the ideas moving from publication toward implementation.", to: "/venturelens/research", accent: "cyan" },
  { icon: "terminal", title: "Open Source Repositories", text: "See where developer adoption and technical momentum are building.", to: "/venturelens/repositories", accent: "blue" },
  { icon: "trend", title: "Companies & Startups", text: "Place emerging capabilities in a practical market context.", to: "/venturelens/radar", accent: "violet" },
  { icon: "radar", title: "Emerging Technologies", text: "Connect research evidence, implementation signals and opportunity.", to: "/venturelens/radar", accent: "mint" },
];

function previewRows(payload) {
  const repos = (payload?.github?.items || []).slice(0, 2).map((item) => ({
    id: `repo-${item.id}`,
    type: "Repository",
    title: item.full_name || item.name,
    detail: item.description || "Implementation signal",
    to: "/venturelens/repositories",
  }));
  const papers = (payload?.research?.items || []).slice(0, 2).map((item) => ({
    id: `paper-${item.id}`,
    type: "Research",
    title: item.title,
    detail: item.summary || "Research signal",
    to: "/venturelens/research",
  }));
  return [...repos, ...papers];
}

export default function ResearchScreen() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getVentureOverview()
      .then((result) => { if (!cancelled) setPayload(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  const previews = previewRows(payload);

  return (
    <div className="sense-expansion-page research-landing">
      <section className="sense-intro-hero">
        <div className="sense-hero-rings" aria-hidden="true"><i /><i /><i /></div>
        <div>
          <span className="sense-kicker">Research intelligence</span>
          <h1>Research &amp; Technology Intelligence</h1>
          <p>Explore the evidence behind emerging technologies—connecting fresh research, open-source adoption and decision-ready context in one focused workspace.</p>
          <button className="sense-primary-action" onClick={() => navigate("/venturelens")} type="button">
            Open Venture Lens <Icon name="chevR" size={16} />
          </button>
        </div>
        <aside>
          <span>Decision lens</span>
          <strong>Evidence before excitement.</strong>
          <p>Use live public signals to understand what is accelerating, what is credible and what deserves a closer look.</p>
        </aside>
      </section>

      <section className="sense-category-section" aria-labelledby="research-paths-heading">
        <header><span>Four ways in</span><h2 id="research-paths-heading">Choose the question you want to answer.</h2></header>
        <div className="sense-category-grid">
          {categories.map((item) => (
            <button className={`sense-category-card is-${item.accent}`} key={item.title} onClick={() => navigate(item.to)} type="button">
              <span className="sense-category-icon"><Icon name={item.icon} size={21} /></span>
              <strong>{item.title}</strong><p>{item.text}</p><span className="sense-card-link">Explore workspace <Icon name="chevR" size={14} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="sense-preview-section" aria-labelledby="research-preview-heading">
        <header><div><span>Live preview</span><h2 id="research-preview-heading">A first look through the lens.</h2></div><button onClick={() => navigate("/venturelens")} type="button">View full workspace</button></header>
        {previews.length ? (
          <div className="sense-preview-list">{previews.map((item) => <button key={item.id} onClick={() => navigate(item.to)} type="button"><span>{item.type}</span><strong>{item.title}</strong><p>{item.detail}</p><Icon name="external" size={15} /></button>)}</div>
        ) : (
          <div className="sense-preview-empty" role={failed ? "status" : undefined}>
            <Icon name={failed ? "warning" : "refresh"} size={20} />
            <div><strong>{failed ? "Live preview is temporarily unavailable." : "Preparing the latest signals…"}</strong><p>The full research workspace remains available, and no NewsScrapper workflow is affected.</p></div>
            <button onClick={() => navigate("/venturelens")} type="button">Open Venture Lens</button>
          </div>
        )}
      </section>
    </div>
  );
}
