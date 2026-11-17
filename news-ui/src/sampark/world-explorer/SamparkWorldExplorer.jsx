import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { buildWorldCoverage, WORLD_MARKETS } from './worldExplorerModel.js';
import SamsungPageControls from '../samsung-news/SamsungPageControls.jsx';
import { samsungPageItems, samsungPageCount } from '../samsung-news/samsungPagination.js';
import './world-explorer.css';

const SOURCE_LABEL = (item) => item?.source || item?.src || 'Samsung Newsroom';
const articleKey = (article, index) => article?.canonical_link || article?.link || article?.url || article?.id || (article?.title || '') + index;
const imageOf = (article) => article?.image_url || article?.top_image || '';

function Flag({ code }) {
  if (!/^[A-Z]{2}$/.test(code || '')) return <Icon name="globe" size={18} />;
  return <span aria-hidden="true" className="swe-flag">{[...code].map((character) =>
    String.fromCodePoint(character.charCodeAt(0) - 65 + 0x1F1E6)).join('')}</span>;
}

function BackTrail({ page, region, country, onHome, onRegion }) {
  return <nav aria-label="World Explorer location" className="swe-breadcrumbs">
    <button onClick={onHome} type="button">World Explorer</button>
    {region && <><Icon name="chevR" size={13} /><button onClick={() => onRegion(region.id)} type="button">{region.name}</button></>}
    {page && <><Icon name="chevR" size={13} /><span aria-current="page">{page}</span></>}
    {!region && !page && <><Icon name="chevR" size={13} /><span aria-current="page">Explore regions</span></>}
  </nav>;
}

function StoryCollection({ articles, name, subtitle, onOpen }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [name]);
  const currentPage = Math.min(page, Math.max(1, samsungPageCount(articles.length)));
  if (!articles.length) return (
    <div className="swe-no-coverage" role="status">
      <span className="swe-no-coverage-icon"><Icon name="inbox" size={23} /></span>
      <h3>No recent newsroom stories in this edition</h3>
      <p>This market is indexed, but has no articles in the current Global briefing. Explore another market or the combined feed.</p>
    </div>
  );

  const lead = articles[0];
  const leadImage = imageOf(lead);
  return <>
    <div className="swe-section-line">
      <div><span className="swe-eyebrow">THE LATEST</span><h3>{name}</h3><p>{subtitle}</p></div>
      <span className="swe-count-label">{articles.length} {articles.length === 1 ? 'story' : 'stories'}</span>
    </div>
    <div className="sampark-samsung-hero swe-story-hero">
      <section className="sampark-samsung-featured" aria-label={'Featured story from ' + name}>
        <button className="sampark-samsung-featured-media" onClick={() => onOpen(lead)}
          style={leadImage ? { backgroundImage: 'url("' + leadImage + '")' } : undefined}
          type="button">
          <div className="sampark-samsung-featured-overlay">
            <span className="sampark-samsung-featured-kicker">{SOURCE_LABEL(lead)} · {lead.date || 'Latest'}</span>
            <h3>{lead.title}</h3>
            <small>{String(lead.master_summary || lead.summary || lead.snippet || '').slice(0, 180)}</small>
          </div>
        </button>
      </section>
      <aside className="sampark-samsung-stream" aria-label={'Briefing stream for ' + name}>
        <h3>Briefing Stream</h3>
        <div className="sampark-samsung-stream-list">
          {articles.slice(1, 9).length ? articles.slice(1, 9).map((item, i) => (
            <button key={articleKey(item, i)} className="sampark-samsung-stream-item" onClick={() => onOpen(item)} type="button">
              <span className="sampark-samsung-stream-category">{item.category || 'Samsung News'}</span>
              <strong>{item.title}</strong>
              <small>{SOURCE_LABEL(item)} · {item.date || 'Latest'}</small>
            </button>
          )) : <p className="sampark-samsung-empty">More stories will appear with the next briefing.</p>}
        </div>
      </aside>
    </div>
    <section className="sampark-samsung-latest swe-story-list" aria-label="Latest newsroom articles">
      <header><h3>All stories <span className="sampark-samsung-count">({articles.length})</span></h3><span className="sampark-samsung-hint">Open a story to read its dossier</span></header>
      <div className="sampark-samsung-latest-scroll">
        {samsungPageItems(articles, currentPage).map((item, i) => (
          <article className="sampark-samsung-latest-card" key={articleKey(item, i)}>
            <button className="sampark-samsung-latest-media"
              onClick={() => onOpen(item)} type="button" aria-label={'Read ' + item.title}
              style={imageOf(item) ? { backgroundImage: 'url("' + imageOf(item) + '")' } : undefined}>
              {!imageOf(item) && <Icon name="layers" size={24} />}
            </button>
            <div className="sampark-samsung-latest-tags">{SOURCE_LABEL(item)} · {item.date || 'Latest'}</div>
            <button className="sampark-samsung-latest-title" onClick={() => onOpen(item)} type="button">{item.title}</button>
          </article>
        ))}
      </div>
    </section>
    <SamsungPageControls page={currentPage} total={articles.length}
      onChange={setPage} label={name + ' stories'} />
  </>;
}

