# Big Screen Defect Resolution

This guide transfers the Sampark All News fixes from the Mac/GitHub checkout to a Windows checkout that may contain newer, unrelated work. Apply only the replacements below. Keep your Windows-specific changes in other files.

## What was confirmed

- The Mac baseline Briefing Stream moved at a 2560 CSS-pixel viewport; after the repair it also moved at 3840 CSS pixels. No large-screen breakpoint in the inspected Mac code hides the stream or review checkboxes.
- A real checkbox cascade defect was found: the card `:hover` and `:focus-within` selectors were more specific than the checkbox `:checked` selector. They faded a checked control to 24% opacity while the pointer or focus remained on the card, even though the intended selected style was a black background with a white tick.
- Unchecked controls were also only 24% opaque when revealed. On a bright article image or a high-density desktop screen, that can be difficult to notice.
- Dark-theme verification found a shared form-input rule repainting the selected checkbox. The scoped theme rules below now keep its black background and white tick in both themes.
- The pre-fix Sampark All News stream stopped whenever the operating system/browser reported reduced motion. The original TechScout UI already kept its stream moving more slowly under that preference. Windows animation preferences, pointer/focus remaining over the stream, an older deployed frontend bundle, or different access permissions are separate possibilities; changing monitors alone does not establish which occurred.
- The actual Windows deployment was not inspected or verified. The Mac checks identify the code defects and provide a portable repair; finish with the Windows validation checklist below.

These changes stay in the All News frontend. They do not change backend logic, permissions, global page widths, or the decorative gutters.

## 1. Replace the review-checkbox CSS block

**File:** `legacy_app\news-ui\src\sampark\all-news\all-news.css`

Search for this exact **start anchor**:

```css
.tsan-card-review-check {
```

Starting there, select everything up to, but **not including**, this exact **end anchor**:

```css
.tsan-news-card-footer-actions {
```

The selected range must include the review-checkbox rules and their `@media (hover: none)` block. Keep `.tsan-news-card-footer-actions {` and everything after it. Replace the selected range with this complete block:

```css
.tsan-card-review-check {
  appearance: none;
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 4;
  width: 23px;
  height: 23px;
  margin: 0;
  border: 1.5px solid rgba(255,255,255,.82);
  border-radius: 6px;
  background: rgba(8,16,35,.2);
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity .15s ease, background .15s ease, box-shadow .15s ease;
}
.tsan-news-card:hover .tsan-card-review-check:not(:checked):not(:focus-visible),
.tsan-news-card:focus-within .tsan-card-review-check:not(:checked):not(:focus-visible) {
  opacity: .45;
  pointer-events: auto;
}
.tsan-card-review-check:hover:not(:checked):not(:focus-visible):not(:disabled) {
  opacity: .75;
  pointer-events: auto;
}
.tsan-card-review-check:focus-visible,
.tsan-card-review-check:checked {
  opacity: 1;
  pointer-events: auto;
}
.tsan-card-review-check:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.tsan-card-review-check:checked {
  border-color: rgba(255,255,255,.92);
  background: #111318;
  box-shadow: 0 0 0 2px rgba(255,255,255,.4), 0 3px 10px rgba(0,0,0,.2);
}
.tsan-card-review-check:checked::after {
  content: '';
  position: absolute;
  left: 7px;
  top: 3px;
  width: 6px;
  height: 11px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
html[data-theme] .tsan-card-review-check {
  border-color: rgba(255,255,255,.82) !important;
  background: rgba(8,16,35,.2) !important;
  box-shadow: 0 2px 8px rgba(0,0,0,.18) !important;
}
html[data-theme] .tsan-card-review-check:checked {
  border-color: rgba(255,255,255,.92) !important;
  background: #111318 !important;
  box-shadow: 0 0 0 2px rgba(255,255,255,.4), 0 3px 10px rgba(0,0,0,.2) !important;
}
.tsan-card-review-check:disabled {
  cursor: not-allowed;
}
@media (hover: none) {
  .tsan-card-review-check:not(:checked):not(:focus-visible) {
    opacity: .45;
    pointer-events: auto;
  }
}
```

