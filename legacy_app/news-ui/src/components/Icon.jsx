import React from 'react';

const PATHS = {
  home:      <><path d="M3 10l9-7 9 7"/><path d="M5 9v11h14V9"/></>,
  inbox:     <><path d="M3 13l4-8h10l4 8"/><path d="M3 13v7h18v-7"/><path d="M7 13h4l2 3 2-3h4"/></>,
  search:    <><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></>,
  check:     <><path d="M4 12l5 5 11-12"/></>,
  star:      <><path d="M12 3l2.8 6 6.2.8-4.6 4.4 1.2 6.3L12 17.6 6.4 20.5l1.2-6.3L3 9.8 9.2 9z"/></>,
  globe:     <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  clock:     <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  trend:     <><path d="M3 17l6-6 4 4 8-9"/><path d="M14 6h7v7"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2l-.4-2.6H9.9L9.5 5.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4.2l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/></>,
  bell:      <><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
  plus:      <><path d="M12 5v14M5 12h14"/></>,
  play:      <><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/></>,
  stop:      <><rect x="6" y="6" width="12" height="12"/></>,
  chevR:     <><path d="M9 6l6 6-6 6"/></>,
  chevL:     <><path d="M15 6l-6 6 6 6"/></>,
  chevD:     <><path d="M6 9l6 6 6-6"/></>,
  filter:    <><path d="M4 5h16l-6 8v5l-4 2v-7z"/></>,
  sort:      <><path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l3-3M17 20l-3-3"/></>,
  menu:      <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  sparkle:   <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></>,
  note:      <><path d="M4 4h16v14l-4 4H4z"/><path d="M16 22v-6h6"/></>,
  archive:   <><rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8M10 12h4"/></>,
  duplicate: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  refresh:   <><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4"/></>,
  calendar:  <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
  terminal:  <><path d="M3 5h18v14H3z"/><path d="M7 9l3 3-3 3M13 15h4"/></>,
  external:  <><path d="M14 4h6v6"/><path d="M10 14L20 4M20 10v10H4V4h10"/></>,
  up:        <><path d="M7 14l5-6 5 6"/></>,
  down:      <><path d="M7 10l5 6 5-6"/></>,
  thumbsUp:  <><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3l4-8a3.13 3.13 0 0 1 4 3.88Z"/></>,
  thumbsDown:<><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 8a3.13 3.13 0 0 1-4-3.88Z"/></>,
  shield:    <><path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"/></>,
  rotate:    <><path d="M4 4v6h6"/><path d="M20 10a8 8 0 0 0-14-4L4 10"/></>,
  rss:       <><circle cx="5" cy="19" r="1.5"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/></>,
  pause:     <><rect x="7" y="5" width="3" height="14"/><rect x="14" y="5" width="3" height="14"/></>,
  download:  <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
  upload:    <><path d="M12 20V8M7 13l5-5 5 5"/><path d="M4 20h16"/></>,
  server:    <><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></>,
  check2:    <><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></>,
  warning:   <><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></>,
  error:     <><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></>,
  trash:     <><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/></>,
  x:         <><path d="M6 6l12 12M18 6L6 18"/></>,
  layers:    <><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/></>,
  pin:       <><path d="M12 2v8l4 4-4 6-4-6 4-4z"/></>,
  bolt:      <><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></>,
  eye:       <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  file:      <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
  history:   <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></>,
};

export default function Icon({ name, className = 'i', size = 16 }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size}
         fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name] || null}
    </svg>
  );
}
