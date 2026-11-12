import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { TEAM_DIRECTORY } from '../news-scrapper/data/teamDirectory.js';
import { fetchWithTimeout } from '../shared/api/requestTimeout.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

const VOC_TIMEOUT_MS = 30000;

function SamparkVocForm({ onComplete }) {
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(4);
  const [focus, setFocus] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim() || !focus.trim()) { setError('Message and focus are required.'); return; }
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetchWithTimeout('/voc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message.trim(), rating, focus, category: focus, page: window.location.pathname, surface: 'sampark-voc', timestamp: new Date().toISOString() }) }, VOC_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Submission failed');
      setMessage('');
      onComplete?.(data);
    } catch (err) {
      setError(err?.name === 'RequestTimeoutError' || /took longer|timed out|timeout/i.test(err?.message || '') ? 'The request timed out. Please try again.' : err.message || 'Could not submit');
    }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="sampark-voc-form" style={{ display: 'grid', gap: 12 }}>
      <label><span>Message *</span><textarea value={message} onChange={e=> setMessage(e.target.value)} required maxLength={2000} rows={4} style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} /></label>
      <label><span>Rating *</span><select value={rating} onChange={e=> setRating(Number(e.target.value))} required><option value={1}>1 — Poor</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4 — Good</option><option value={5}>5 — Excellent</option></select></label>
      <label><span>Focus / Category *</span><select value={focus} onChange={e=> setFocus(e.target.value)} required><option value="general">General</option><option value="signal_quality">Signal quality</option><option value="search">Search</option><option value="ux">UX</option><option value="performance">Performance</option></select></label>
      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{error} <button className="btn-secondary" onClick={submit} type="button">Retry</button></p>}
      <button className="btn-primary" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit feedback'}</button>
    </form>
  );
}

export default function SamparkVoc() {
  const [complete, setComplete] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewError, setReviewError] = useState('');
  const [hasReviewAccess, setHasReviewAccess] = useState(false);

  useEffect(() => {
    // Try to load review inbox if authorized (Executive Control / analytics.view)
    fetch('/voc/review', { headers: { 'Content-Type': 'application/json' } }).then(r=> r.json()).then(data=> {
      if (data?.status==='success' && Array.isArray(data.items)) { setReviewItems(data.items); setHasReviewAccess(true); }
    }).catch(()=>{});
  }, []);

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch(`/voc/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Update failed');
      setReviewItems(cur=> cur.map(it=> it.id===id ? { ...it, status } : it));
    } catch(e){ setReviewError(e.message); }
  };

  return (
    <SamparkWorkspaceShell title="VOC — Voice of Customer" description="Customer feedback, trend intelligence and sentiment signals. Feedback submission remains private to your workspace.">
      <section className="sampark-voc-team" aria-label="TechScout team">
        <header className="sampark-voc-team-head">
          <span className="sampark-voc-kicker">Team & Feedback</span>
          <h2>Meet the TechScout Team</h2>
          <p>The people shaping a faster, clearer daily intelligence experience.</p>
        </header>
        <div className="sampark-voc-team-grid">
          {TEAM_DIRECTORY.map((member) => (
            <article key={member.id} className="sampark-voc-member">
              <span className="sampark-voc-avatar" aria-hidden="true">{member.initials}</span>
              <div>
                <small>TechScout team</small>
                <h3>{member.name}</h3>
                <strong>{member.role}</strong>
                <p>{member.note}</p>
              </div>
              <Icon name="sparkle" size={18} />
            </article>
          ))}
        </div>
      </section>

      <div className="sampark-voc-grid">
        <div className="sampark-voc-card">
          <span className="sampark-voc-kicker">Voice of Customer</span>
          <h3>Share Feedback</h3>
          <p>Your message, rating, and focus are stored privately for your workspace.</p>
          {complete ? (
            <div className="sampark-voc-success" role="status" data-testid="voc-receipt-parent">
              <strong>Feedback captured{receiptId ? ` — receipt ${receiptId}`: ''}.</strong>
              <p>Thank you for improving TechScout.</p>
              <p>Your receipt remains visible until you send another note.</p>
              <button className="btn-secondary" onClick={() => { setComplete(false); setReceiptId(''); }} type="button">Send another note</button>
            </div>
          ) : (
            <div className="sampark-voc-form">
              <SamparkVocForm onComplete={(data)=>{ setComplete(true); setReceiptId(data?.receipt_id || data?.item?.id || ''); }} />
            </div>
          )}
        </div>
        <div className="sampark-voc-card">
          <span className="sampark-voc-kicker">Feedback Themes (real)</span>
          <div className="sampark-voc-themes">
            {(() => {
              const themes = hasReviewAccess ? reviewItems.reduce((acc,it)=>{ const k=String(it.focus||it.type||'general').trim()||'general'; acc[k]=(acc[k]||0)+1; return acc; },{}) : {};
              const entries = Object.entries(themes);
              if(entries.length) return entries.map(([k,v])=> <div key={k} className="sampark-voc-theme">{k} · {v}</div>);
              return <p className="sampark-voc-empty" style={{fontSize:13, color:'var(--muted)'}}>No feedback themes yet — themes will appear from actual submissions.</p>;
            })()}
          </div>
          <p className="sampark-voc-note">Themes are derived from submitted feedback.</p>
        </div>
      </div>

      {hasReviewAccess && (
        <section className="sampark-voc-review" aria-label="VOC Review Inbox" style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <h3>Review inbox ({reviewItems.length}) — Executive Control / analytics.view</h3>
          {reviewError && <p role="alert" style={{ color: '#b91c1c' }}>{reviewError}</p>}
          {reviewItems.length===0 ? <p>No feedback yet.</p> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {reviewItems.slice(0,20).map(it=> (
                <article key={it.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                    <span>{it.timestamp?.slice(0,10)} · {it.page || it.surface || 'unknown'} · {it.focus || it.type} · rating {it.rating ?? '—'}</span>
                    <span>Viewer: {it.viewer_label || it.viewer_ip_hash?.slice(0,8) || 'anon'} · Status: {it.status || 'open'}</span>
                  </div>
                  <p style={{ margin: '6px 0', fontSize: 14 }}>{it.message}</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['open','acknowledged','resolved'].map(s=> <button key={s} disabled={it.status===s} onClick={()=> updateStatus(it.id, s)} className="btn-secondary" type="button">{s}</button>)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </SamparkWorkspaceShell>
  );
}