This preserves the requested quiet behavior: an unchecked checkbox is hidden at rest, becomes 45% opaque when its card is hovered or keyboard focus enters the card, and becomes 75% opaque directly under the pointer. Checked and keyboard-focused inputs remain solid. The reveal selectors explicitly exclude those solid states, so card hover/focus and the no-hover fallback cannot fade them. The scoped `html[data-theme]` rules also prevent shared light/dark form-input styling from repainting this control. The black background and white tick remain intact in both themes.

Checkboxes already in Review Queue or approved remain disabled. The shared disabled-control style can make those completed controls half-opaque; this is distinct from the hover bug affecting active selection.

### An absent checkbox is different from a transparent checkbox

The control is rendered only in the date-grouped **News** grid, with the `daywise` card variant, and only when the server grants `review.news.submit`. Latest News cards intentionally do not contain review checkboxes.

Do not remove permission checks to make a checkbox appear. In Chrome DevTools, inspect the response from the existing same-origin `GET /access-control/capabilities` request. Confirm that its `capabilities` array contains `review.news.submit`. A separate desktop browser, a different computer/IP, or a different role session can legitimately receive a different grant even when the UI looks the same. Use your configured role login or existing approved network access if the permission is absent.

The frontend rendering guard lives in `legacy_app\news-ui\src\sampark\all-news\NewsCard.jsx`. The capability is read in `legacy_app\news-ui\src\sampark\all-news\AllNewsPage.jsx`. No JavaScript replacement or backend permission change is needed for the CSS repair.

## 2. Replace the Briefing Stream implementation

The old implementation treats reduced motion as a complete stop, moves by pixels per animation frame, and recreates its offset on pause/resume. It also estimates the loop boundary from half the total track height. The replacement keeps the original list presentation and filter/source actions, while:

- using the existing reactive visibility/motion hook;
- moving at 18 CSS pixels per second normally, or about 10.3 under reduced motion, independently of monitor refresh rate;
- preserving the offset when pausing and resuming;
- measuring the actual beginning of the next repeated copy, including its gap;
- remeasuring after viewport, font wrapping, and browser zoom changes;
- filling the stream viewport with enough copies, even with a short list;
- exposing Pause/Resume and keeping the hover/focus pause scoped to the scrolling list.

### 2A. Replace AllNewsRail.jsx

**File:** `legacy_app\news-ui\src\sampark\all-news\AllNewsRail.jsx`

This is a complete single-component file replacement. In the older file, the **start anchor** is its first import:

```jsx
import React, { useEffect, useRef, useState } from 'react';
```

The component **declaration anchor** is:

```jsx
export default function AllNewsRail({ items=[], onOpen }){
```

The **end anchor** is the final closing section at the end of the file:

```jsx
      </div>
    </aside>
  );
}
```

Remove the entire file contents from its first import through that final closing brace, including the old animation effects and return markup. Paste the complete replacement below. If your Windows file includes additional product features beyond this single component, compare those additions before replacing it; do not discard them just to make a search anchor match.

```jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { scoreOf } from '../../news-scrapper/utils/intelligence.js';
import useAutoplayState from '../../news-scrapper/hooks/useAutoplayState.js';
import { advanceRailOffset, normalizeRailOffset, railCopyCount, railLoopDistance } from './railMotion.js';

export default function AllNewsRail({ items=[], onOpen }){
  const safeItems = useMemo(()=> (items || []).filter(Boolean), [items]);
  const [manualPaused, setManualPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  const [copies, setCopies] = useState(2);
  const { documentVisible, reducedMotion } = useAutoplayState();
  const listRef = useRef(null);
  const trackRef = useRef(null);
  const offsetRef = useRef(0);
  const distanceRef = useRef(0);

  const display = Array.from({ length: copies }, ()=> safeItems).flat();
  const itemSig = JSON.stringify(safeItems.map((it)=> [it?.title, it?.date, it?.src || it?.source, it?.category]));
  const hasItems = safeItems.length > 0;
  const shouldAnimate = hasItems && !manualPaused && !hovered && !focused && inView && documentVisible;

  useEffect(()=>{
    if (!hasItems) {
      setHovered(false);
      setFocused(false);
      setInView(true);
    }
    const el = listRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries)=>{ setInView(Boolean(entries[0]?.isIntersecting)); }, { threshold: 0 });
    obs.observe(el);
    return ()=> obs.disconnect();
  }, [hasItems]);

  useEffect(()=>{
    const track = trackRef.current;
    const viewport = listRef.current;
    if (!track || !viewport) return undefined;
    offsetRef.current = 0;
    const measure = ()=> {
      distanceRef.current = railLoopDistance(track, safeItems.length);
      offsetRef.current = normalizeRailOffset(offsetRef.current, distanceRef.current);
      track.style.transform = `translateY(-${offsetRef.current}px)`;
      const needed = railCopyCount(viewport.clientHeight, distanceRef.current);
      setCopies((current)=> current === needed ? current : needed);
    };
    measure();
    // Text wrapping, browser zoom and monitor moves can change either dimension.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    observer?.observe(viewport);
    window.addEventListener('resize', measure);
    return ()=> {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [itemSig, safeItems.length]);

  useEffect(()=>{
    const el = trackRef.current;
    if(!el || !shouldAnimate) return undefined;
    let raf;
    let previousTime = null;
    const step = (now)=>{
      const elapsed = previousTime === null ? 0 : now - previousTime;
      previousTime = now;
      offsetRef.current = advanceRailOffset(offsetRef.current, elapsed, distanceRef.current, reducedMotion);
      el.style.transform = `translateY(-${offsetRef.current}px)`;
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return ()=> window.cancelAnimationFrame(raf);
  },[shouldAnimate, itemSig, reducedMotion]);

  if(!safeItems.length){
    return (
      <aside className="tsan-rail" aria-label="All News">
        <h3 className="tsan-rail-title">All News</h3>
        <p className="tsan-rail-empty">All News will appear after the briefing loads.</p>
      </aside>
    );
  }

  return (
    <aside className="tsan-rail" aria-label="All News">
      <div className="tsan-rail-header">
        <h3 className="tsan-rail-title">All News</h3>
        <button className="tsan-rail-toggle" type="button" aria-pressed={manualPaused}
          aria-label={manualPaused ? 'Resume briefing stream' : 'Pause briefing stream'}
          title={manualPaused ? 'Resume stream' : `Pause stream${reducedMotion ? ' (slowed for Windows motion preference)' : ''}`}
          onClick={()=> setManualPaused((current)=> !current)}>
          <Icon name={manualPaused ? 'play' : 'pause'} size={12} />
          <span>{manualPaused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
      <div className="tsan-rail-window" ref={listRef}
        onMouseEnter={()=> setHovered(true)} onMouseLeave={()=> setHovered(false)}
        onFocus={()=> setFocused(true)}
        onBlur={(event)=> { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="tsan-rail-track" ref={trackRef}>
          {display.map((item, idx)=>(
            <button
              key={`${item?.title || 'item'}-${idx}`}
              aria-hidden={idx >= safeItems.length ? 'true' : undefined}
              tabIndex={idx >= safeItems.length ? -1 : 0}
              className="tsan-rail-item"
              onClick={()=> item && onOpen?.(item)}
              type="button"
            >
              <span className="tsan-rail-category">{item?.category || 'Technology'}</span>
              <strong className="tsan-rail-headline">{item?.title || ''}</strong>
              <span className="tsan-rail-meta">{item?.src || item?.source || 'TechScout'} · {item?.date || 'Latest'} · Score {item ? scoreOf(item) : 0}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
```

### 2B. Add the stream motion helper

**New file:** `legacy_app\news-ui\src\sampark\all-news\railMotion.js`

Create this file in the same folder as `AllNewsRail.jsx`, with these complete contents. If that exact helper already exists from this release, use the same contents once rather than creating another copy.

