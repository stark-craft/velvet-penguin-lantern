import React, { useEffect, useState } from 'react';
import { reportRequest } from './reportApi.js';
import { quotaClock } from './reportModel.js';
import { impactContext } from './reportImpact.js';

export default function SamsungImpactPanel({getArticles, quota, setQuota, onApply, onClose, onBusy}) {
  const [articles] = useState(getArticles);
  const [index,setIndex] = useState('0');
  const [result,setResult] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [now,setNow] = useState(Date.now()/1000);
  const clock=quotaClock(quota,now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()/1000),1000);return ()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(quota && !quota.remaining && !clock.seconds)reportRequest('/status').then(data=>setQuota(data.quota)).catch(e=>setError(e.message));
  },[quota?.reset_at,clock.seconds===0]);
  async function generate() {
    const item=articles[Number(index)];if(busy)return;
    if(!item?.body.isConnected){setError('This article section was removed. Reopen Samsung impact to refresh the article list.');return;}
    const target={...item,before:item.body.innerHTML,context:impactContext(item)};
    setBusy(true);onBusy(true);setError('');setResult(null);
    try {
      const data=await reportRequest('/ask',{
        purpose:'samsung-impact',question:'Explain why this article matters to Samsung in depth.',
        context:target.context,request_id:crypto.randomUUID(),
      });
      setQuota(data.quota);setResult({text:data.replacement,target});
    } catch(e) {
      setError(e.message);
      if(e.quota)setQuota(e.quota);
      else reportRequest('/status').then(data=>setQuota(data.quota)).catch(()=>{});
    } finally {setBusy(false);onBusy(false);}
  }
  return <aside className="sampark-report-panel" aria-label="Samsung impact">
    <div className="sampark-report-panel-head"><strong>Why this matters to Samsung</strong><button disabled={busy} onClick={onClose} aria-label="Close Samsung impact">×</button></div>
    <p>Go deeper with Samsung Chat: business impact, opportunities, risks, relevant teams and next steps.</p>
    <p className="sampark-report-quota">{quota ? `${clock.remaining} of 2 requests remaining` : 'Checking allowance…'}<small>Shared with Ask AI · two requests per six hours.</small>{quota && !clock.remaining && <><br/>Available {new Date(quota.reset_at*1000).toLocaleString()}<br/>{Math.floor(clock.seconds/3600)}h {Math.floor(clock.seconds%3600/60)}m {clock.seconds%60}s</>}</p>
    <label>Article<select aria-label="Article for Samsung impact" value={index} disabled={busy} onChange={e=>{setIndex(e.target.value);setResult(null);setError('');}}>{articles.map((a,i)=><option key={i} value={String(i)}>{a.title}</option>)}</select></label>
    <button className="sampark-report-primary" onClick={generate} disabled={busy || !quota?.remaining || !articles.length}>{busy ? 'Samsung Chat is writing…' : 'Generate detailed analysis'}</button>
    <small>Uses the article’s current text. Review the proposed analysis before adding it.</small>
    {error && <p role="alert">{error}</p>}
    {result && <div className="sampark-report-answer"><h3>Proposed analysis</h3><p>{result.text}</p><button className="sampark-report-primary" onClick={()=>{if(onApply(result.text,result.target))setResult(null);}}>Apply to this article</button><small>Replaces only this article’s Samsung impact section. You can edit it and undo afterwards.</small></div>}
  </aside>;
}
