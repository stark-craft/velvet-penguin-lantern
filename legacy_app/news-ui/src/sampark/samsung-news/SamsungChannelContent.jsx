import React, { useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import FeaturedCarousel from '../all-news/FeaturedCarousel.jsx';
import AllNewsRail from '../all-news/AllNewsRail.jsx';
import LeadershipMessageHero from './LeadershipMessageHero.jsx';
import SriDDocumentCard from './SriDDocumentCard.jsx';
import { samsungItemKey } from './samsungNewsModel.js';

function imageOf(item) { return item?.image_url || item?.top_image || ''; }
function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}
function dateHeading(value) {
  if (!value || value === 'undated') return 'Date unavailable';
  const raw = String(value).slice(0, 10);
  const parsed = Date.parse(`${raw}T12:00:00`);
  if (!Number.isFinite(parsed)) return String(value);
  return new Date(parsed).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function standardFeedHeading(value) {
  const raw = String(value || '').slice(0, 10);
  const today = new Date();
  if (raw === localDateKey(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (raw === localDateKey(yesterday)) return 'Yesterday';
  return dateHeading(value);
}
function regionOf(item) {
  const region = item?.region;
  if (!region) return 'Global';
  if (typeof region === 'string') return region;
  return region?.value || region?.name || 'Global';
}
function contentTypeKey(item) {
  const type = String(item?.contentType || item?.content_type ||
    item?.samsung_internal_kind || '').trim().toLowerCase();
  if (type === 'leadership') return 'leadership';
  if (type === 'announcement') return 'announcement';
  if (type === 'document_import') return 'document';
  if (type === 'story') return 'story';
  return 'story';
}
function contentTypeLabel(item) {
  const type = contentTypeKey(item);
  if (type === 'leadership') return 'Leadership Message';
  if (type === 'announcement') return 'Announcement';
  if (type === 'document') return 'Document';
  return 'Story';
}
function typeCountLabel(type, count) {
  if (type === 'leadership') return count === 1 ? 'Leadership Message' : 'Leadership Messages';
  if (type === 'announcement') return count === 1 ? 'Announcement' : 'Announcements';
  if (type === 'document') return count === 1 ? 'Document' : 'Documents';
  return count === 1 ? 'Story' : 'Stories';
}
// Archive grouping: Content Type -> Publication Date.
function buildSriDSections(groups) {
  const definitions = [
    { key: 'document', label: 'Documents' },
    { key: 'announcement', label: 'Announcements' },
    { key: 'story', label: 'Stories' },
    { key: 'leadership', label: 'Leadership Messages' },
  ];
  const buckets = { document: [], announcement: [], story: [], leadership: [] };
  (groups || []).forEach((group) => {
    (group?.signals || []).forEach((item) => {
      if (!item) return;
      const type = contentTypeKey(item);
      const rawDate = group?.date || item?.published_at || item?.publishedAt ||
        item?.date || 'undated';
      const date = String(rawDate).slice(0, 10) || 'undated';
      buckets[type].push({ item, date });
    });
  });
  return definitions.map((definition) => ({
    ...definition, entries: [...buckets[definition.key]]
      .sort((a, b) => b.date.localeCompare(a.date)),
  })).filter((section) => section.entries.length > 0);
}
function SamsungStoryCard({ item, internal = false, onOpen }) {
  const image = imageOf(item);
  const source = item?.src || item?.source || 'Samsung';
  const region = regionOf(item);
  const category = typeof item?.category === 'object'
    ? item.category?.value || item.category?.name || 'Samsung News'
    : item?.category || 'Samsung News';
  const sourceCount = Math.max(1, Number(item?.source_count || item?.sources?.length || 1));
  const leadershipCard = internal && contentTypeKey(item) === 'leadership';
  const regionKey = String(region).trim().toLocaleLowerCase();
  const regionClass = regionKey === 'sri-d' ? 'is-internal'
    : regionKey.includes('local') || regionKey.includes('india') ? 'is-local' : 'is-global';
  return (
    <article className={`tsan-news-card is-latest samsung-news-card${internal ? ' is-srid' : ''}`}>
      <button aria-label={`Open ${item?.title || 'Samsung story'}`} className="tsan-news-card-media"
        onClick={() => onOpen?.(item)} style={image ? {
          backgroundImage: `url("${image}")`,
          ...(leadershipCard ? {
            backgroundSize: 'contain', backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center top', backgroundColor: '#f4f5f7',
          } : {}),
        } : undefined} type="button">
        {!image && <span className="tsan-news-card-fallback"><Icon name="layers" size={24} /></span>}
        <span className="tsan-news-card-image-tags">
          {!internal && <span className="tsan-news-card-badge">
            {sourceCount} Source{sourceCount === 1 ? '' : 's'}
          </span>}
          <span className="tsan-news-card-category-badge">{internal ? contentTypeLabel(item) : category}</span>
        </span>
        <span className={`tsan-news-card-region-tag ${regionClass}`}>{region}</span>
      </button>
      <div className="tsan-news-card-body">
        <button className="tsan-news-card-title" onClick={() => onOpen?.(item)} type="button">{item?.title || ''}</button>
        {!internal && <div className="tsan-news-card-footer is-source-only">
          <span className="tsan-news-card-source">{source}</span>
        </div>}
      </div>
    </article>
  );
}
function SamsungAnnouncementCard({ item, onOpen }) {
  const image = imageOf(item);
  const text = String(item?.summary || item?.body || '').trim();
  return (
    <article className={`samsung-announcement-card${image ? ' has-image' : ' is-text-only'}`}>
      {image && <button aria-label={`Open ${item?.title || 'announcement'}`}
        className="samsung-announcement-media" onClick={() => onOpen?.(item)}
        style={{ backgroundImage: `url("${image}")` }} type="button">
        <span className="samsung-announcement-media-badge"><Icon name="megaphone" size={12} /> Announcement</span>
      </button>}
      <div className="samsung-announcement-content">
        <div className="samsung-announcement-meta">
          <span><Icon name="megaphone" size={13} /> Announcement</span>
          <small>{item?.date || 'Latest'}</small>
        </div>
        <button className="samsung-announcement-title" onClick={() => onOpen?.(item)}
          type="button">{item?.title || ''}</button>
        {text && <p>{text}</p>}
        <button className="samsung-announcement-read" onClick={() => onOpen?.(item)} type="button">
          Read announcement <Icon name="chevR" size={13} />
        </button>
      </div>
    </article>
  );
}
// Independent date filter per SRI-D content-type section.
function SriDTypeSection({ section, onOpen }) {
  const [dateFilter, setDateFilter] = useState('all');
  const dates = [...new Set(section.entries.map((entry) => entry.date))].sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return b.localeCompare(a);
  });
  const selectedDate = dateFilter === 'all' || dates.includes(dateFilter) ? dateFilter : 'all';
  const visibleEntries = selectedDate === 'all'
    ? section.entries : section.entries.filter((entry) => entry.date === selectedDate);
  const gridClass = section.key === 'announcement' ? 'samsung-announcement-grid'
    : section.key === 'document' ? 'samsung-document-grid' : 'tsan-day-grid';
  const headingId = `samsung-srid-${section.key}-heading`;
  return (
    <section aria-labelledby={headingId}
      className={`tsan-day-section samsung-srid-day-section samsung-srid-type-section is-${section.key}`}>
      <header className="tsan-day-header samsung-srid-type-header">
        <h3 id={headingId}>{section.label}</h3>
        <span aria-hidden="true" className="tsan-day-rule" />
        <div className="samsung-srid-section-tools">
          <span className="tsan-day-count">({visibleEntries.length} {typeCountLabel(section.key, visibleEntries.length)})</span>
          <label className="samsung-srid-date-filter">
            <span className="sr-only">Filter {section.label} by publication date</span>
            <select aria-label={`Filter ${section.label} by publication date`}
              onChange={(event) => setDateFilter(event.target.value)} value={selectedDate}>
              <option value="all">All</option>
              {dates.map((date) => <option key={date} value={date}>{dateHeading(date)}</option>)}
            </select>
            <span aria-hidden="true" className="samsung-srid-date-chevron"><Icon name="chevD" size={14} /></span>
          </label>
        </div>
      </header>
      <div className={gridClass}>
        {visibleEntries.map(({ item }) => {
          const key = samsungItemKey(item);
          if (section.key === 'announcement')
            return <SamsungAnnouncementCard item={item} key={key} onOpen={onOpen} />;
          if (section.key === 'document')
            return <SriDDocumentCard item={item} key={key} onOpen={onOpen} />;
          return <SamsungStoryCard internal item={item} key={key} onOpen={onOpen} />;
        })}
      </div>
    </section>
  );
}
export default function SamsungChannelContent({ channel, onOpen }) {
  if (!channel) return null;
  const isInternal = channel.id === 'internal';
  const heroItems = isInternal
    ? (channel.hero || []).map((item) => ({ ...item, category: contentTypeLabel(item) }))
    : channel.hero;
  const streamItems = isInternal
    ? (channel.stream || []).map((item) => ({ ...item, category: contentTypeLabel(item) }))
    : channel.stream;
  const sridSections = isInternal ? buildSriDSections(channel.groups) : [];
  return (
    <div className={`samsung-channel-content${isInternal ? ' is-internal' : ''}`}>
      <div className="tsan-featured-rail samsung-news-featured-rail">
        {isInternal && heroItems?.[0]?.contentType === 'leadership' ? (
          <LeadershipMessageHero item={heroItems[0]} onOpen={onOpen} />
        ) : (
          <FeaturedCarousel items={heroItems} onOpen={onOpen} />
        )}
        <AllNewsRail ariaLabel={`${channel.label} Briefing Stream`}
          emptyText={`No ${channel.label} briefing items are available right now.`}
          items={streamItems} onOpen={onOpen} showScore={false} title="Briefing Stream" />
      </div>
      <section aria-labelledby="samsung-channel-news-heading" className="samsung-channel-archive">
        <header className="samsung-channel-archive-header">
          <div>
            <span className="samsung-channel-kicker">{isInternal ? 'Internal publishing' : 'Samsung News'}</span>
            <h2 id="samsung-channel-news-heading">{isInternal ? 'SRI-D' : `${channel.label} News`}</h2>
          </div>
          <span className="samsung-channel-total">{channel.count} {isInternal
            ? channel.count === 1 ? 'item' : 'items'
            : channel.count === 1 ? 'story' : 'stories'}</span>
        </header>
        {!channel.groups?.length ? (
          <div className="tsan-empty">{isInternal
            ? 'No SRI-D content is currently available.'
            : 'No stories are currently available in this channel.'}</div>
        ) : isInternal ? (
          <div className="tsan-daywise samsung-srid-type-groups">
            {sridSections.map((section) => <SriDTypeSection
              key={section.key} section={section} onOpen={onOpen} />)}
          </div>
        ) : (
          <div className="tsan-daywise">
            {channel.groups.map((group) => (
              <section aria-label={`${channel.label} news for ${group.date}`}
                className="tsan-day-section" key={group.date}>
                <header className="tsan-day-header">
                  <h3>{standardFeedHeading(group.date)}</h3>
                  <span aria-hidden="true" className="tsan-day-rule" />
                  <span className="tsan-day-count">({group.signals.length} News)</span>
                </header>
                <div className="tsan-day-grid">
                  {group.signals.map((item) => <SamsungStoryCard
                    item={item} key={samsungItemKey(item)} onOpen={onOpen} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
