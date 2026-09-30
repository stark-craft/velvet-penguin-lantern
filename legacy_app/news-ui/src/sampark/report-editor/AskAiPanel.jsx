import React, { useEffect, useState } from 'react';
import { reportRequest } from './reportApi.js';
import { quotaClock, safeUrl } from './reportModel.js';

export default function AskAiPanel({quota, setQuota, getContext, selection, onApply, onClose, onBusy}) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now()/1000);
  const [scope, setScope] = useState(selection ? 'selection' : 'report');
  const clock = quotaClock(quota, now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()/1000),1000); return ()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if (quota && !quota.remaining && !clock.seconds) reportRequest('/status').then(data=>setQuota(data.quota)).catch(e=>setError(e.message));
  },[quota?.reset_at, clock.seconds === 0]);
  async function ask(event) {
    event.preventDefault(); if(busy || !question.trim()) return;
    setBusy(true); onBusy(true); setError(''); setResult(null);
    try {
      const data = await reportRequest('/ask',{question:question.trim(),context:(scope==='selection'?selection:getContext()).slice(0,30000),request_id:crypto.randomUUID()});
      setQuota(data.quota); setResult(data);
    } catch(e) {
      setError(e.message);
      if(e.quota) setQuota(e.quota);
      else reportRequest('/status').then(data=>setQuota(data.quota)).catch(()=>{});
    } finally {setBusy(false); onBusy(false);}
  }
  return <aside className="sampark-report-panel" aria-label="Ask AI">
    <div className="sampark-report-panel-head"><strong>Ask AI</strong><button disabled={busy} onClick={onClose} aria-label="Close Ask AI">×</button></div>
    <p>Samsung Web Search + Chat · one question uses one request.</p>
    <p className="sampark-report-quota">{quota ? `${clock.remaining} of 2 questions remaining` : 'Checking allowance…'}{quota && !clock.remaining && <><br/>Available {new Date(quota.reset_at*1000).toLocaleString()}<br/>{Math.floor(clock.seconds/3600)}h {Math.floor(clock.seconds%3600/60)}m {clock.seconds%60}s</>}</p>
    <form onSubmit={ask}>
      <label>Context<select value={scope} onChange={e=>setScope(e.target.value)} disabled={busy}><option value="report">Whole report</option><option value="selection" disabled={!selection}>Selected passage</option></select></label>
      <label>Your question<textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={2000} placeholder="Compare these developments and explain the implications for Samsung…" disabled={busy}/></label>
      <button className="sampark-report-primary" disabled={busy || !quota?.remaining || !question.trim()}>{busy ? 'Searching and thinking…' : 'Ask AI'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div className="sampark-report-answer"><h3>Answer</h3><p>{result.answer}</p>{result.replacement && <><h3>Proposed passage</h3><p>{result.replacement}</p><button className="sampark-report-primary" onClick={()=>onApply(result.replacement, scope==='selection')}>{scope==='selection' ? 'Replace selected passage' : 'Insert at cursor'}</button></>}
      {!!result.sources?.length && <><h3>Evidence</h3><ul>{result.sources.map((s,i)=><li key={i}><a href={safeUrl(s.url || s.link)} target="_blank" rel="noopener noreferrer">{s.title || s.url || s.link}</a></li>)}</ul></>}
      <small>Review the wording and evidence before applying.</small></div>}
  </aside>;
}
