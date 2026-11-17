import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { samsungPageCount, SAMSUNG_NEWS_PAGE_SIZE } from './samsungPagination.js';

export default function SamsungPageControls({
  page = 1, total = 0, pageSize = SAMSUNG_NEWS_PAGE_SIZE,
  onChange, busy = false, label = 'Samsung stories',
}) {
  const count = samsungPageCount(total, pageSize);
  if (count <= 1 || typeof onChange !== 'function') return null;
  const current = Math.min(Math.max(1, page), count);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  return (
    <nav className="samsung-pagination" aria-label={label + ' pagination'}>
      <span className="samsung-pagination-range" aria-live="polite">
        Showing {from}–{to} of {total}
      </span>
      <div className="samsung-pagination-controls">
        <button className="btn-secondary" disabled={busy || current <= 1}
          onClick={() => onChange(current - 1)} type="button">
          <Icon name="chevL" size={15} /> Previous
        </button>
        <span className="samsung-pagination-pages">Page {current} of {count}</span>
        <button className="btn-secondary" disabled={busy || current >= count}
          onClick={() => onChange(current + 1)} type="button">
          Next <Icon name="chevR" size={15} />
        </button>
      </div>
    </nav>
  );
}
