import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import useModalFocus from './modals/useModalFocus.js';
import {
  getInternalReviewQueue,
  unlockInternalReview,
  lockInternalReview,
  publishInternalContent,
  requestInternalContentChanges,
  rejectInternalContent,
} from '../api.js';
import { LeadershipCarouselPresentation } from './personal-desk/LeadershipCarouselPreview.jsx';
import '../styles/review-contributions.css';

function groupItems(list) {
  const leadership = list.filter((entry) => entry.content_type === 'leadership');
  const announcements = list.filter((entry) => entry.content_type === 'announcement');
  const others = list.filter(
    (entry) => entry.content_type !== 'leadership' && entry.content_type !== 'announcement',
  );
  return { leadership, announcements, others };
}

// Cover images are private; the editor session cookie authorizes them, so a
// plain <img> works once unlocked. A missing cover falls back to a monogram.
function CoverImage({ record, className = 'crc-cover' }) {
  const [failed, setFailed] = useState(false);
  const src = record.cover
    ? `/internal-content/${record.id}/cover?v=${encodeURIComponent(record.updated_at || '')}`
    : '';
  if (!src || failed) {
    return (
      <div className={className}>
        <span aria-hidden="true" className="crc-monogram"><Icon name="note" size={20} /></span>
      </div>
    );
  }
  return (
    <div className={className}>
      <img alt="" onError={() => setFailed(true)} src={src} />
    </div>
  );
}

function coverSrc(record) {
  return record?.cover
    ? `/internal-content/${record.id}/cover?v=${encodeURIComponent(record.updated_at || '')}`
    : '';
}

