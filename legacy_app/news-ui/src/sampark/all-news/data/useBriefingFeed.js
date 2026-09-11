import { useCallback, useEffect, useState } from 'react';
import { getLatestBriefing, getPublishedInternalContent, getSharedBriefing } from '../../../news-scrapper/api.js';
import { normalizeList } from '../../../news-scrapper/utils/normalize.js';
import { imageOf } from '../allNewsModel.js';

export default function useBriefingFeed(){
  const [articles, setArticles] = useState([]);
  const [published, setPublished] = useState(null);
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
      try{
        const pub = await getPublishedInternalContent();
        if(Array.isArray(pub) && pub.length) setPublished(pub[0]); else setPublished(null);
      }catch{ setPublished(null); }
    }catch(e){
      setError(e?.message || 'Could not load briefing.');
    }finally{ setLoading(false); }
  },[retryKey]);

  useEffect(()=>{ load(); },[load]);

  const retry = ()=> setRetryKey(k=>k+1);

  return { articles, published, loading, error, retry };
}
