import { matchesBriefingLens, publishedTime, scoreOf } from '../../news-scrapper/utils/intelligence.js';

export function imageOf(item){
  const cands=[item?.image_url,item?.imageUrl,item?.thumbnail_url,item?.og_image,item?.top_image,item?.image,item?.thumbnail];
  const m=cands.find(v=> typeof v==='string' && v.trim() && v.trim()!== '#');
  return m? m.trim() : '';
}

function uniqueSorted(values){
  return [...new Set(values.filter(Boolean))].sort((a,b)=> String(a).localeCompare(String(b)));
}

export function deriveFilterOptions(articles){
  const safe=(articles||[]).filter(Boolean);
  const regions=uniqueSorted(safe.map(a=>a?.region));
  const categories=uniqueSorted(safe.map(a=>a?.category));
  const sources=uniqueSorted(safe.map(a=>a?.src || a?.source));
  const dates=uniqueSorted(safe.map(a=>a?.date)).sort().reverse();
  return { regions, categories, sources, dates };
}

export function matchesCategoryLens(item, lens){
  return matchesBriefingLens(item, lens);
}

// hero ranking: prefer strong/multi-source stories where appropriate, signal/importance, recency, image
export function selectFeatured(articles, limit=5){
  const safe=(articles||[]).filter(Boolean);
  if(!safe.length) return [];
  // sort by source_count, score, image, recency as in original FeedScreen sortForCarousel
  const sorted=[...safe].sort((a,b)=>{
    const cov=(b?.source_count||1)-(a?.source_count||1);
    if(cov) return cov;
    const sc=scoreOf(b)-scoreOf(a);
    if(sc) return sc;
    const img=(b?.image_url?1:0)-(a?.image_url?1:0);
    if(img) return img;
    return publishedTime(b)-publishedTime(a);
  });
  // if personalization applicable, it is already in article ordering via backend; we keep sorted as above
  return sorted.slice(0,limit);
}

export function selectAllNewsRail(articles, limit=10){
  const safe=(articles||[]).filter(Boolean);
  // same briefing data, top 10 appropriate (recency + score)
  const sorted=[...safe].sort((a,b)=> publishedTime(b)-publishedTime(a) || scoreOf(b)-scoreOf(a));
  return sorted.slice(0,limit);
}

// Latest = newest valid publication/archive date present in filtered result set
export function selectLatestToday(articles, todayISO){
  const safe=(articles||[]).filter(Boolean);
  if(!safe.length) return [];
  const valid = [];
  const invalid = [];
  for(const a of safe){
    const raw = String(a?.date || a?.archive_date || '').trim();
    const iso = raw.slice(0,10);
    const parsed = iso ? new Date(iso) : null;
    const isValid = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && parsed && !isNaN(parsed.getTime());
    if(isValid) valid.push({ item: a, iso });
    else invalid.push(a);
  }
  if(!valid.length){
    // no valid date, return empty (or could return invalid after but spec says invalid goes after valid, so for Latest we show no section)
    return [];
  }
  // sort valid by iso descending to find newest
  valid.sort((a,b)=> b.iso.localeCompare(a.iso));
  const latestISO = valid[0].iso;
  const latest = valid.filter(v=> v.iso===latestISO).map(v=> v.item);
  // invalid goes after valid, but Latest section only shows newest valid date, so return only latest valid
  // If todayISO provided and differs, we still use latestISO per spec (not browser UTC)
  return latest;
}

export function applyArticleFilters(articles, filters){
  const safe=(articles||[]).filter(Boolean);
  // filters: {category:'all'|'ai'..., region, source, date }
  // category is lens
  return safe.filter(item=>{
    if(!item) return false;
    if(filters.category && filters.category!=='all' && !matchesCategoryLens(item, filters.category)) return false;
    if(filters.region && filters.region!=='all' && item.region!==filters.region) return false;
    if(filters.source && filters.source!=='all' && (item.src||item.source)!==filters.source) return false;
    if(filters.date && filters.date!=='all' && item.date!==filters.date) return false;
    return true;
  });
}

// day-wise grouping preserving order (already sorted)
export function groupByDatePreservingOrder(articles){
  const safe=(articles||[]).filter(Boolean);
  const map=new Map();
  for(const it of safe){
    if(!it) continue;
    const key=String(it.date||'Unknown').slice(0,10);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  // preserve insertion order which is already publishedTime desc if input sorted
  return [...map.entries()];
}
