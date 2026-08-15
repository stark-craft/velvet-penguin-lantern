import React from 'react';
import ForYouCard from './ForYouCard.jsx';

export default function ExecutiveScan({ items, reviewed, cardProps }) {
  if (!items?.length) return null;
  return <section className="fy-section fy-executive"><header><span>Five-minute executive scan</span><h2>Five signals worth knowing today</h2><p>{Math.min(reviewed, items.length)} of {items.length} reviewed</p><div className="fy-review-progress"><i style={{ width: `${items.length ? Math.min(100, reviewed / items.length * 100) : 0}%` }} /></div></header><div className="fy-card-grid">{items.map((item, index) => <ForYouCard {...cardProps(item, index, 'executive_scan')} item={item} key={item.article_id || item.id} />)}</div></section>;
}
