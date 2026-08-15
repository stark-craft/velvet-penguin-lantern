import React from 'react';
import ForYouCard from './ForYouCard.jsx';

export default function FollowedUpdates({ items, cardProps }) {
  if (!items?.length) return null;
  return <section className="fy-section fy-followed"><header><span>Stories you follow</span><h2>The thread moved forward</h2><p>New signals connected to intelligence you deliberately saved.</p></header><div className="fy-horizontal-grid">{items.map((item, index) => <ForYouCard {...cardProps(item, index, 'followed_updates')} compact item={item} key={item.article_id || item.id} />)}</div></section>;
}
