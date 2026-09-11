import { useCallback, useEffect, useState } from 'react';
import { getLatestBriefing, getSharedBriefing } from '../../../news-scrapper/api.js';
import { normalizeList } from '../../../news-scrapper/utils/normalize.js';
import { imageOf } from '../allNewsModel.js';

// All News = normal external/shared briefing news feed only.
// Use getSharedBriefing() with fallback to getLatestBriefing(), normalize, derive categories.
// Do NOT merge Samsung Internal/SRI-D data; that belongs to Samsung News.
export default function useBriefingFeed(){
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try{
      const data = await getSharedBriefing().catch(()=> getLatestBriefing());
      const raw = data?.result || data?.results || data?.articles || data || [];
      const normalized = normalizeList(raw).map(it=> ({...it, image_url: imageOf(it)}));
      setArticles(normalized);
    }catch(e){
      setError(e?.message || 'Could not load briefing.');
    }finally{ setLoading(false); }
  },[retryKey]);

  useEffect(()=>{ load(); },[load]);

  const retry = ()=> setRetryKey(k=>k+1);

  return { articles, loading, error, retry };
}
