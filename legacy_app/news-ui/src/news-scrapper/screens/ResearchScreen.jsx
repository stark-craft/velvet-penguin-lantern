import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { getVentureDiscovery } from '../../venture-lens/api.js';
import '../styles/research-observatory.css';

const LANE_DEFINITIONS = [
  { id: 'papers', label: 'Papers', icon: 'note', route: '/venturelens/research', provider: 'arxiv', detail: 'Peer-reviewed and preprint evidence' },
  { id: 'repositories', label: 'Repositories', icon: 'terminal', route: '/venturelens/repositories', provider: 'github', detail: 'Open-source adoption and velocity' },
  { id: 'models', label: 'Models', icon: 'sparkle', route: '/venturelens/models', provider: 'huggingface', detail: 'Released model systems and tooling' },
  { id: 'datasets', label: 'Datasets', icon: 'layers', route: '/venturelens/datasets', provider: 'huggingface', detail: 'Training and evaluation foundations' },
  { id: 'patents', label: 'Patents', icon: 'file', route: '/venturelens/patents', provider: 'epo', detail: 'Protected invention signals' },
  { id: 'technology', label: 'Technology Radar', icon: 'radar', route: '/venturelens/radar', detail: 'Cross-source decision context' },
];

const TYPE_LABELS = { repository: 'Repository', paper: 'Research paper', model: 'Model', dataset: 'Dataset', patent: 'Patent', technology: 'Technology signal', social: 'Conversation signal' };

function metricFor(artifact) {
  const metrics = artifact?.metrics || {};
  if (artifact?.kind === 'repository') return { value: metrics.stars, label: 'stars' };
  if (artifact?.kind === 'paper') return { value: metrics.citations, label: 'citations' };
  if (artifact?.kind === 'model' || artifact?.kind === 'dataset') return { value: metrics.downloads, label: 'downloads' };
  if (artifact?.kind === 'patent') return { value: metrics.family_count, label: 'family records' };
  if (artifact?.kind === 'technology') return { value: metrics.evidence_count, label: 'evidence signals' };
  return { value: metrics.engagement, label: 'engagement' };
}

function displayMetric(artifact) {
  const metric = metricFor(artifact);
  const numeric = Number(metric.value);
  if (!Number.isFinite(numeric)) return 'Popular now';
  return `${new Intl.NumberFormat(undefined, { notation: numeric >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(numeric)} ${metric.label}`;
}

function routeFor(artifact) {
  const encoded = encodeURIComponent(artifact?.id || '');
  if (artifact?.kind === 'repository') return `/venturelens/repositories?focus=${encoded}`;
  if (artifact?.kind === 'paper') return `/venturelens/research?focus=${encoded}`;
  if (artifact?.kind === 'model') return `/venturelens/models?focus=${encoded}`;
  if (artifact?.kind === 'dataset') return `/venturelens/datasets?focus=${encoded}`;
  if (artifact?.kind === 'patent') return `/venturelens/patents?focus=${encoded}`;
  if (artifact?.kind === 'technology') return artifact.url || `/venturelens/radar?signal=${encoded}`;
  return artifact?.url || '/venturelens';
}

function useStreamMotion() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(Boolean(media?.matches));
    const onVisibility = () => setPaused(document.hidden);
    onMotion(); onVisibility();
    media?.addEventListener?.('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { media?.removeEventListener?.('change', onMotion); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  return { paused, reduced, setPaused };
}

