import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  isSamsungSignal,
  rankTrending,
  resolveInternalImage,
  signalScope,
  splitByScope,
} from '../news-scrapper/internal/samsungInternalModel.js';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';

function imageOf(item) {
  return resolveInternalImage(item) || item?.image_url || item?.top_image || '';
}

function SamparkSamsungDossier({ item, onClose }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  const image = imageOf(item);
  const title = item.title || 'Samsung signal';
  const source = item.source || item.src || 'Samsung';
  const link = item.link || item.url || '';
  const summary = item.summary || item.master_summary || item.snippet || '';
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-samsung-dossier-title" aria-modal="true" className="sampark-dossier sampark-dossier--large" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'Samsung'} · {source} · {item.date || item.published_at || 'Latest'}</div>
            <div className="sampark-dossier-subtitle">{signalScope(item)} · {item.source_count || 1} source{(item.source_count||1)===1?'':'s'}</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {image ? <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={image} /></div> : <div className="sampark-dossier-media is-placeholder"><Icon name="layers" size={42} /></div>}
          <div className="sampark-dossier-body">
            <h2 id="sampark-samsung-dossier-title" className="sampark-dossier-title">{title}</h2>
            {summary && <p className="sampark-dossier-summary">{summary}</p>}
            {item.keywords?.length ? <div className="sampark-dossier-keywords">{item.keywords.slice(0,8).map((kw)=><span key={kw} className="sampark-keyword">{kw}</span>)}</div> : null}
            {link ? <a className="sampark-dossier-link" href={link} rel="noreferrer" target="_blank">Open original source <Icon name="external" size={14} /></a> : null}
          </div>
        </div>
        <footer className="sampark-dossier-actions">
          <span className="sampark-dossier-spacer" />
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
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

export default function SamparkSamsungNews() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('internal');
  const [channels, setChannels] = useState({ global: [], local: [], inside: [] });
  const [published, setPublished] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishedError, setPublishedError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [openArticle, setOpenArticle] = useState(null);

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
    // published stories as colleague stories
    const colleagueStories = published.filter((r)=> (r.contentType==='story' || r.contentType==='document_import') && r.status==='published');
    // announcements not used here directly
    return { leadership, global, local, inside, colleagueStories };
  }, [channels, published]);

  const selected = useMemo(()=>{
    if (tab==='global') return model.global;
    if (tab==='local') return model.local;
    // internal: combine inside signals + colleague stories (as articles)
    const storiesAsSignals = model.colleagueStories.map((r)=>({
      title: r.title,
      summary: r.summary || r.body || '',
      category: r.category || 'Internal',
      source: r.author || r.ownerName || 'Samsung Internal',
      src: r.author || 'Samsung Internal',
      date: r.publishedAt ? String(r.publishedAt).slice(0,10) : 'Latest',
      published_at: r.publishedAt,
      source_count: 1,
      image_url: r.cover?.url || '',
      top_image: r.cover?.url || '',
      link: '',
      _publishedId: r.id,
      _isStory: true,
    }));
    return [...model.inside, ...storiesAsSignals].sort((a,b)=> (b.published_at||b.date||'').localeCompare(a.published_at||a.date||''));
  }, [tab, model]);

  const stream = useMemo(()=> selected.slice(0,8), [selected]);

  if (loading) return <div className="sampark-samsung-page"><div className="sampark-samsung-loading" role="status"><span className="sampark-spinner" /> Opening Samsung News…</div></div>;
  if (error) return <div className="sampark-samsung-page"><div className="sampark-samsung-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="btn-primary" onClick={()=>setRetryKey((k)=>k+1)} type="button">Retry</button></div></div>;

  const leadership = tab==='internal' ? model.leadership : null;

  return (
    <div className="sampark-samsung-page">
      {publishedError && <div className="sampark-samsung-notice" role="alert"><Icon name="warning" size={14} /> {publishedError}</div>}

      <nav aria-label="Samsung News channels" className="sampark-samsung-tabs">
        {CHANNELS.map((ch)=>(
          <button key={ch.id} aria-pressed={tab===ch.id} className={`sampark-samsung-tab${tab===ch.id ? ' is-active' : ''}`} onClick={()=>setTab(ch.id)} type="button">{ch.label} <small>· {ch.id==='internal' ? model.inside.length + model.colleagueStories.length : ch.id==='local' ? model.local.length : model.global.length}</small></button>
        ))}
      </nav>

      {leadership && (
        <LeadershipCard record={leadership} onOpen={()=> setOpenArticle({ title: leadership.title, summary: leadership.summary || leadership.body || '', category: leadership.category || 'Leadership', source: leadership.author || 'Leadership', date: leadership.publishedAt ? String(leadership.publishedAt).slice(0,10) : 'Latest', image_url: coverUrl(leadership), link: '', _leadership: true })} />
      )}

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

      <section className="sampark-samsung-latest" aria-labelledby="sampark-samsung-latest-title">
        <header><h3 id="sampark-samsung-latest-title">{tab==='internal' ? 'SRI-D News' : tab==='local' ? 'Local Samsung News' : 'Global Samsung News'} <span className="sampark-samsung-count">({selected.length} News)</span></h3><span className="sampark-samsung-hint">Tap a card to open the dossier</span></header>
        {selected.length ? (
          <div className="sampark-samsung-latest-scroll">
            {selected.map((it)=>(
              <SamparkSamsungTile key={it.title + (it.date||'') + (it._publishedId||'')} item={it} onOpen={(item)=> setOpenArticle(item)} />
            ))}
          </div>
        ) : <div className="sampark-empty"><Icon name="inbox" size={20} /><p>Nothing in {tab} yet. The next unified archive run may bring fresh Samsung coverage.</p></div>}
      </section>

      {tab==='internal' && (
        <div className="sampark-samsung-contribute">
          <button className="btn-secondary" onClick={()=> navigate('/create')} type="button"><Icon name="plus" size={14} /> Contribute a story</button>
        </div>
      )}

      <SamparkSamsungDossier item={openArticle} onClose={()=>setOpenArticle(null)} />
    </div>
  );
}
