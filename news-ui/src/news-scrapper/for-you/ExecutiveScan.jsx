import React from 'react';
import ForYouCard from './ForYouCard.jsx';

export default function ExecutiveScan({ items, reviewed, cardProps }) {
  if (!items?.length) return null;
  const progress = items.length ? Math.min(100, reviewed / items.length * 100) : 0;
  return <section className="fy-section fy-executive"><header><div><span>Today’s executive pulse</span><h2>Signals selected for you</h2></div><div className="fy-reviewed-pill"><svg aria-hidden="true" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle className="is-progress" cx="18" cy="18" r="15" pathLength="100" style={{ strokeDasharray: `${progress} 100` }} /></svg><span><strong>{Math.min(reviewed, items.length)} of {items.length}</strong> reviewed</span></div></header><div className="fy-executive-grid">{items.map((item, index) => <ForYouCard {...cardProps(item, index, 'executive_scan')} compact item={item} executiveVariant={index === 0 ? 'hero' : 'secondary'} key={item.article_id || item.id} />)}</div></section>;
}
