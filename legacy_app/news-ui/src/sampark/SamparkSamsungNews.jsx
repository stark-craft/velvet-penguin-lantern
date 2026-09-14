import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  getLatestBriefing,
  getPublishedInternalContent,
  getSamsungInternalFeed,
  getSharedBriefing,
} from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import {
  activeLeadership,
  buildHeroSlides,
  coverUrl,
  findPublishedFocusRecord,
  isSamsungSignal,
  rankTrending,
  resolveInternalImage,
  splitByScope,
} from '../news-scrapper/internal/samsungInternalModel.js';
import ArticleModal from '../news-scrapper/components/modals/ArticleModal.jsx';
import { useArticleEngagement } from './shared/useArticleEngagement.js';

function imageOf(item) {
  return resolveInternalImage(item) || item?.image_url || item?.top_image || '';
}

function SamparkSamsungDossier({ item, onClose }) {
  const engagement = useArticleEngagement(item || {}, { surface: 'samsung_news' });
  const handleClose = () => { engagement.onDossierClose(); onClose(); };
  const articleId = item ? (item.canonical_link || item.link || item.url || item.id || item.title || '') : '';
  React.useEffect(()=>{ if(item && articleId) engagement.onDossierOpen(item); }, [articleId]);
  if (!item) return null;
  return (
    <ArticleModal
      item={item}
      onClose={handleClose}
      onSourceOpen={() => engagement.onSourceOpen()}
    />
  );
}

function LeadershipCard({ record, onOpen }) {
  const img = coverUrl(record);
  return (
    <section className="sampark-samsung-leadership">
      <div className="sampark-samsung-leadership-copy">
        <span className="sampark-samsung-kicker">Samsung Research Institute Delhi</span>
        <h2>{record.title}</h2>
        <p>{String(record.summary || record.body || '').slice(0, 260)}</p>
        <button className="btn-primary" onClick={onOpen} type="button">Read message</button>
      </div>
      <div className="sampark-samsung-leadership-media" aria-hidden="true">
        {img ? <img alt="" src={img} style={{ objectFit: 'contain', width: '100%', height: '100%' }} /> : <Icon name="layers" size={48} />}
      </div>
    </section>
  );
}

function SamparkSamsungTile({ item, onOpen }) {
  const img = imageOf(item);
  return (
    <article className="sampark-samsung-latest-card">
      <button className="sampark-samsung-latest-media" onClick={() => onOpen(item)} style={img ? { backgroundImage: `url("${img}")` } : undefined} type="button" aria-label={`Open ${item.title}`}>
        {!img && <Icon name="layers" size={24} />}
      </button>
      <div className="sampark-samsung-latest-tags">{item.source || item.src || 'Samsung'} | {item.category || 'Samsung News'}</div>
      <button className="sampark-samsung-latest-title" onClick={() => onOpen(item)} type="button">{item.title}</button>
    </article>
  );
}

const CHANNELS = [
  { id: 'internal', label: 'SRI-D' },
  { id: 'local', label: 'Local' },
  { id: 'global', label: 'Global' },
];