function ObservatoryCarousel({ artifacts }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const { paused, reduced, setPaused } = useStreamMotion();
  useEffect(() => { if (index >= artifacts.length) setIndex(0); }, [artifacts.length, index]);
  useEffect(() => {
    if (paused || reduced || artifacts.length <= 1) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % artifacts.length), 9000);
    return () => window.clearInterval(timer);
  }, [artifacts.length, paused, reduced]);
  if (!artifacts.length) return null;
  const active = artifacts[index];
  const move = (delta) => setIndex((current) => (current + delta + artifacts.length) % artifacts.length);
  return (
    <section aria-label="Research Observatory" aria-roledescription="carousel" className={`rio-observatory is-${active.kind}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="rio-orbits" aria-hidden="true"><i /><i /><i /><b /></div>
      <div className="rio-observatory-layout">
        <header><div><span>Research Observatory</span><small>Live cross-provider evidence</small></div><div><button aria-label="Previous artifact" onClick={() => move(-1)} type="button"><Icon name="chevL" /></button><button aria-label="Next artifact" onClick={() => move(1)} type="button"><Icon name="chevR" /></button></div></header>
        <div className="rio-evidence-index"><span>{TYPE_LABELS[active.kind] || active.kind}</span><strong>{String(index + 1).padStart(2, '0')}</strong><small>of {String(artifacts.length).padStart(2, '0')}</small></div>
        <div className="rio-observatory-copy"><span>{active.source} · {active.category}</span><h1>{active.title}</h1><p>{active.summary || 'Open the source record for the complete evidence trail.'}</p></div>
        <footer><button onClick={() => navigate(routeFor(active))} type="button">Inspect evidence <Icon name="chevR" size={14} /></button><div><strong>{displayMetric(active)}</strong><span>{active.momentum == null ? 'Popular now' : `${active.momentum >= 0 ? '+' : ''}${active.momentum}% momentum`}</span></div><nav aria-label="Featured artifacts">{artifacts.map((artifact, dot) => <button aria-label={`Go to artifact ${dot + 1}`} aria-selected={dot === index} className={dot === index ? 'is-active' : ''} key={`${artifact.kind}-${artifact.id}`} onClick={() => setIndex(dot)} type="button" />)}</nav></footer>
      </div>
    </section>
  );
}

function EvidenceStream({ artifacts }) {
  const navigate = useNavigate();
  const { paused, reduced, setPaused } = useStreamMotion();
  const entries = reduced ? artifacts : [...artifacts, ...artifacts];
  return (
    <aside aria-label="Evidence Stream" className={`rio-stream${paused ? ' is-paused' : ''}${reduced ? ' is-static' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <header><div><span>Evidence Stream</span><h2>Signals with momentum</h2></div><i aria-hidden="true" /></header>
      <div className="rio-stream-window"><div className="rio-stream-track">{entries.map((artifact, index) => { const duplicate = !reduced && index >= artifacts.length; const content = <><span>{TYPE_LABELS[artifact.kind] || artifact.kind}</span><strong>{artifact.title}</strong><small>{artifact.source}</small><b>{displayMetric(artifact)}</b></>; return duplicate ? <div aria-hidden="true" className={`rio-stream-card is-${artifact.kind}`} key={`${artifact.kind}-${artifact.id}-${index}`}>{content}</div> : <button className={`rio-stream-card is-${artifact.kind}`} key={`${artifact.kind}-${artifact.id}-${index}`} onClick={() => navigate(routeFor(artifact))} type="button">{content}</button>; })}</div></div>
      <footer>Metrics are compared only within the same artifact type.</footer>
    </aside>
  );
}

export default function ResearchScreen() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getVentureDiscovery().then((result) => { if (!cancelled) setPayload(result); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  const lanes = useMemo(() => LANE_DEFINITIONS.filter((lane) => !lane.provider || payload?.providers?.[lane.provider]?.available !== false), [payload]);
  if (!payload && !failed) return <div className="research-command-center"><div className="rio-state" role="status"><span /><h1>Calibrating the Research Observatory…</h1><p>Loading cached evidence while stale providers refresh independently.</p></div></div>;
  if (failed || !payload) return <div className="research-command-center"><div className="rio-state is-error" role="alert"><Icon name="warning" size={22} /><h1>The discovery gateway is temporarily unavailable.</h1><p>Existing Venture Lens workspaces remain available and the NewsScrapper scheduler is unaffected.</p><button onClick={() => navigate('/venturelens')} type="button">Open Venture Lens</button></div></div>;
  return (
    <div className="research-command-center">
      <section className="rio-primary-row"><ObservatoryCarousel artifacts={(payload.featured || []).slice(0, 6)} /><EvidenceStream artifacts={(payload.stream || []).slice(0, 12)} /></section>
      <nav aria-label="Research intelligence lanes" className="rio-lanes">{lanes.map((lane, index) => <button key={lane.id} onClick={() => navigate(lane.route)} type="button"><span>{String(index + 1).padStart(2, '0')}</span><i><Icon name={lane.icon} size={18} /></i><div><strong>{lane.label}</strong><small>{lane.detail}</small></div><Icon name="chevR" size={15} /></button>)}</nav>
      <footer className="rio-provider-status"><span>Discovery generated {new Date(payload.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><div>{Object.entries(payload.providers || {}).map(([name, state]) => <span className={state.available ? state.stale ? 'is-stale' : 'is-live' : 'is-offline'} key={name}>{name} · {state.available ? state.stale ? 'cached' : 'live' : 'not configured'}</span>)}</div><button onClick={() => navigate('/venturelens')} type="button">Open full Venture Lens <Icon name="external" size={14} /></button></footer>
    </div>
  );
}
