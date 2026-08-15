import React from 'react';
import ForYouCard from './ForYouCard.jsx';

export default function SinceLastVisit({ items, cardProps }) {
  if (!items?.length) return null;
  return <section className="fy-section fy-since"><header><span>Since your last visit</span><h2>What changed while you were away</h2><p>Fresh developments, without repeating the same story cluster.</p></header><div className="fy-lead-grid">{items.map((item, index) => <ForYouCard {...cardProps(item, index, 'since_last_visit')} compact={index > 0} item={item} key={item.article_id || item.id} />)}</div></section>;
}