// Imported and written copy is plain text: paragraphs are split on blank
// lines and rendered as text nodes. Never HTML — document content is data.
function bodyParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function shortDate(value) {
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function ContributionReviewDesk() {
  const [unlocked, setUnlocked] = useState(null); // null = probing the session
  const [items, setItems] = useState([]);
  const [keyDraft, setKeyDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmReject, setConfirmReject] = useState('');
  const [openRecord, setOpenRecord] = useState(null);
  const [noteText, setNoteText] = useState('');

  const dialogRef = useModalFocus(Boolean(openRecord), () => setOpenRecord(null));

  // Probe an existing cookie session once on mount.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getInternalReviewQueue()
      .then((data) => {
        if (!alive) return;
        setItems(data?.items || []);
        setUnlocked(true);
      })
      .catch(() => {
        if (alive) setUnlocked(false);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Scroll lock while the full review is open.
  useEffect(() => {
    if (!openRecord) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [openRecord]);

  // Every hook must run on every render: the editor-gate below is an early
  // return, so grouping has to be computed before it.
  const groups = useMemo(() => groupItems(items), [items]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getInternalReviewQueue();
      setItems(data?.items || []);
      setUnlocked(true);
    } catch (requestError) {
      setError(requestError?.message || 'Could not load the review desk.');
    } finally {
      setLoading(false);
    }
  };

  const unlock = async (event) => {
    event.preventDefault();
    if (!keyDraft.trim()) return;
    setLoading(true);
    setError('');
    try {
      await unlockInternalReview(keyDraft.trim());
      setKeyDraft('');
      await refresh();
    } catch (requestError) {
      setError(requestError?.message || 'That key was not accepted.');
    } finally {
      setLoading(false);
    }
  };

  const lockDesk = async () => {
    try { await lockInternalReview(); } catch { /* clearing regardless */ }
    setUnlocked(false);
    setItems([]);
    setOpenRecord(null);
    setNotice('');
    setError('');
  };

  const decide = async (record, action, note = '') => {
    if (busyId) return;
    setBusyId(record.id);
    setError('');
    setNotice('');
    try {
      if (action === 'publish') await publishInternalContent(record.id);
      if (action === 'changes') await requestInternalContentChanges(record.id, note);
      if (action === 'reject') await rejectInternalContent(record.id, note);
      setItems((current) => current.filter((entry) => entry.id !== record.id));
      setNotice(
        action === 'publish'
          ? `"${record.title}" is live on Samsung Internal.`
          : action === 'changes'
            ? `Change request sent for "${record.title}".`
            : `"${record.title}" was archived.`,
      );
      setOpenRecord((current) => (current?.id === record.id ? null : current));
      setNoteText('');
      setConfirmReject('');
    } catch (requestError) {
      setError(requestError?.message || 'The decision could not be recorded.');
    } finally {
      setBusyId('');
    }
  };

  if (unlocked === false) {
    return (
      <section aria-label="Contributions review" className="crc-gate">
        <Icon name="shield" size={22} />
        <h2>Editor access required</h2>
        <p>Contributions are private to their authors. Enter the internal editor key to open the review desk. The key stays with the server — nothing is stored in this browser.</p>
        <form onSubmit={unlock}>
          <input
            aria-label="Internal editor key"
            autoComplete="off"
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder="Editor key"
            type="password"
            value={keyDraft}
          />
          <button className="btn-dark-primary" disabled={loading || !keyDraft.trim()} type="submit">
            {loading ? 'Checking…' : 'Unlock review desk'}
          </button>
        </form>
        {error && <p className="crc-feedback" role="alert">{error}</p>}
      </section>
    );
  }

  const metaChips = (record) => (
    <div className="crc-meta">
      <span className="crc-chip">{record.content_type === 'document_import' ? 'Document' : 'Story'}</span>
      {record.category && <span className="crc-chip">{record.category}</span>}
      {record.team && <span className="crc-chip">{record.team}</span>}
      <time>{shortDate(record.submitted_at)}</time>
    </div>
  );

  const decisionButtons = (record, inModal = false) => (
    <div className="crc-actions">
      {!inModal && (
        <button
          className="btn-dark-secondary crc-open-full"
          onClick={() => { setOpenRecord(record); setNoteText(''); }}
          type="button"
        >
          <Icon name="eye" size={14} /> Open full reader
        </button>
      )}
      <button
        aria-busy={busyId === record.id}
        className="btn-dark-primary"
        disabled={Boolean(busyId)}
        onClick={() => decide(record, 'publish')}
        type="button"
      >
        <Icon name="check2" size={14} /> Approve &amp; publish
      </button>
      {!inModal && (
        <button
          className="btn-dark-secondary"
          disabled={Boolean(busyId)}
          onClick={() => { setOpenRecord(record); setNoteText(''); }}
          type="button"
        >
          Request changes
        </button>
      )}
      {confirmReject === record.id ? (
        <button
          aria-busy={busyId === record.id}
          className="btn-dark-secondary crc-reject-confirm"
          disabled={Boolean(busyId)}
          onClick={() => decide(record, 'reject', '')}
          type="button"
        >
          Confirm reject?
        </button>
      ) : (
        <button
          className="btn-dark-secondary"
          disabled={Boolean(busyId)}
          onClick={() => setConfirmReject(record.id)}
          type="button"
        >
          Reject
        </button>
      )}
    </div>
  );

  const renderLeadershipCard = (record) => (
    <article className="crc-leadership-card" key={record.id}>
      <div className="crc-leadership-copy">
        {metaChips(record)}
        <span className="crc-leadership-kicker">From the MD&rsquo;s desk</span>
        <h3>
          <button className="crc-title-link" onClick={() => { setOpenRecord(record); setNoteText(''); }} type="button">
            {record.title}
          </button>
        </h3>
        {record.summary && <p className="crc-summary">&ldquo;{record.summary}&rdquo;</p>}
        <p className="crc-author"><Icon name="eye" size={13} /> {record.author || 'Unnamed author'}</p>
        {decisionButtons(record)}
      </div>
      <CoverImage className="crc-leadership-portrait" record={record} />
    </article>
  );

  const renderReviewCard = (record) => (
    record.content_type === 'leadership' ? renderLeadershipCard(record) : <article className="workflow-brief-card crc-card" key={record.id}>
      <CoverImage record={record} />
      <div className="crc-body">
        {metaChips(record)}
        <h3>
          <button className="crc-title-link" onClick={() => { setOpenRecord(record); setNoteText(''); }} type="button">
            {record.title}
          </button>
        </h3>
        {record.summary && <p className="crc-summary">{record.summary}</p>}
        <p className="crc-excerpt">
          {String(record.body || '').slice(0, 220)}
          {String(record.body || '').length > 220 ? '…' : ''}
        </p>
        <footer>
          <span className="crc-author"><Icon name="eye" size={13} /> {record.author || 'Unnamed author'}</span>
          {decisionButtons(record)}
        </footer>
      </div>
    </article>
  );

  return (
    <section aria-label="Contributions review" className="crc-desk">
      <div className="crc-desk-head">
        <div>
          <span className="eyebrow">Submitted by colleagues</span>
          <h2>{items.length ? `${items.length} awaiting a decision` : 'Nothing awaiting a decision'}</h2>
        </div>
        <div className="crc-desk-actions">
          <button className="btn-dark-secondary" disabled={loading} onClick={refresh} type="button">
            <Icon name="refresh" size={14} /> Refresh
          </button>
          <button className="btn-dark-secondary" onClick={lockDesk} type="button">
            <Icon name="shield" size={14} /> Lock
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

      {!items.length && !loading && !error && (
        <div className="workflow-empty">
          <Icon name="inbox" size={26} />
          <h2>The contribution shelf is clear</h2>
          <p>Colleague submissions appear here the moment they submit from their desk.</p>
        </div>
      )}

      {!!items.length && (
        <>
          {!!groups.leadership.length && (
            <div className="crc-group">
              <header className="crc-group-head">
                <span className="crc-chip">Leadership messages</span>
                <small>{groups.leadership.length} · publishing a new vision retires the previous one</small>
              </header>
              <div className="crc-leadership-grid">
                {groups.leadership.map(renderReviewCard)}
              </div>
            </div>
          )}

          {!!groups.announcements.length && (
            <div className="crc-group">
              <header className="crc-group-head">
                <span className="crc-chip">Announcements</span>
                <small>{groups.announcements.length} · published notices stream to the Samsung Internal board</small>
              </header>
              <div className="workflow-card-grid crc-grid">
                {groups.announcements.map(renderReviewCard)}
              </div>
            </div>
          )}

          {!!groups.others.length && (
            <div className="crc-group">
              <header className="crc-group-head">
                <span className="crc-chip">Stories &amp; documents</span>
                <small>{groups.others.length}</small>
              </header>
              <div className="workflow-card-grid crc-grid">
                {groups.others.map(renderReviewCard)}
              </div>
            </div>
          )}
        </>
      )}

      {openRecord && (
        <div className="crc-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setOpenRecord(null); }}>
          <article
            aria-label={`Full review for ${openRecord.title}`}
            aria-modal="true"
            className={`crc-modal${openRecord.content_type === 'leadership' ? ' crc-modal-leadership' : ''}`}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="crc-modal-head">
              {metaChips(openRecord)}
              <button aria-label="Close full review" onClick={() => setOpenRecord(null)} type="button">
                <Icon name="x" size={16} />
              </button>
            </header>

            {openRecord.content_type === 'leadership' ? (
              <>
                <LeadershipCarouselPresentation
                  badge="Review preview"
                  className="crc-leadership-reader-stage"
                  imageSrc={coverSrc(openRecord)}
                  record={openRecord}
                />
                <section className="crc-reader-copy" aria-label="Leadership message body">
                  <span className="eyebrow">Full message</span>
                  <div className="crc-modal-body">
                    {bodyParagraphs(openRecord.body).map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                    {!bodyParagraphs(openRecord.body).length && <p className="crc-empty-body">This submission has no body text yet.</p>}
                  </div>
                </section>
              </>
            ) : (
              <>
                <CoverImage className="crc-modal-cover" record={openRecord} />
                <h2 className="crc-modal-title">{openRecord.title}</h2>
                {openRecord.summary && <p className="crc-modal-lead">{openRecord.summary}</p>}
                <div className="crc-modal-body">
                  {bodyParagraphs(openRecord.body).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {!bodyParagraphs(openRecord.body).length && <p className="crc-empty-body">This submission has no body text yet.</p>}
                </div>
              </>
            )}

            <p className="crc-author"><Icon name="eye" size={13} /> {openRecord.author || 'Unnamed author'}{openRecord.submitted_at ? ` · submitted ${shortDate(openRecord.submitted_at)}` : ''}</p>

            <div className="crc-note-panel">
              <label>
                Change request note for the author
                <textarea
                  aria-label={`Change request note for ${openRecord.title}`}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder="What should change before this can be published? Be specific and kind."
                  rows={5}
                  value={noteText}
                />
              </label>
            </div>

            <footer className="crc-modal-foot">
              {decisionButtons(openRecord, true)}
              <button
                aria-busy={busyId === openRecord.id}
                className="btn-dark-primary"
                disabled={!noteText.trim() || Boolean(busyId)}
                onClick={() => decide(openRecord, 'changes', noteText.trim())}
                type="button"
              >
                Send change request
              </button>
            </footer>
          </article>
        </div>
      )}
    </section>
  );
}
