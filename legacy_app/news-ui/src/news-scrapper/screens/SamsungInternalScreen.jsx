import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';
import { getPublishedInternalContent, getSamsungInternalFeed, getSharedBriefing, getLatestBriefing } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import {
  activeLeadership, announcementsOf, buildHeroSlides, buildSamsungWire,
  colleagueStoriesOf, coverUrl, groupSignalsByDate, isSamsungSignal,
  rankTrending, resolveInternalImage, signalLinkOf, signalScope, splitByScope,
} from '../internal/samsungInternalModel.js';
import '../styles/samsung-internal.css';

const HERO_SLIDE_LIMIT = 5;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const CHANNELS = [
  { id: 'global', label: 'Samsung Global', icon: 'globe' },
  { id: 'local', label: 'Samsung Local', icon: 'radar' },
  { id: 'internal', label: 'Inside Samsung', icon: 'layers' },
];

function formatDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
}

function formatDateHeading(value) {
  if (!value || value === 'undated') return 'Date unavailable';
  const parsed = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : value;
}

function excerptOf(text, limit = 320) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function useMotionPause() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const syncMotion = () => setReduced(Boolean(media?.matches));
    const syncVisibility = () => setPaused(document.visibilityState !== 'visible');
    syncMotion(); syncVisibility();
    media?.addEventListener?.('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      media?.removeEventListener?.('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);
  return { paused, reduced, setPaused };
}