```js
// Measure the beginning of the next copy, including the gap between copies.
export function railLoopDistance(track, itemCount) {
  const first = track?.children?.[0];
  const nextCopy = track?.children?.[itemCount];
  if (!first || !nextCopy) return 0;
  const distance = nextCopy.getBoundingClientRect().top - first.getBoundingClientRect().top;
  return Number.isFinite(distance) && distance > 0 ? distance : 0;
}

export function normalizeRailOffset(offset, distance) {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.max(0, Number(offset) || 0) % distance;
}

export function advanceRailOffset(offset, elapsedMilliseconds, distance, reducedMotion = false) {
  // A monitor move or a delayed frame must not cause a large catch-up jump.
  const elapsed = Math.max(0, Math.min(100, Number(elapsedMilliseconds) || 0));
  const pixelsPerSecond = reducedMotion ? 18 / 1.75 : 18;
  return normalizeRailOffset(offset + elapsed * pixelsPerSecond / 1000, distance);
}

export function railCopyCount(viewportHeight, distance) {
  if (!Number.isFinite(distance) || distance <= 0) return 2;
  return Math.max(2, Math.ceil(Math.max(0, Number(viewportHeight) || 0) / distance) + 1);
}
```

### 2C. Check the existing shared hook dependency

**Dependency file:** `legacy_app\news-ui\src\news-scrapper\hooks\useAutoplayState.js`

This hook already exists in the Mac/GitHub checkout and is not modified by the fix. The replacement component imports its default `useAutoplayState` function and reads `documentVisible` and `reducedMotion` from it. If your Windows hook already provides those two values, keep it unchanged, including other exports or Windows additions.

If the file is missing in your Windows checkout, create it at the exact path above with the following complete contents. Do not overwrite an existing customized hook blindly; if its contract differs, reconcile its default export with the two values the rail uses and retain any exports used by your other screens.

```js
import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Windows exposes its "Animation effects" setting through prefers-reduced-motion.
// TechScout's live streams remain functional in that mode, but run more slowly
// and always expose a pause button. Page visibility still stops background work.
export default function useAutoplayState() {
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const syncMotion = () => setReducedMotion(Boolean(media?.matches));
    const syncVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    syncMotion();
    syncVisibility();
    media?.addEventListener?.('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      media?.removeEventListener?.('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  return { documentVisible, reducedMotion };
}

export function autoplayDelay(milliseconds, reducedMotion) {
  return Math.round(milliseconds * (reducedMotion ? 1.6 : 1));
}

export function repeatingCycleCount(viewportWidth, itemCount, minimumItemWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const items = Math.max(1, Number(itemCount) || 0);
  const itemWidth = Math.max(1, Number(minimumItemWidth) || 0);
  return Math.max(4, Math.ceil((width * 2) / (items * itemWidth)) + 1);
}
```

### 2D. Append the stream containment/control CSS once

**File:** `legacy_app\news-ui\src\sampark\all-news\all-news.css`

After applying the checkbox replacement from section 1, scroll to the very end of this CSS file, after its final closing brace, and append the following block once. These selectors override only the stream's shrinking behavior and style its new header/control. They do not introduce a screen-width breakpoint or change any global gutter.

If your Windows file already contains the exact `.tsan-rail-header` and `.tsan-rail-toggle` rules from this release, keep one copy instead of appending a duplicate. The essential containment additions are `min-height: 0` on `.tsan-rail` and `.tsan-rail-window`, plus `flex: none` on `.tsan-rail-title`.

```css
/* All News stream containment and controls; append once at the end. */
.tsan-rail,
.tsan-rail-window {
  min-height: 0;
}
.tsan-rail-title {
  flex: none;
}
.tsan-rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--primary, #1428a0);
}
.tsan-rail-header .tsan-rail-title {
  margin: 0;
  padding-bottom: 0;
  border-bottom: 0;
}
.tsan-rail-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 6px;
  padding: 4px 6px;
  background: var(--surface, #ffffff);
  color: var(--muted, #6b7280);
  font-size: 11px;
}
.tsan-rail-toggle:hover { background: var(--surface-soft, #f5f7fa); }
.tsan-rail-toggle:focus-visible { outline: 2px solid var(--primary, #1428a0); outline-offset: 2px; }
```

The Mac implementation merges these properties into its existing blocks. Appending this equivalent scoped block is convenient for a divergent Windows checkout because it leaves the other rail/card styles intact.

## 3. Rebuild and refresh the Windows frontend

Back up the affected source files before manual replacements. Do not overwrite `.env`, runtime JSON, model weights, or embedded Python.

For a Windows development checkout, run these commands from the active frontend directory, substituting your actual checkout path:

```powershell
cd "<checkout>\legacy_app\news-ui"
npm test
npm run build
```

