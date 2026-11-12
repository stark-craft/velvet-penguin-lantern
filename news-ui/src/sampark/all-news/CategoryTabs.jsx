import React from 'react';

const LENSES = [
  { id: 'all', label: 'All' },
  { id: 'ai', label: 'AI' },
  { id: 'devices', label: 'Devices' },
  { id: 'compute', label: 'Compute' },
  { id: 'robotics', label: 'Robotics' },
  { id: 'media', label: 'Media' },
];

export default function CategoryTabs({ active='all', onSelect }){
  return (
    <nav aria-label="Technology category" className="tsan-category-tabs">
      {LENSES.map(l=>(
        <button
          key={l.id}
          aria-pressed={active===l.id}
          className={`tsan-cat-tab${active===l.id ? ' is-active' : ''}`}
          onClick={()=> onSelect?.(l.id)}
          type="button"
        >{l.label}</button>
      ))}
    </nav>
  );
}

export { LENSES };