function ResilientImage({ src, alt = '', className = '', loading = 'lazy' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <span aria-hidden="true" className={`sni-image-fallback${className ? ` ${className}` : ''}`}><Icon name="layers" size={18} /></span>;
  return <img alt={alt} className={className} loading={loading} onError={() => setFailed(true)} src={src} />;
}

function rememberInternalPosition() {
  window.sessionStorage.setItem('samsung-internal-scroll-y', String(window.scrollY || 0));
}

function AnnouncementRail({ items }) {
  const navigate = useNavigate();
  const { paused, reduced, setPaused } = useMotionPause();
  if (!items.length) return null;
  const entries = reduced ? items : [...items, ...items];
  return (
    <section
      aria-label="Company announcements"
      className={`sni-wire-announcements${paused ? ' is-paused' : ''}${reduced ? ' is-static' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
      onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    >
      <div className="sni-announcement-label"><Icon name="megaphone" size={13} /><span>Notices</span></div>
      <div className="sni-announcement-window"><div className="sni-announcement-track">
        {entries.map((record, index) => {
          const duplicate = !reduced && index >= items.length;
          const content = <><span>{record.category || 'Announcement'}</span><strong>{record.title || 'Company announcement'}</strong><time>{formatDate(record.publishedAt)}</time></>;
          if (duplicate) return <div aria-hidden="true" className="sni-announcement-item" key={`${record.id}-${index}`}>{content}</div>;
          return <button
            aria-label={`Read announcement: ${record.title || 'Company announcement'}`}
            className="sni-announcement-item" key={`${record.id}-${index}`}
            onClick={() => {
              rememberInternalPosition();
              navigate(`/samsung-internal/announcement/${encodeURIComponent(record.id)}`);
            }} type="button"
          >{content}</button>;
        })}
      </div></div>
    </section>
  );
}

function channelLabel(item) {
  const channel = item?.samsung_internal_channel || signalScope(item);
  if (channel === 'local') return 'Samsung Local';
  if (channel === 'inside' || channel === 'sampark') return 'Inside Samsung';
  return 'Samsung Global';
}

function FocusCarousel({ slides }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const { paused, reduced, setPaused } = useMotionPause();
  useEffect(() => { if (index >= slides.length) setIndex(0); }, [index, slides.length]);
  useEffect(() => {
    if (paused || reduced || slides.length <= 1) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % slides.length), 8000);
    return () => window.clearInterval(timer);
  }, [paused, reduced, slides.length]);
  if (!slides.length) return null;
  const active = slides[index];
  const article = active.kind === 'signal' ? active.item : null;
  const record = active.kind === 'leadership' ? active.record : null;
  const image = record ? coverUrl(record) : resolveInternalImage(article);
  const title = record?.title || article?.title || 'Samsung Focus';
  const summary = record?.summary || record?.body || article?.summary || article?.snippet || '';
  const move = (delta) => setIndex((current) => (current + delta + slides.length) % slides.length);
  const openActive = () => {
    rememberInternalPosition();
    if (record) navigate(`/samsung-internal/leadership/${encodeURIComponent(record.id)}`);
    else {
      const link = signalLinkOf(article);
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <section
      aria-label="Samsung Focus" aria-roledescription="carousel"
      className={`sni-focus-carousel${record ? ' is-leadership' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
      onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    >
      {!record && <SignalVisual className="sni-focus-visual" item={{ ...article, image_url: image }} label={false} />}
      {record && image && <ResilientImage alt={`${record.author || 'Leadership'} portrait`} className="sni-focus-portrait" loading="eager" src={image} />}
      <div className="sni-focus-shade" aria-hidden="true" />
      <div className="sni-focus-layout">
        <header className="sni-focus-header">
          <span className="sni-focus-label">Samsung Focus</span>
          <div className="sni-focus-controls">
            <button aria-label="Previous Samsung Focus slide" className="carousel-control" onClick={() => move(-1)} type="button"><Icon name="chevL" /></button>
            <button aria-label="Next Samsung Focus slide" className="carousel-control" onClick={() => move(1)} type="button"><Icon name="chevR" /></button>
          </div>
        </header>
        <div className="sni-focus-tags">
          <span className={`sni-chip sni-chip-scope-${record ? 'inside' : article?.samsung_internal_channel || signalScope(article)}`}>{record ? 'From the MD’s desk' : channelLabel(article)}</span>
          {!record && article?.category && <span className="sni-chip">{article.category}</span>}
          {!record && <span className="sni-chip">{article?.source_count || 1} {(article?.source_count || 1) === 1 ? 'source' : 'sources'}</span>}
          {record?.category && <span className="sni-chip">{record.category}</span>}
        </div>
        <div className="sni-focus-copy"><h1>{title}</h1><p>{excerptOf(summary, 520) || 'Open this signal for the complete context.'}</p></div>
        <div className="sni-focus-footer">
          <button className="sni-focus-action" onClick={openActive} type="button"><Icon name={record ? 'file' : 'external'} size={15} /> {record ? 'Read full message' : 'Read at source'}</button>
          <div aria-label="Samsung Focus slides" className="sni-focus-dots" role="tablist">
            {slides.map((slide, dotIndex) => (
              <button aria-label={`Go to Samsung Focus slide ${dotIndex + 1}`} aria-selected={dotIndex === index}
                className={dotIndex === index ? 'is-active' : ''}
                key={slide.kind === 'leadership' ? slide.record.id : slide.item?.id || dotIndex}
                onClick={() => setIndex(dotIndex)} role="tab" type="button" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WireCard({ item, duplicate = false }) {
  const image = resolveInternalImage(item);
  const link = signalLinkOf(item);
  const content = <><span className="sni-wire-marker">{channelLabel(item)}</span><div className="sni-wire-copy"><strong>{item.title}</strong><small>{item.source || item.src || 'Samsung intelligence'} · {formatDate(item.published_at || item.first_seen || item.date) || 'Latest'} · {item.source_count || 1} {(item.source_count || 1) === 1 ? 'source' : 'sources'}</small></div><span className={`sni-wire-thumb${image ? '' : ' is-empty'}`}>{image ? <ResilientImage alt="" src={image} /> : <Icon name="layers" size={16} />}</span></>;
  if (duplicate) return <div aria-hidden="true" className={`sni-wire-card is-${item.samsung_internal_channel || 'global'}`}>{content}</div>;
  return (
    <a className={`sni-wire-card is-${item.samsung_internal_channel || 'global'}`} href={link || undefined} rel="noreferrer" target={link ? '_blank' : undefined}>{content}</a>
  );
}

function IntelligenceWire({ announcements = [], items }) {
  const { paused, reduced, setPaused } = useMotionPause();
  const entries = reduced ? items : [...items, ...items];
  return (
    <aside aria-label="Samsung Intelligence Wire" className={`sni-wire${paused ? ' is-paused' : ''}${reduced ? ' is-static' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <header><div><span>Live intelligence</span><h2>Samsung Intelligence Wire</h2></div><i aria-hidden="true" /></header>
      <AnnouncementRail items={announcements} />
      {items.length ? <div className="sni-wire-window"><div className="sni-wire-track">{entries.map((item, index) => <WireCard duplicate={!reduced && index >= items.length} item={item} key={`${item.id || item.link || item.title}-${index}`} />)}</div></div>
        : <div className="sni-wire-empty"><Icon name="inbox" size={22} /><p>The wire will populate after the unified archive contains Samsung signals.</p></div>}
      <footer><span>Global</span><span>Local</span><span>Inside</span></footer>
    </aside>
  );
}

function SignalCard({ item }) {
  const image = resolveInternalImage(item);
  const link = signalLinkOf(item);
  return (
    <article className="sni-card">
      <div className={`sni-card-media${image ? '' : ' is-empty'}`}>
        {image ? <ResilientImage alt="" src={image} /> : <span aria-hidden="true"><Icon name="globe" size={22} /></span>}
        <span className={`sni-card-scope sni-chip-scope-${item.samsung_internal_channel || signalScope(item)}`}>{channelLabel(item)}</span>
      </div>
      <div className="sni-card-body"><h3>{link ? <a href={link} rel="noreferrer" target="_blank">{item.title}</a> : item.title}</h3>{item.summary && <p>{excerptOf(item.summary, 180)}</p>}
        <footer><span>{item.source || item.src || 'Tech press'}</span>{formatDate(item.published_at || item.first_seen || item.date) && <span><Icon name="calendar" size={12} /> {formatDate(item.published_at || item.first_seen || item.date)}</span>}<span className="sni-chip">{item.source_count || 1} {(item.source_count || 1) === 1 ? 'source' : 'sources'}</span></footer>
      </div>
    </article>
  );
}

function ContributionCard({ record }) {
  const image = coverUrl(record);
  return (
    <article className="sni-card sni-card-internal">
      <div className={`sni-card-media${image ? '' : ' is-empty'}`}>{image ? <ResilientImage alt="" src={image} /> : <span aria-hidden="true"><Icon name="note" size={22} /></span>}<span className="sni-card-kind">Colleague story</span></div>
      <div className="sni-card-body"><h3>{record.title || 'Untitled'}</h3><p>{excerptOf(record.summary || record.body, 180)}</p><footer><span>{record.author || 'Samsung colleague'}</span><span>{formatDate(record.publishedAt)}</span></footer></div>
    </article>
  );
}

function DateGroupedSignals({ items }) {
  return <div className="sni-date-groups">{groupSignalsByDate(items).map((group) => <section className="sni-date-group" key={group.date}><header><div><span>Daily edition</span><h2>{formatDateHeading(group.date)}</h2></div><small>{group.signals.length} {group.signals.length === 1 ? 'signal' : 'signals'}</small></header><div className="sni-grid">{group.signals.map((item, index) => <SignalCard item={item} key={item.id || item.link || item.title || index} />)}</div></section>)}</div>;
}

function EmptyPanel({ title, copy, action }) {
  return <div className="sni-empty"><Icon name="inbox" size={26} /><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

function normalizeChannel(items, channel) {
  return normalizeList(items || []).map((item) => ({ ...item, image_url: resolveInternalImage(item), samsung_internal_channel: channel }));
}

export default function SamsungInternalScreen({ contributionAllowed = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [channels, setChannels] = useState({ global: [], local: [], inside: [] });
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [tab, setTab] = useState('global');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([
      getSamsungInternalFeed(100).catch(async () => {
        const briefingData = await getSharedBriefing().catch(() => getLatestBriefing());
        return splitByScope(normalizeList(briefingData?.result || briefingData?.results || briefingData?.articles || briefingData || []).filter(isSamsungSignal));
      }),
      getPublishedInternalContent().catch(() => []),
    ]).then(([feed, records]) => {
      if (cancelled) return;
      setChannels({ global: normalizeChannel(feed?.global || [], 'global'), local: normalizeChannel(feed?.local || [], 'local'), inside: normalizeChannel(feed?.sampark || feed?.inside || [], 'inside') });
      setPublished(Array.isArray(records) ? records : []);
    }).catch((loadError) => { if (!cancelled) setError(loadError?.message || 'Samsung Internal could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => {
    if (loading || !location.state?.restore) return;
    const top = Number(window.sessionStorage.getItem('samsung-internal-scroll-y') || 0);
    window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }));
  }, [loading, location.state]);

  const model = useMemo(() => {
    const leadership = activeLeadership(published);
    const global = rankTrending(channels.global);
    const local = rankTrending(channels.local);
    const inside = rankTrending(channels.inside);
    const stories = colleagueStoriesOf(published);
    return { leadership, slides: buildHeroSlides({ articles: [...global, ...local, ...inside], leadership, limit: HERO_SLIDE_LIMIT }), global, local, inside, stories, announcements: announcementsOf(published), wire: buildSamsungWire({ global, local, inside }) };
  }, [channels, published]);

  const counts = { global: model.global.length, local: model.local.length, internal: model.inside.length + model.stories.length };
  const contributorAction = contributionAllowed ? <button className="btn-dark-secondary" onClick={() => navigate('/for-you/contributions')} type="button"><Icon name="plus" size={14} /> Open contributions</button> : null;
  const renderTab = () => {
    if (tab === 'global') return model.global.length ? <DateGroupedSignals items={model.global.slice(0, 100)} /> : <EmptyPanel copy="The next unified archive run may bring fresh Samsung coverage." title="Nothing on the global wire yet" />;
    if (tab === 'local') return model.local.length ? <DateGroupedSignals items={model.local.slice(0, 100)} /> : <EmptyPanel copy="This channel accepts records whose configured source is Samsung Local or Samsung India." title="The local desk is quiet" />;
    if (!model.inside.length && !model.stories.length) return <EmptyPanel action={contributorAction} copy="Sampark signals and approved colleague stories appear here." title="Nothing inside Samsung yet" />;
    return <div className="sni-inside-stream">{model.inside.length > 0 && <section className="sni-inside-section"><header><span>Sampark stream</span><h2>From inside the company</h2></header><DateGroupedSignals items={model.inside.slice(0, 100)} /></section>}{model.stories.length > 0 && <section className="sni-inside-section"><header><span>Colleague publishing</span><h2>Stories from your teams</h2></header><div className="sni-grid">{model.stories.map((record) => <ContributionCard key={record.id} record={record} />)}</div></section>}</div>;
  };

  if (loading) return <div className="samsung-internal-page"><div aria-live="polite" className="sni-state" role="status"><span className="sni-loader" /><h1>Opening Samsung Internal…</h1><p>Aligning leadership, company notices and the Samsung intelligence wire.</p></div></div>;
  if (error) return <div className="samsung-internal-page"><div className="sni-state sni-state-error" role="alert"><Icon name="warning" size={20} /><h1>Samsung Internal could not load</h1><p>{error}</p><button className="btn-dark-secondary" onClick={() => setLoadAttempt((value) => value + 1)} type="button"><Icon name="refresh" size={14} /> Try again</button></div></div>;
  return <div className="samsung-internal-page">
    <section className="sni-primary-row">{model.slides.length ? <FocusCarousel slides={model.slides} /> : <EmptyPanel copy="The unified archive has no Samsung signals yet." title="Samsung Focus is preparing" />}<IntelligenceWire announcements={model.announcements} items={model.wire} /></section>
    {!model.leadership && <p className="sni-note" role="note">A published leadership message will take the first Samsung Focus position automatically.</p>}
    <nav aria-label="Samsung Internal archive channels" className="sni-tabs" role="tablist">{CHANNELS.map((entry) => <button aria-selected={tab === entry.id} className={`sni-tab${tab === entry.id ? ' is-active' : ''}`} key={entry.id} onClick={() => setTab(entry.id)} role="tab" type="button"><Icon name={entry.icon} size={15} /><span>{entry.label}</span><small>{counts[entry.id]}</small></button>)}</nav>
    <section aria-label={`${CHANNELS.find((entry) => entry.id === tab)?.label} archive`} className="sni-panel" role="tabpanel">{renderTab()}</section>
    <footer className="sni-foot"><span>Samsung Internal · curated by your editorial desk</span>{contributionAllowed && <button className="btn-dark-secondary" onClick={() => navigate('/for-you/contributions')} type="button"><Icon name="plus" size={14} /> Contribute a story</button>}</footer>
  </div>;
}
