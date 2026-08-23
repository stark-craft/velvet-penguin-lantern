import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';
import {
  getPublishedInternalContent,
  getSamsungInternalFeed,
  getSharedBriefing,
  getLatestBriefing,
} from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import {
  activeLeadership,
  announcementsOf,
  buildHeroSlides,
  colleagueStoriesOf,
  coverUrl,
  groupSignalsByDate,
  isSamsungSignal,
  rankTrending,
  signalLinkOf,
  signalScope,
  splitByScope,
} from '../internal/samsungInternalModel.js';
import '../styles/samsung-internal.css';

const HERO_SLIDE_LIMIT = 5;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function resolveArticleImage(item) {
  if (!item || typeof item !== 'object') return '';
  const candidates = [
    item.image_url, item.imageUrl, item.image, item.thumbnail_url, item.thumbnail,
    item.og_image, item.article_image_url, item.web_search_image_url,
    item.image_metadata?.image_url, item.image_metadata?.url,
    item.media?.image_url, item.media?.url,
    item.images?.[0]?.image_url, item.images?.[0]?.url, item.images?.[0],
  ];
  const match = candidates.find((value) => typeof value === 'string' && value.trim() && value.trim() !== '#');
  return match?.trim() || '';
}

function formatDate(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateHeading(value) {
  if (!value || value === 'undated') return 'Date unavailable';
  const parsed = Date.parse(`${value}T12:00:00`);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function excerptOf(text, limit = 320) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function LeadershipSlide({ record }) {
  const portrait = coverUrl(record);
  const message = excerptOf(record.summary || record.body, 420);
  return (
    <div className="sni-leader" data-has-portrait={portrait ? 'true' : 'false'}>
      <div className="sni-leader-copy">
        <div className="sni-kicker-row">
          <span className="sni-kicker">From the MD&rsquo;s desk</span>
          <span className="sni-chip sni-chip-static">
            <Icon name="pin" size={12} /> Pinned message
          </span>
        </div>
        <h2 className="sni-leader-title">{record.title || 'A word from leadership'}</h2>
        {message && <blockquote className="sni-leader-quote">&ldquo;{message}&rdquo;</blockquote>}
        <div className="sni-leader-meta">
          {record.author && <span><Icon name="eye" size={13} /> {record.author}</span>}
          {formatDate(record.publishedAt) && <span><Icon name="calendar" size={13} /> {formatDate(record.publishedAt)}</span>}
          {record.category && <span className="sni-chip">{record.category}</span>}
        </div>
      </div>
      {portrait && (
        <figure className="sni-leader-portrait">
          <img alt={`${record.author || 'Leadership'} portrait`} src={portrait} />
        </figure>
      )}
    </div>
  );
}

function SignalSlide({ item }) {
  const scope = signalScope(item);
  const channel = item.samsung_internal_channel || scope;
  const channelLabel = channel === 'local'
    ? 'Samsung local'
    : channel === 'sampark'
      ? 'Inside Samsung'
      : 'Samsung global';
  const link = signalLinkOf(item);
  return (
    <div className="sni-signal-slide">
      <div className="sni-kicker-row">
        <span className="sni-kicker">Trending now</span>
        <span className={`sni-chip sni-chip-scope-${channel}`}>{channelLabel}</span>
      </div>
      <h2 className="sni-signal-title">{item.title}</h2>
      {item.summary && <p className="sni-signal-summary">{excerptOf(item.summary, 240)}</p>}
      <div className="sni-signal-meta">
        <span>{item.source || item.src || 'Tech press'}</span>
        {(item.source_count || 1) > 1 && <span className="sni-chip">{item.source_count} sources</span>}
        {item.category && <span className="sni-chip">{item.category}</span>}
      </div>
      {link && (
        <a className="btn-dark-primary sni-cta" href={link} rel="noreferrer" target="_blank">
          Read at source <Icon name="external" size={14} />
        </a>
      )}
    </div>
  );
}

function HeroCarousel({ slides }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches || false;
  }, []);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  useEffect(() => {
    if (paused || reducedMotion.current || slides.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  if (!slides.length) return null;
  const move = (delta) => setIndex((current) => (current + delta + slides.length) % slides.length);
  const active = slides[index];

  return (
    <section
      aria-label="Samsung Internal highlights"
      aria-roledescription="carousel"
      className={`hero-cluster-panel sni-hero${active.kind === 'leadership' ? ' sni-hero-leadership' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <button
        aria-label={active.kind === 'leadership' ? 'Leadership message slide' : `Open ${active.item?.title || 'story'} at source`}
        className="absolute inset-0 z-0 text-left"
        onClick={() => {
          if (active.kind === 'signal') {
            const link = signalLinkOf(active.item);
            if (link) window.open(link, '_blank', 'noopener');
          }
        }}
        type="button"
      >
        {active.kind === 'signal'
          ? <SignalVisual item={{ ...active.item, image_url: resolveArticleImage(active.item) }} className="visual-layer z-0" label={false} />
          : <div className="fallback-visual pointer-events-none absolute inset-0 z-0 overflow-hidden"><div className="fallback-grid absolute inset-0 z-0" /><div className="fallback-glow absolute inset-0 z-0" /></div>}
        <div className="sni-hero-shade absolute inset-0 z-10" />
      </button>

      <div className={`sni-hero-stage${active.kind === 'leadership' ? ' sni-hero-stage-leadership' : ''}`}>
        <div className="sni-hero-topline">
          <span className="sni-brand">Samsung Internal</span>
          <div className="sni-hero-controls">
            <button aria-label="Previous slide" className="carousel-control" onClick={() => move(-1)} type="button">
              <Icon name="chevL" />
            </button>
            <button aria-label="Next slide" className="carousel-control" onClick={() => move(1)} type="button">
              <Icon name="chevR" />
            </button>
          </div>
        </div>

        {active.kind === 'leadership'
          ? <LeadershipSlide record={active.record} />
          : <SignalSlide item={{ ...active.item, image_url: resolveArticleImage(active.item) }} />}

        <div className="sni-dots" role="tablist" aria-label="Slides">
          {slides.map((slide, dotIndex) => (
            <button
              aria-label={`Go to slide ${dotIndex + 1}${slide.kind === 'leadership' ? ' — leadership message' : ''}`}
              aria-selected={dotIndex === index}
              className={dotIndex === index ? 'is-active' : ''}
              key={slide.kind === 'leadership' ? 'leadership' : slide.item?.id || dotIndex}
              onClick={() => setIndex(dotIndex)}
              role="tab"
              type="button"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SignalCard({ item }) {
  const image = resolveArticleImage(item);
  const link = signalLinkOf(item);
  const scope = signalScope(item);
  const channel = item.samsung_internal_channel || scope;
  const scopeLabel = channel === 'sampark' ? 'Inside' : scope === 'local' ? 'Local' : 'Global';
  return (
    <article className="sni-card">
      <div className={`sni-card-media${image ? '' : ' is-empty'}`}>
        {image
          ? <img alt="" loading="lazy" src={image} />
          : <span aria-hidden="true"><Icon name="globe" size={22} /></span>}
        <span className={`sni-card-scope sni-chip-scope-${channel}`}>{scopeLabel}</span>
      </div>
      <div className="sni-card-body">
        <h3>
          {link
            ? <a href={link} rel="noreferrer" target="_blank">{item.title}</a>
            : item.title}
        </h3>
        {item.summary && <p>{excerptOf(item.summary, 160)}</p>}
        <footer>
          <span>{item.source || item.src || 'Tech press'}</span>
          {formatDate(item.published_at || item.first_seen || item.date) && (
            <span><Icon name="calendar" size={12} /> {formatDate(item.published_at || item.first_seen || item.date)}</span>
          )}
          {(item.source_count || 1) > 1 && <span className="sni-chip">{item.source_count} sources</span>}
        </footer>
      </div>
    </article>
  );
}

function ContributionCard({ record, kindLabel }) {
  const portrait = coverUrl(record);
  return (
    <article className="sni-card sni-card-internal">
      <div className={`sni-card-media${portrait ? '' : ' is-empty'}`}>
        {portrait
          ? <img alt="" loading="lazy" src={portrait} />
          : <span aria-hidden="true"><Icon name="note" size={22} /></span>}
        <span className="sni-card-kind">{kindLabel}</span>
      </div>
      <div className="sni-card-body">
        <h3>{record.title || 'Untitled'}</h3>
        <p>{excerptOf(record.summary || record.body, 180)}</p>
        <footer>
          {record.author && <span><Icon name="eye" size={12} /> {record.author}</span>}
          {formatDate(record.publishedAt) && <span><Icon name="calendar" size={12} /> {formatDate(record.publishedAt)}</span>}
          {record.category && <span className="sni-chip">{record.category}</span>}
        </footer>
      </div>
    </article>
  );
}

function AnnouncementCard({ record }) {
  const image = coverUrl(record);
  const date = formatDate(record.publishedAt);
  const copy = excerptOf(record.summary || record.body, image ? 250 : 420);
  return (
    <article className={`sni-notice${image ? ' sni-notice-with-image' : ' sni-notice-text-only'}`}>
      {image && (
        <figure className="sni-notice-media">
          <img alt="" loading="lazy" src={image} />
          <span>Announcement</span>
        </figure>
      )}
      <div className="sni-notice-copy">
        <header>
          <span className="sni-notice-label"><Icon name="megaphone" size={13} /> Announcement</span>
          {date && <time dateTime={record.publishedAt}>{date}</time>}
        </header>
        <h3>{record.title || 'Company announcement'}</h3>
        {copy && <p>{copy}</p>}
        <footer>
          <span>{record.author || 'Samsung Internal desk'}</span>
          {record.category && <span className="sni-notice-category">{record.category}</span>}
        </footer>
      </div>
    </article>
  );
}

function DateGroupedSignals({ items }) {
  return (
    <div className="sni-date-groups">
      {groupSignalsByDate(items).map((group) => (
        <section className="sni-date-group" key={group.date}>
          <header>
            <div>
              <span>Daily edition</span>
              <h2>{formatDateHeading(group.date)}</h2>
            </div>
            <small>{group.signals.length} {group.signals.length === 1 ? 'signal' : 'signals'}</small>
          </header>
          <div className="sni-grid">
            {group.signals.map((item, index) => (
              <SignalCard item={item} key={item.id || item.link || item.title || index} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EmptyPanel({ title, copy, action }) {
  return (
    <div className="sni-empty">
      <span aria-hidden="true"><Icon name="inbox" size={26} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

const TABS = [
  { id: 'global', label: 'Samsung Global', icon: 'globe' },
  { id: 'local', label: 'Samsung Local', icon: 'radar' },
  { id: 'internal', label: 'Inside Samsung', icon: 'layers' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
];

export default function SamsungInternalScreen() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [channelFeed, setChannelFeed] = useState(null);
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [tab, setTab] = useState('global');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      getSamsungInternalFeed(100)
        .then((feed) => ({ feed, articles: [
          ...(feed?.global || []), ...(feed?.local || []), ...(feed?.sampark || []),
        ] }))
        .catch(async () => {
          const briefingData = await getSharedBriefing().catch(() => getLatestBriefing());
          return {
            feed: null,
            articles: normalizeList(
              briefingData?.result || briefingData?.results || briefingData?.articles || briefingData || [],
            ),
          };
        }),
      getPublishedInternalContent().catch(() => []),
    ])
      .then(([feedResult, publishedRecords]) => {
        if (cancelled) return;
        setChannelFeed(feedResult.feed);
        setArticles(normalizeList(feedResult.articles).map((item) => ({
          ...item,
          image_url: resolveArticleImage(item),
        })));
        setPublished(Array.isArray(publishedRecords) ? publishedRecords : []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || 'Samsung Internal could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const model = useMemo(() => {
    const leadership = activeLeadership(published);
    const slides = buildHeroSlides({ articles, leadership, limit: HERO_SLIDE_LIMIT });
    const samsungOnly = rankTrending(articles.filter(isSamsungSignal));
    const scoped = splitByScope(samsungOnly);
    return {
      slides,
      leadership,
      global: channelFeed ? rankTrending(channelFeed.global || []) : scoped.global,
      local: channelFeed ? rankTrending(channelFeed.local || []) : scoped.local,
      sampark: channelFeed ? rankTrending(channelFeed.sampark || []) : scoped.inside,
      stories: colleagueStoriesOf(published),
      announcements: announcementsOf(published),
    };
  }, [articles, channelFeed, published]);

  const contributeButton = (
    <button className="btn-dark-secondary" onClick={() => navigate('/saved/contribute')} type="button">
      <Icon name="plus" size={14} /> Open the contribute desk
    </button>
  );

  const announcementButton = (
    <button className="btn-dark-secondary" onClick={() => navigate('/internal-publishing')} type="button">
      <Icon name="megaphone" size={14} /> Post an announcement
    </button>
  );

  const renderTabPanel = () => {
    if (tab === 'global') {
      return model.global.length
        ? <DateGroupedSignals items={model.global.slice(0, 100)} />
        : <EmptyPanel copy="No Samsung-related stories are present in the retained unified briefing archive yet. The next four-hour scan may bring fresh signals." title="Nothing on the global wire yet" />;
    }
    if (tab === 'local') {
      return model.local.length
        ? <DateGroupedSignals items={model.local.slice(0, 100)} />
        : <EmptyPanel copy="Stories appear here when the unified scheduler extracts an article whose configured source name is Samsung Local or Samsung India." title="The local desk is quiet" />;
    }
    if (tab === 'internal') {
      if (!model.sampark.length && !model.stories.length) {
        return <EmptyPanel action={contributeButton} copy="Sampark-sourced updates and colleague stories appear here when they enter the unified archive or clear editorial review." title="Nothing inside Samsung yet" />;
      }
      return (
        <div className="sni-inside-stream">
          {model.sampark.length > 0 && (
            <section className="sni-inside-section">
              <header><span>Sampark stream</span><h2>From inside the company</h2></header>
              <DateGroupedSignals items={model.sampark.slice(0, 100)} />
            </section>
          )}
          {model.stories.length > 0 && (
            <section className="sni-inside-section">
              <header><span>Colleague publishing</span><h2>Stories from your teams</h2></header>
              <div className="sni-grid">{model.stories.map((record) => <ContributionCard kindLabel={record.contentType === 'document_import' ? 'Document story' : 'Colleague story'} key={record.id} record={record} />)}</div>
            </section>
          )}
        </div>
      );
    }
    return model.announcements.length
      ? <div className="sni-announcement-board">{model.announcements.map((record) => <AnnouncementCard key={record.id} record={record} />)}</div>
      : <EmptyPanel action={announcementButton} copy="HR and admin notices land here after an editor approves them from the review desk." title="No announcements posted yet" />;
  };

  const counts = {
    global: model.global.length,
    local: model.local.length,
    internal: model.sampark.length + model.stories.length,
    announcements: model.announcements.length,
  };

  if (loading) {
    return (
      <div className="samsung-internal-page">
        <div aria-live="polite" className="sni-state" role="status">
          <span className="sni-loader" />
          <h1>Opening Samsung Internal…</h1>
          <p>Bringing the leadership desk, trending Samsung signals and published colleague work together.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="samsung-internal-page">
        <div className="sni-state sni-state-error" role="alert">
          <span aria-hidden="true"><Icon name="warning" size={20} /></span>
          <h1>Samsung Internal could not load</h1>
          <p>{error}</p>
          <button className="btn-dark-secondary" onClick={() => setLoadAttempt((current) => current + 1)} type="button">
            <Icon name="refresh" size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="samsung-internal-page">
      <HeroCarousel slides={model.slides} />

      {!model.leadership && (
        <p className="sni-note" role="note">
          The leadership desk has not published a message yet. When it does, it will lead this page.
        </p>
      )}

      <nav aria-label="Samsung Internal channels" className="sni-tabs">
        {TABS.map((entry) => (
          <button
            aria-current={tab === entry.id ? 'page' : undefined}
            aria-selected={tab === entry.id}
            className={`sni-tab${tab === entry.id ? ' is-active' : ''}`}
            key={entry.id}
            onClick={() => setTab(entry.id)}
            role="tab"
            type="button"
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
            <small>{counts[entry.id]}</small>
          </button>
        ))}
      </nav>

      <section aria-label={`${TABS.find((entry) => entry.id === tab)?.label} channel`} className="sni-panel" role="tabpanel">
        {renderTabPanel()}
      </section>

      <footer className="sni-foot">
        <span>Samsung Internal · curated by your editorial desk</span>
        <button className="btn-dark-secondary" onClick={() => navigate('/saved/contribute')} type="button">
          <Icon name="plus" size={14} /> Contribute a story
        </button>
      </footer>
    </div>
  );
}