export default function SamparkWorldExplorer({ articles = [], onOpen, coverageComplete = true }) {
  const coverage = useMemo(() => buildWorldCoverage(articles), [articles]);
  const [page, setPage] = useState({ kind: 'home' });
  const openHome = () => setPage({ kind: 'home' });
  const openRegion = (id) => setPage({ kind: 'region', id });
  const openCountry = (id) => setPage({ kind: 'country', id });
  const openDesk = (id, kind = 'business') => setPage({ kind, id });
  const region = coverage.regions.find((r) => r.id === page.id);
  const country = WORLD_MARKETS.find((m) => m.code === page.id);
  const countryRegion = country && coverage.regions.find((r) => r.id === country.regionId);
  const business = coverage.businesses.find((r) => r.name === page.id);
  const regionalDesk = Object.values(coverage.regions).flatMap((r) => r.regionalDesks).find((r) => r.name === page.id);
  const allCount = coverage.all.length;

  return <section className="swe" aria-label="Samsung World Explorer">
    <div className="swe-intro">
      <div className="swe-intro-copy">
        <span className="swe-eyebrow"><Icon name="globe" size={15} /> SAMSUNG / WORLD EXPLORER</span>
        <h2>Samsung, around the world<span className="swe-title-dot">.</span></h2>
        <p>Discover the stories shaping Samsung across regions, local newsrooms and businesses.</p>
      </div>
      <div className="swe-stat-bar" aria-label="Current coverage">
        <div><strong>{coverage.marketCount}</strong><span>Markets indexed</span></div>
        <div><strong>{coverage.regions.length}</strong><span>Regions</span></div>
        <div><strong>{allCount}</strong><span>Global stories</span></div>
      </div>
    </div>

    {page.kind === 'home' ? <>
      <div className="swe-home-actions">
        <div><span className="swe-eyebrow">01 / DISCOVER</span><h3>Explore by region</h3><p>Select a region to browse its Samsung newsrooms.</p></div>
        <button className="swe-text-action" type="button" onClick={() => setPage({ kind: 'all' })}>View combined Global feed <Icon name="chevR" size={16} /></button>
      </div>
      <div className="swe-region-grid">
        {coverage.regions.map((item, index) => (
          <button className="swe-region-card" key={item.id} onClick={() => openRegion(item.id)} type="button">
            <span className="swe-region-card-top"><span className="swe-region-number">{String(index + 1).padStart(2, '0')}</span><Icon name="globe" size={21} /></span>
            <strong>{item.name}</strong>
            <span className="swe-region-description">{item.description}</span>
            <span className="swe-region-footer"><span>{item.countries.length} {item.countries.length === 1 ? 'market' : 'markets'} · {item.articleCount} stories</span><Icon name="chevR" size={17} /></span>
          </button>
        ))}
      </div>
      <div className="swe-home-actions swe-business-heading">
        <div><span className="swe-eyebrow">02 / SPECIALIST COVERAGE</span><h3>Samsung businesses</h3><p>Explore the latest updates from Samsung's dedicated technology businesses.</p></div>
      </div>
      <div className="swe-business-grid">
        {coverage.businesses.map((item) => (
          <button className="swe-business-card" key={item.name} onClick={() => openDesk(item.name)} type="button">
            <span className="swe-business-mark"><Icon name="layers" size={20} /></span>
            <span><strong>{item.name.replace(/^Samsung /, '').replace(/ Newsroom$/, '')}</strong><small>{item.count} {item.count === 1 ? 'story' : 'stories'} in this edition</small></span>
            <Icon name="chevR" size={16} />
          </button>
        ))}
      </div>
      {coverage.all.length > 0 && <div className="swe-editorial-note">
        <span><Icon name="radar" size={16} /> In focus</span>
        <button type="button" onClick={() => onOpen(coverage.all[0])}>{coverage.all[0].title}</button>
        <button type="button" aria-label="Open the combined Global feed" onClick={() => setPage({ kind: 'all' })}><Icon name="chevR" size={17} /></button>
      </div>}
    </> : null}

    {page.kind === 'region' && region && <>
      <BackTrail page={region.name} onHome={openHome} />
      <div className="swe-section-line swe-detail-heading"><div><span className="swe-eyebrow">REGION / NEWSROOM DIRECTORY</span><h3>{region.name}</h3><p>Choose a market to see its latest Samsung stories.</p></div><span className="swe-count-label">{region.countries.length} markets</span></div>
      {region.regionalDesks.length > 0 && <div className="swe-regional-desk-list">
        {region.regionalDesks.map((desk) => <button key={desk.name} onClick={() => openDesk(desk.name, 'regional')} type="button">
          <Icon name="globe" size={17} /><span>{desk.name}</span><small>{desk.count} stories</small><Icon name="chevR" size={16} />
        </button>)}
      </div>}
      {region.countries.length > 0 ? <div className="swe-market-grid">
        {region.countries.map((market) => (
          <button className="swe-market-card" key={market.code} onClick={() => openCountry(market.code)} type="button">
            <span className="swe-market-main"><Flag code={market.code} /><span><strong>{market.name}</strong><small>{market.sources.length} {market.sources.length === 1 ? 'newsroom edition' : 'newsroom editions'}</small></span></span>
            <span className="swe-market-end"><span className={market.count ? 'swe-count-active' : 'swe-count-muted'}>{market.count} stories</span><Icon name="chevR" size={16} /></span>
          </button>
        ))}
      </div> : <div className="swe-no-coverage"><p>Explore the regional newsroom above for recent coverage.</p></div>}
    </>}

    {page.kind === 'country' && country && <>
      <BackTrail page={country.name} region={countryRegion} onHome={openHome} onRegion={openRegion} />
      <div className="swe-detail-label"><Flag code={country.code} /><span>COUNTRY NEWSROOM / {country.code}</span></div>
      <StoryCollection articles={coverage.byCountry[country.code] || []} name={'Samsung ' + country.name}
        subtitle={'From ' + country.sources.length + (country.sources.length === 1 ? ' official newsroom edition' : ' official newsroom editions')}
        onOpen={onOpen} />
    </>}

    {page.kind === 'business' && business && <>
      <BackTrail page={business.name} onHome={openHome} />
      <StoryCollection articles={business.articles} name={business.name} subtitle="Samsung specialist business newsroom" onOpen={onOpen} />
    </>}

    {page.kind === 'regional' && regionalDesk && <>
      <BackTrail page={regionalDesk.name} onHome={openHome} onRegion={openRegion} region={coverage.regions.find((r) => r.source === regionalDesk.region)} />
      <StoryCollection articles={regionalDesk.articles} name={regionalDesk.name} subtitle="Regional Samsung newsroom" onOpen={onOpen} />
    </>}

    {page.kind === 'all' && <>
      <BackTrail page="Combined Global feed" onHome={openHome} />
      <StoryCollection articles={coverage.all} name="Combined Samsung Global" subtitle="Coverage from every Global newsroom in the current briefing" onOpen={onOpen} />
    </>}

    <p className="swe-coverage-note"><Icon name="clock" size={13} />
      {coverageComplete
        ? 'Coverage reflects all currently retained Samsung Global briefing stories. Markets without recent coverage remain available in the directory.'
        : 'Showing only the Global stories currently loaded. Update the Samsung feed endpoint to retrieve all retained articles.'}
    </p>
  </section>;
}
