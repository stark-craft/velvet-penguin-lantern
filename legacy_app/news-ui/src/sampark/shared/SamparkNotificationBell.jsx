import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { getInternalNotifications, markInternalNotificationsRead } from '../../news-scrapper/api.js';
import { notificationDetail, notificationDestination, notificationTitle, unreadCount } from './notificationModel.js';

// Sampark-native private notification entry point. Renders the canonical
// backend record shape ({id, kind, record_id, title, note, created_at, read})
// scoped to the signed browser viewer.
export default function SamparkNotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [readError, setReadError] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await getInternalNotifications();
      if (!mountedRef.current) return;
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch { /* private bell stays quiet when contribution access is off */ }
  }, []);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 30000);
    return () => window.clearInterval(iv);
  }, [load]);

  const unread = unreadCount(items);

  const openItem = async (n) => {
    const destination = notificationDestination(n);
    setReadError('');
    try {
      await markInternalNotificationsRead([n.id]);
      if (!mountedRef.current) { navigate(destination); return; }
      // Mark only this notification; a later poll keeps it read server-side.
      setItems((cur) => cur.map((it) => (it.id === n.id ? { ...it, read: true } : it)));
    } catch (e) {
      // Truthful failure: navigation continues, but the row stays unread and
      // the error is shown instead of claiming durable success.
      if (mountedRef.current) setReadError(e?.message || 'Could not mark this update as read. It will still show as unread.');
    }
    setOpen(false);
    navigate(destination);
  };

  return (
    <div className="sampark-notif-bell" style={{ position: 'relative' }}>
      <button aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="icon-btn" onClick={() => setOpen((v) => !v)} type="button">
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="sampark-notif-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="sampark-notif-dropdown" role="menu" aria-label="Contribution notifications">
          {readError && <p className="sampark-notif-error" role="alert">{readError}</p>}
          {!items.length && <p className="sampark-notif-empty">No contribution updates.</p>}
          {items.map((n) => {
            const detail = notificationDetail(n);
            return (
              <button key={n.id} className={`sampark-notif-item${n.read ? '' : ' is-unread'}`} onClick={() => openItem(n)} role="menuitem" type="button">
                <strong>{notificationTitle(n)}</strong>
                {detail && <span className="sampark-notif-detail">{detail}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
