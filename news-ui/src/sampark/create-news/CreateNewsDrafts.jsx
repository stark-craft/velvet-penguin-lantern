import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';

export default function CreateNewsDrafts({ actingId, confirmDeleteId, items, onBack, onDelete, onEdit, onMore, onWithdraw, remaining }) {
  return (
    <section className="sampark-create-drafts" aria-label="Your drafts and submissions">
      <button className="sampark-create-text-back" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Create News</button>
      <header className="sampark-create-intro is-compact"><span className="sampark-create-eyebrow">Your work</span><h1>Drafts and submissions</h1><p>Continue editable work or check the status of something you already submitted.</p></header>
      {items.length ? <div className="sampark-create-draft-list">{items.map((item) => {
        const editable = ['draft', 'ready', 'needs_changes', 'withdrawn'].includes(item.status);
        const busy = actingId === item.id;
        return (
          <article key={item.id} className="sampark-create-draft-row">
            <div><span className={`sampark-create-status is-${item.status}`}>{String(item.status || 'draft').replace('_', ' ')}</span><strong>{item.title || 'Untitled draft'}</strong><small>{item.contentType || 'story'} · {item.category || 'General'}{item.updatedAt ? ` · ${String(item.updatedAt).slice(0, 10)}` : ''}</small>{item.status === 'needs_changes' && item.reviewNote && <p>Reviewer: {item.reviewNote}</p>}</div>
            <div>
              {editable && <button className="sampark-create-secondary" disabled={busy} onClick={() => onEdit(item)} type="button">{item.status === 'needs_changes' ? 'Revise' : 'Edit'}</button>}
              {item.status === 'submitted' && <button className="sampark-create-secondary" disabled={busy} onClick={() => onWithdraw(item.id)} type="button">{busy ? 'Working…' : 'Withdraw'}</button>}
              {item.status === 'published' && <Link className="sampark-create-secondary" to={`/samsung-news?focus=${encodeURIComponent(item.id)}`}>View live</Link>}
              {['draft', 'ready', 'withdrawn'].includes(item.status) && <button className="sampark-create-link-danger" disabled={busy} onClick={() => onDelete(item.id)} type="button">{confirmDeleteId === item.id ? 'Confirm delete' : 'Delete'}</button>}
            </div>
          </article>
        );
      })}</div> : <div className="sampark-create-empty"><Icon name="archive" size={28} /><strong>No drafts yet</strong><p>Your saved and submitted work will appear here.</p></div>}
      {remaining > 0 && <button className="sampark-create-secondary sampark-create-more" onClick={onMore} type="button">Show more ({remaining} remaining)</button>}
    </section>
  );
}
