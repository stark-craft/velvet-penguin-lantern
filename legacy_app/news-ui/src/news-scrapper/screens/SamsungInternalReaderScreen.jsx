import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { getPublishedInternalRecord } from '../api.js';
import { coverUrl } from '../internal/samsungInternalModel.js';
import '../styles/samsung-internal.css';

function dateLabel(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
}

function paragraphs(value) {
  return String(value || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

export default function SamsungInternalReaderScreen({ kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    getPublishedInternalRecord(id).then((result) => {
      if (cancelled) return;
      const actual = result?.contentType;
      const allowed = kind === 'announcement'
        ? actual === 'announcement'
        : kind === 'leadership'
          ? actual === 'leadership'
          : actual === 'story' || actual === 'document_import';
      if (!allowed) throw new Error('This published record does not belong to this reader.');
      setRecord(result);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError?.message || 'This published message is unavailable.');
    });
    return () => { cancelled = true; };
  }, [id, kind]);
  const goBack = () => navigate('/samsung-internal', { state: { restore: true } });
  if (error) return <main className="sni-reader-page"><button className="sni-reader-back" onClick={goBack} type="button"><Icon name="chevL" size={15} /> Back to Samsung Internal</button><div className="sni-state sni-state-error" role="alert"><Icon name="warning" size={22} /><h1>Message unavailable</h1><p>{error}</p></div></main>;
  if (!record) return <main className="sni-reader-page"><div className="sni-state" role="status"><span className="sni-loader" /><h1>Opening the published message…</h1></div></main>;
  const image = coverUrl(record);
  const isAnnouncement = kind === 'announcement';
  const isLeadership = kind === 'leadership';
  return (
    <main className={`sni-reader-page${isAnnouncement ? ' is-announcement' : isLeadership ? ' is-leadership' : ' is-story'}`}>
      <button className="sni-reader-back" onClick={goBack} type="button"><Icon name="chevL" size={15} /> Back to Samsung Internal</button>
      <article className="sni-reader-shell">
        <header className="sni-reader-hero">
          <div className="sni-reader-hero-copy">
            <span>{isAnnouncement ? 'Company announcement' : isLeadership ? 'From the MD’s desk' : 'Inside Samsung · Colleague story'}</span>
            <h1>{record.title || (isAnnouncement ? 'Company announcement' : isLeadership ? 'Leadership message' : 'Colleague story')}</h1>
            {record.summary && <p>{record.summary}</p>}
            <div><span>{record.author || 'Samsung Internal desk'}</span>{record.category && <span>{record.category}</span>}{record.publishedAt && <time>{dateLabel(record.publishedAt)}</time>}</div>
          </div>
          {image && <figure><img alt="" onError={(event) => { event.currentTarget.closest('figure')?.remove(); }} src={image} /></figure>}
        </header>
        <section className="sni-reader-body"><span>{isAnnouncement ? 'Full notice' : isLeadership ? 'Full message' : 'Full story'}</span>{paragraphs(record.body || record.summary).map((paragraph, index) => <p key={`${paragraph.slice(0, 30)}-${index}`}>{paragraph}</p>)}</section>
      </article>
    </main>
  );
}
