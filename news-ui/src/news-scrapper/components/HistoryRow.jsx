import React from 'react';
import Icon from './Icon.jsx';

export default function HistoryRow({ item, onOpen }) {
  return (
    <div className="hist-row" onClick={() => onOpen && onOpen(item)}>
      <div className="thumb"><div className={'ph-img ' + (item.tone || '')}></div></div>
      <div className="body">
        <div className="meta">
          <span className="src">{item.src}</span>
          {item.time && (<><span className="sep">·</span><span>{item.time}</span></>)}
          {item.source_count > 1 && (
            <><span className="sep">·</span>
              <span><Icon name="layers" size={11} /> {item.source_count} sources</span></>
          )}
          {item.seen_today > 1 && (
            <><span className="sep">·</span>
              <span className="seen">seen {item.seen_today}× · {item.first_today} → {item.last_today}</span>
            </>
          )}
          {item.region === 'Local' && <span className="tag accent" style={{ height: 18, fontSize: 10 }}>Local</span>}
        </div>
        <div className="ttl">{item.title}</div>
        <div className="summary">{item.summary}</div>
        <div className="kws">
          {(item.keywords || []).slice(0, 4).map((k, i) => <span key={i} className="kw-tag">{k}</span>)}
          {typeof item.conf === 'number' && (
            <span className="conf mono small muted" style={{ marginLeft: 'auto' }}>conf {item.conf.toFixed(2)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
