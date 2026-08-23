import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import useModalFocus from './modals/useModalFocus.js';
import { getInternalNotifications, markInternalNotificationsRead } from '../api.js';
import '../styles/notifications.css';

const POLL_MS = 30000;

const KIND_ICON = { published: 'check2', changes: 'note', rejected: 'x' };

function relativeTime(value) {
  try {
    const diffMs = Date.now() - new Date(value).getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

// Private per-viewer review notifications. Only the author's hashed viewer
// identity ever receives these events — there is no broadcast surface.
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const controlRef = useRef(null);
  const dialogRef = useModalFocus(open, () => setOpen(false));

  const load = useCallback(async () => {
    try {
      const data = await getInternalNotifications();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // Silent: the bell is passive furniture until the backend answers.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const unread = items.filter((entry) => !entry.read).length;

  const toggle = () => setOpen((current) => !current);

  const markAll = async () => {
    try {
      await markInternalNotificationsRead([]);
      setItems((current) => current.map((entry) => ({ ...entry, read: true })));
    } catch { /* retry on next poll */ }
  };

  const openItem = async (entry) => {
    if (!entry.read) {
      setItems((current) => current.map((item) => (item.id === entry.id ? { ...item, read: true } : item)));
      try { await markInternalNotificationsRead([entry.id]); } catch { /* optimistic */ }
    }
    setOpen(false);
    navigate(entry.kind === 'published' ? '/samsung-internal' : '/saved');
  };

  return (
    <div className="notification-bell-control" ref={controlRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="command-settings-trigger notification-bell-trigger"
        onClick={toggle}
        type="button"
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span aria-hidden="true" className="notification-bell-badge">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          aria-label="Review notifications"
          className="notification-panel"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="notification-panel-head">
            <strong>Review updates</strong>
            {unread > 0 && (
              <button onClick={markAll} type="button">Mark all read</button>
            )}
          </header>
          {!items.length && (
            <p className="notification-empty">
              Nothing yet. When an editor reviews one of your contributions, you will hear about it here — privately.
            </p>
          )}
          {!!items.length && (
            <ul className="notification-list">
              {items.map((entry) => (
                <li key={entry.id}>
                  <button className={entry.read ? '' : 'is-unread'} onClick={() => openItem(entry)} type="button">
                    <span className={`notification-kind is-${entry.kind}`}>
                      <Icon name={KIND_ICON[entry.kind] || 'note'} size={14} />
                    </span>
                    <span className="notification-copy">
                      <strong>{entry.title || 'Your contribution'}</strong>
                      <small>
                        {entry.kind === 'published' && 'Published to Samsung Internal'}
                        {entry.kind === 'changes' && `Changes requested${entry.note ? ` — ${entry.note}` : ''}`}
                        {entry.kind === 'rejected' && `Not published${entry.note ? ` — ${entry.note}` : ''}`}
                        {' · '}
                        {relativeTime(entry.created_at)}
                      </small>
                    </span>
                    {!entry.read && <span aria-hidden="true" className="notification-dot" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