// Samsung News uses shared engagement contract: dossier_open, dossier_dwell >=5000, source_open, pause while document.visibilityState hidden, avoid duplicate, not training Gatekeeper
export default function SamparkSamsungNews() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState('internal');
  const [channels, setChannels] = useState({ global: [], local: [], inside: [] });
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishedError, setPublishedError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [openArticle, setOpenArticle] = useState(null);
  const [focusMissed, setFocusMissed] = useState('');
  const handledFocusRef = React.useRef('');

  useEffect(() => {
    let cancelled=false;
    setLoading(true);
    setError('');
    setPublishedError('');
    Promise.all([
      getSamsungInternalFeed(100).catch(async ()=>{
        const briefingData = await getSharedBriefing().catch(()=> getLatestBriefing());
        const all = normalizeList(briefingData?.result || briefingData?.results || briefingData?.articles || briefingData || []).filter(isSamsungSignal);
        return splitByScope(all);
      }),
      getPublishedInternalContent().then((recs)=>({ recs, err: '' })).catch((e)=>({ recs: [], err: e?.message || 'Published could not be verified.' })),
    ]).then(([feed, pubRes])=>{
      if(cancelled) return;
      const normalize = (items, ch) => normalizeList(items||[]).map((it)=>({ ...it, image_url: imageOf(it), samsung_internal_channel: ch }));
      setChannels({
        global: normalize(feed?.global || [], 'global'),
        local: normalize(feed?.local || [], 'local'),
        inside: normalize(feed?.sampark || feed?.inside || [], 'inside'),
      });
      if (pubRes.recs) setPublished(pubRes.recs);
      setPublishedError(pubRes.err);
    }).catch((e)=>{ if(!cancelled) setError(e?.message || 'Samsung News could not be loaded.'); })
      .finally(()=>{ if(!cancelled) setLoading(false); });
    return ()=>{ cancelled=true; };
  }, [retryKey]);

  const model = useMemo(()=>{
    const leadership = activeLeadership(published);
    const global = rankTrending(channels.global);
    const local = rankTrending(channels.local);
    const inside = rankTrending(channels.inside);
    // Normalized published shapes: retain full body separate from summary.
    const colleagueStories = published.filter((r)=> (r.contentType==='story' || r.contentType==='document_import') && r.status==='published');
    const announcements = published.filter((r)=> r.contentType==='announcement' && r.status==='published');
    return { leadership, global, local, inside, colleagueStories, announcements };
  }, [channels, published]);

  const toSignal = (r)=>({
    title: r.title,
    summary: r.summary || '',
    body: r.body || '',
    category: r.category || 'Internal',
    contentType: r.contentType || '',
    source: r.author || r.ownerName || 'Samsung Internal',
    src: r.author || 'Samsung Internal',
    author: r.author || r.ownerName || '',
    team: r.team || '',
    date: r.publishedAt ? String(r.publishedAt).slice(0,10) : 'Latest',
    published_at: r.publishedAt,
    source_count: 1,
    image_url: r.cover?.url || '',
    top_image: r.cover?.url || '',
    link: '',
    url: '',
    id: r.id,
    canonical_link: `internal://${r.id}`,
    _publishedId: r.id,
    _isStory: true,
    audiences: ['all'],
  });

  const selected = useMemo(()=>{
    if (tab==='global') return model.global;
    if (tab==='local') return model.local;
    // internal: combine inside signals + colleague stories (as articles)
    const storiesAsSignals = model.colleagueStories.map(toSignal);
    return [...model.inside, ...storiesAsSignals].sort((a,b)=> (b.published_at||b.date||'').localeCompare(a.published_at||a.date||''));
  }, [tab, model]);

  const announcementSignals = useMemo(()=> model.announcements.map(toSignal), [model]);
  const leadershipSignal = useMemo(()=> (model.leadership ? toSignal(model.leadership) : null), [model]);
  const sridCount = model.inside.length + model.colleagueStories.length + model.announcements.length + (model.leadership ? 1 : 0);

  // Direct linking: /samsung-news?focus=<recordId> opens the exact public item
  // across every surfaced contribution type (story, document import,
  // announcement, leadership) plus internal briefing signals by fallback id.
  // An unresolvable focus after loading shows one inline message instead of
  // silently ignoring the parameter. Never exposes archived/private records:
  // only currently published or visible channel items can resolve.
  useEffect(()=>{
    const params = new URLSearchParams(location.search || '');
    const focus = params.get('focus');
    if (!focus || openArticle || handledFocusRef.current === `${location.search}`) return;
    if (loading) return;
    const match = findPublishedFocusRecord(published, focus);
    if (match) {
      setFocusMissed('');
      handledFocusRef.current = `${location.search}`;
      if (tab !== 'internal') setTab('internal');
      setOpenArticle(toSignal(match));
      return;
    }
    const signal = [...model.inside, ...model.global, ...model.local].find((s)=> String(s.id || s.canonical_link || s.link || s.title)===String(focus));
    if (signal) {
      setFocusMissed('');
      handledFocusRef.current = `${location.search}`;
      setOpenArticle(signal);
      return;
    }
    // Data finished loading and nothing public matches: explain once.
    setFocusMissed(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, loading, model.colleagueStories, model.announcements, model.leadership, published]);

  const stream = useMemo(()=> selected.slice(0,8), [selected]);

  if (loading) return <div className="sampark-samsung-page"><div className="sampark-samsung-loading" role="status"><span className="sampark-spinner" /> Opening Samsung News…</div></div>;
  if (error) return <div className="sampark-samsung-page"><div className="sampark-samsung-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="btn-primary" onClick={()=>setRetryKey((k)=>k+1)} type="button">Retry</button></div></div>;

  const leadership = tab==='internal' ? model.leadership : null;

  return (
    <div className="sampark-samsung-page">
      {publishedError && <div className="sampark-samsung-notice" role="alert"><Icon name="warning" size={14} /> {publishedError}</div>}
      {focusMissed && !loading && (
        <div className="sampark-samsung-notice" role="status">
          <Icon name="warning" size={14} /> This item is no longer published or is unavailable.
          {' '}<button className="btn-secondary" onClick={() => { setFocusMissed(''); navigate('/samsung-news'); }} type="button">Return to Samsung News</button>
        </div>
      )}

      <nav aria-label="Samsung News channels" className="sampark-samsung-tabs">
        {CHANNELS.map((ch)=>(
          <button key={ch.id} aria-pressed={tab===ch.id} className={`sampark-samsung-tab${tab===ch.id ? ' is-active' : ''}`} onClick={()=>setTab(ch.id)} type="button">{ch.label} <small>· {ch.id==='internal' ? sridCount : ch.id==='local' ? model.local.length : model.global.length}</small></button>
        ))}
      </nav>

      {leadership && leadershipSignal && (
        <LeadershipCard record={leadership} onOpen={()=> setOpenArticle(leadershipSignal)} />
      )}

      {selected.length === 0 ? (
        <div className="sampark-empty sampark-samsung-empty-channel" role="status"><Icon name="inbox" size={20} /><p>No regular stories in this channel right now. New coverage arrives with the next briefing run.</p></div>
      ) : (
      <div className="sampark-samsung-hero">
        <section className="sampark-samsung-featured" aria-label="Featured Samsung News">
          {selected[0] ? (
            <button className="sampark-samsung-featured-media" onClick={()=> setOpenArticle(selected[0])} style={imageOf(selected[0]) ? { backgroundImage: `url("${imageOf(selected[0])}")` } : undefined} type="button">
              <div className="sampark-samsung-featured-overlay">
                <span className="sampark-samsung-featured-kicker">{selected[0].source || selected[0].src || 'Samsung'} · {selected[0].date || 'Latest'}</span>
                <h3>{selected[0].title}</h3>
                <small>{selected[0].summary ? String(selected[0].summary).slice(0,120) : ''}</small>
              </div>
            </button>
          ) : <div className="sampark-empty"><Icon name="inbox" size={22} /><p>The next Samsung edition is being prepared.</p></div>}
        </section>
        <aside className="sampark-samsung-stream" aria-label="Briefing Stream">
          <h3>Briefing Stream</h3>
          <div className="sampark-samsung-stream-list">
            {stream.length ? stream.map((it)=>(
              <button key={it.title + it.date} className="sampark-samsung-stream-item" onClick={()=> setOpenArticle(it)} type="button">
                <span className="sampark-samsung-stream-category">{it.category || 'Samsung'}</span>
                <strong>{it.title}</strong>
                <small>{it.source || it.src || 'Samsung'} | {it.date || 'Latest'}</small>
              </button>
            )) : <p className="sampark-samsung-empty">No stream items in this channel.</p>}
          </div>
        </aside>
      </div>
      )}

      {selected.length > 0 && (
      <section className="sampark-samsung-latest" aria-labelledby="sampark-samsung-latest-title">
        <header><h3 id="sampark-samsung-latest-title">{tab==='internal' ? 'SRI-D News' : tab==='local' ? 'Local Samsung News' : 'Global Samsung News'} <span className="sampark-samsung-count">({selected.length} News)</span></h3><span className="sampark-samsung-hint">Tap a card to open the dossier</span></header>
        <div className="sampark-samsung-latest-scroll">
          {selected.map((it)=>(
            <SamparkSamsungTile key={it.title + (it.date||'') + (it._publishedId||'')} item={it} onOpen={(item)=> setOpenArticle(item)} />
          ))}
        </div>
      </section>
      )}

      {tab==='internal' && announcementSignals.length > 0 && (
        <section className="sampark-samsung-latest" aria-labelledby="sampark-samsung-announcements-title">
          <header><h3 id="sampark-samsung-announcements-title">Announcements <span className="sampark-samsung-count">({announcementSignals.length})</span></h3><span className="sampark-samsung-hint">Notices from colleagues</span></header>
          <div className="sampark-samsung-latest-scroll">
            {announcementSignals.map((it)=>(
              <SamparkSamsungTile key={`ann-${it.id}`} item={it} onOpen={(item)=> setOpenArticle(item)} />
            ))}
          </div>
        </section>
      )}

      {tab==='internal' && (
        <div className="sampark-samsung-contribute">
          <button className="btn-secondary" onClick={()=> navigate('/create')} type="button"><Icon name="plus" size={14} /> Contribute a story</button>
        </div>
      )}

      <SamparkSamsungDossier item={openArticle} onClose={()=>setOpenArticle(null)} />
    </div>
  );
}
