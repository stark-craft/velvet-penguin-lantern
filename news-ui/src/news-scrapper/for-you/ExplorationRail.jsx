import React from 'react';
import ForYouCard from './ForYouCard.jsx';

export default function ExplorationRail({ items, cardProps }) {
  if (!items?.length) return null;
  return <section className="fy-section fy-exploration"><header><span>Outside your usual lane</span><h2>Useful surprises, deliberately included</h2><p>A small exploration window keeps the feed broad and prevents a filter bubble.</p></header><div className="fy-horizontal-grid">{items.map((item, index) => <ForYouCard {...cardProps(item, index, 'exploration')} compact item={item} key={item.article_id || item.id} />)}</div></section>;
}
