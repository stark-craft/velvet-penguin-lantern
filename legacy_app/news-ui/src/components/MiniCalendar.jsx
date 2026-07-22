import React from 'react';

export default function MiniCalendar({ days = [], from, to, onPick }) {
  const today = new Date().toISOString().slice(0, 10);
  const max = Math.max(1, ...days.map((d) => d.count));
  const inRange = (d) => d >= from && d <= to;
  return (
    <div className="mini-cal">
      <div className="mini-cal-grid">
        {days.map((d) => {
          const dayNum = parseInt(d.date.slice(8, 10), 10);
          const heightPct = Math.round((d.count / max) * 100);
          const active = inRange(d.date);
          return (
            <div key={d.date}
                 className={'mini-cal-cell' + (active ? ' active' : '') + (d.date === today ? ' today' : '')}
                 onClick={() => onPick(d.date, d.date)}
                 title={`${d.date} · ${d.count} articles`}>
              <div className="bar" style={{ height: heightPct + '%' }}></div>
              <div className="dnum tnum">{dayNum}</div>
            </div>
          );
        })}
      </div>
      <div className="mini-cal-legend muted small">
        <span>{days.length} days · click a day to focus</span>
      </div>
    </div>
  );
}