If Vite is already running, stop that frontend terminal with Ctrl+C, then restart it from the same directory:

```powershell
npm run dev
```

For a portable production deployment, build in the development checkout first. Copy the **complete contents** of `legacy_app\news-ui\dist` to `C:\App_Portable\frontend\dist` using your normal update process. Do not copy only the edited JSX/CSS source into the portable folder: production serves the built assets. If `NEWSSCRAPPER_FRONTEND_DIST` points somewhere else, update that actual frontend directory instead. No backend code update is required.

In Chrome, close any old duplicate app tab and reopen the same Sampark route. Use Ctrl+Shift+R to bypass cached assets. If the old UI remains, open DevTools → Network, enable **Disable cache**, reload, and confirm the frontend asset filenames match the newly built `dist` rather than an older bundle. Follow your normal server restart procedure if the deployment still serves a previous asset directory.

## 4. Validate on the actual Windows display

Check the route `/sampark/all-news` in both light and dark themes.

1. Test the laptop browser and larger desktop browser at 100% Chrome zoom first. Windows display scaling and Chrome zoom change the effective **CSS-pixel** viewport; a monitor's physical resolution is not the same measurement. In DevTools Console, `window.innerWidth` is the actual width used by CSS media queries. Also record `window.devicePixelRatio`.
2. Check a normal desktop width and a large CSS viewport such as 2560 pixels. If the physical display is scaled, use Chrome's responsive viewport controls to test that CSS width separately. This diagnostic test does not change the shared gutter rules.
3. Move the pointer outside the Briefing Stream and its controls. Confirm the list progresses over several seconds. Hover or focus within it to confirm intentional pause, then leave it to confirm resume. Check the explicit Pause/Resume control as well.
4. In Windows Settings, test **Accessibility → Visual effects → Animation effects** both on and off. Chrome exposes that preference through `matchMedia('(prefers-reduced-motion: reduce)').matches`. Under reduced motion, the repaired stream continues automatically at the slower speed of about 10.3 CSS pixels per second, instead of stopping entirely. Pause/Resume remains an explicit user control in either mode. Turning this setting back on restores normal default movement at 18 CSS pixels per second.
5. Switch to a different browser tab, then return. The stream must resume when appropriate rather than reset to its first item. Change an All News filter and confirm the stream updates to the filtered stories.
6. Scroll to the date-grouped News grid. With the pointer away and no keyboard focus, an unchecked checkbox being hidden is expected. Hover its card and confirm a subtle top-left box appears. Hover the box itself and confirm it becomes more visible.
7. Click a checkbox and keep the pointer on that card. Its black background and white tick should appear immediately and remain solid. Select a second article: both remain checked and the bottom selection bar shows two selected. Uncheck one: the count decreases and the other stays checked. Clear selection at the end.
8. Use Tab to focus a review checkbox. Confirm it is fully visible with a focus outline, and Space toggles it. Also test a no-hover/touch input mode if that desktop supports touch; unchecked controls should remain discoverable without requiring hover.
9. If no review inputs exist at all, check the permissions response described above. If inputs exist but are invisible while hovered or checked, inspect their computed `opacity`, `display`, `visibility`, `pointer-events`, and bounds for later Windows-specific overrides. The repaired active states should be `.45` on card hover, `.75` on direct checkbox hover, and `1` when checked or keyboard-focused.
10. If the Mac fixes do not resolve the Windows symptoms, retain the current Windows code and capture the stream's Pause/Resume state, reduced-motion value, viewport width, loaded frontend asset version, and permissions response. Those distinguish a Windows-only cascade/deployment difference from a stopped stream or missing rendering permission.

Do not describe this guide as a completed Windows verification until these checks pass on the actual Windows deployment.

## Mac/GitHub verification for this patch

All 250 frontend tests and the production build pass. Browser checks on the real
`/sampark/all-news` route covered 1024, 1440, 2560 and 3840 CSS-pixel widths,
light/dark themes, checked controls during card hover, immediate selection updates,
Pause/Resume and preserving a paused offset across a monitor-size change.
A one-article Compute filter at 3840 pixels produced five repeated items covering
the entire stream window and continued moving; returning to All restored the feed.
The actual Windows preference and deployment checks remain yours to validate.
