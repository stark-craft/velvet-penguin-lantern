import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadMascotAssets, mascotAssetAvailability } from './mascotAssets.js';
import {
  MONKEY_BODY_HEIGHT,
  MONKEY_BODY_WIDTH,
  MONKEY_CHAIR_WIDTH,
  MONKEY_PHASES,
  measureMonkeyGutters,
  nextMonkeyPhase,
  resistedMonkeyPull,
} from './mascotModel.js';
import './gutter-monkey.css';

const POSE = Object.freeze({
  [MONKEY_PHASES.DRAGGING]: 'monkey-hanging',
  [MONKEY_PHASES.REVEALING]: 'monkey-hanging-newspaper',
  [MONKEY_PHASES.STRAINING]: 'monkey-grip-strain',
  [MONKEY_PHASES.RESETTING]: 'monkey-hanging-newspaper',
  [MONKEY_PHASES.SLIPPING]: 'monkey-slip',
  [MONKEY_PHASES.FALLING]: 'monkey-falling',
  [MONKEY_PHASES.LANDED]: 'monkey-land',
  [MONKEY_PHASES.DUSTING_OFF]: 'monkey-dust-off',
  [MONKEY_PHASES.WALKING]: 'monkey-walk-newspaper',
  [MONKEY_PHASES.DRAGGING_NEWSPAPER]: 'monkey-drag-newspaper',
  [MONKEY_PHASES.PULLING_CHAIR]: 'monkey-pull-chair',
  [MONKEY_PHASES.SITTING]: 'monkey-sit',
  [MONKEY_PHASES.READING]: 'monkey-reading',
});

const FINITE_ANIMATION = Object.freeze({
  [MONKEY_PHASES.RESETTING]: 'gutter-monkey-recoil',
  [MONKEY_PHASES.SLIPPING]: 'gutter-monkey-slip',
  [MONKEY_PHASES.FALLING]: 'gutter-monkey-fall',
  [MONKEY_PHASES.LANDED]: 'gutter-monkey-land',
  [MONKEY_PHASES.DUSTING_OFF]: 'gutter-monkey-recover',
  [MONKEY_PHASES.WALKING]: 'gutter-monkey-walk',
  [MONKEY_PHASES.DRAGGING_NEWSPAPER]: 'gutter-monkey-paper-drag',
  [MONKEY_PHASES.PULLING_CHAIR]: 'gutter-monkey-chair-pull',
  [MONKEY_PHASES.SITTING]: 'gutter-monkey-sit',
});

function sceneGeometry(viewportWidth, viewportHeight, workspaceRect, brandRect) {
  const gutters = measureMonkeyGutters(viewportWidth, workspaceRect);
  if (!gutters.enabled || viewportHeight < 550) return null;
  const actorX = Math.max(0, Math.min(brandRect.left + 20, gutters.left - MONKEY_BODY_WIDTH + 20));
  const actorY = brandRect.top + 12;
  const chairX = viewportWidth - gutters.right + (gutters.right - MONKEY_CHAIR_WIDTH) / 2;
  return {
    actorX,
    actorY,
    chairX,
    chairY: viewportHeight - 180,
    groundY: Math.max(0, viewportHeight - actorY - MONKEY_BODY_HEIGHT - 14),
    seatY: viewportHeight - 295 - actorY,
    tailX: brandRect.left + 22,
    tailY: brandRect.top + 20,
    travelX: Math.max(0, chairX - actorX - 12),
  };
}

function sameGeometry(a, b) {
  return a && b && Object.keys(b).every((key) => Math.abs(a[key] - b[key]) < 0.5);
}

export default function GutterMonkey({ brandRef, workspaceRef }) {
  const [assets, setAssets] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [phase, setPhase] = useState(MONKEY_PHASES.HIDDEN_TEASE);
  const [balanceReacting, setBalanceReacting] = useState(false);
  const phaseRef = useRef(MONKEY_PHASES.HIDDEN_TEASE);
  const completedRef = useRef(false);
  const actorRef = useRef(null);
  const dragRef = useRef(null);
  const dragFrameRef = useRef(0);
  const measureFrameRef = useRef(0);
  const lastBalanceRef = useRef(0);
  const balanceRef = useRef(false);

  const send = useCallback((event) => {
    const next = nextMonkeyPhase(phaseRef.current, event);
    if (next === phaseRef.current) return;
    phaseRef.current = next;
    if (next === MONKEY_PHASES.READING) completedRef.current = true;
    setPhase(next);
  }, []);

  const resetBrand = useCallback(() => {
    brandRef.current?.style.setProperty('--gutter-monkey-logo-y', '0px');
    brandRef.current?.style.setProperty('--gutter-monkey-logo-rotation', '0deg');
  }, [brandRef]);

  const writePull = useCallback((distance) => {
    const visual = Math.max(0, distance);
    actorRef.current?.style.setProperty('--gutter-monkey-pull', `${visual.toFixed(2)}px`);
    actorRef.current?.style.setProperty('--gutter-monkey-reveal', `${Math.min(100, 18 + visual * 0.88).toFixed(2)}%`);
    brandRef.current?.style.setProperty('--gutter-monkey-logo-y', `${Math.min(7, visual * 0.07).toFixed(2)}px`);
    brandRef.current?.style.setProperty('--gutter-monkey-logo-rotation', `${Math.min(3, visual * 0.03).toFixed(2)}deg`);
  }, [brandRef]);

  const animatePull = useCallback(() => {
    dragFrameRef.current = 0;
    const drag = dragRef.current;
    if (!drag) return;
    drag.visual += (drag.target - drag.visual) * 0.3;
    writePull(drag.visual);
    if (Math.abs(drag.target - drag.visual) > 0.15) {
      dragFrameRef.current = requestAnimationFrame(animatePull);
    }
  }, [writePull]);

  const schedulePull = useCallback(() => {
    if (!dragFrameRef.current) dragFrameRef.current = requestAnimationFrame(animatePull);
  }, [animatePull]);

  useEffect(() => {
    if (mascotAssetAvailability.missing.length) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (mascotAssetAvailability.missing.length || reducedMotion) {
      setAssets(null);
      return undefined;
    }
    let cancelled = false;
    loadMascotAssets().then((result) => {
      if (!cancelled) setAssets(result.ready ? result.files : null);
    });
    return () => { cancelled = true; };
  }, [reducedMotion]);

  useEffect(() => {
    if (!assets || reducedMotion) return undefined;
    const workspace = workspaceRef.current;
    const brand = brandRef.current;
    if (!workspace || !brand) return undefined;
    const measure = () => {
      measureFrameRef.current = 0;
      const next = sceneGeometry(
        window.innerWidth,
        window.innerHeight,
        workspace.getBoundingClientRect(),
        brand.getBoundingClientRect(),
      );
      setGeometry((current) => sameGeometry(current, next) ? current : next);
    };
    const scheduleMeasure = () => {
      if (!measureFrameRef.current) measureFrameRef.current = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      if (phaseRef.current !== MONKEY_PHASES.READING) {
        scheduleMeasure();
        return;
      }
      const now = Date.now();
      if (!balanceRef.current && now - lastBalanceRef.current >= 6500) {
        lastBalanceRef.current = now;
        balanceRef.current = true;
        setBalanceReacting(true);
      }
    };
    measure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(workspace);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = 0;
    };
  }, [assets, brandRef, reducedMotion, workspaceRef]);

  useEffect(() => {
    if (geometry && !reducedMotion) {
      if (completedRef.current && phaseRef.current === MONKEY_PHASES.HIDDEN_TEASE) send({ type: 'RESTORE_READING' });
      return;
    }
    cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = 0;
    dragRef.current = null;
    resetBrand();
    balanceRef.current = false;
    setBalanceReacting(false);
    send({ type: 'RESET' });
  }, [geometry, reducedMotion, resetBrand, send]);

  useEffect(() => () => {
    cancelAnimationFrame(dragFrameRef.current);
    cancelAnimationFrame(measureFrameRef.current);
    resetBrand();
  }, [resetBrand]);

  const onPointerDown = (event) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, startY: event.clientY, distance: 0, target: 0, visual: 0 };
    send({ type: 'GRAB' });
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    drag.distance = Math.max(0, event.clientY - drag.startY);
    drag.target = resistedMonkeyPull(drag.distance);
    send({ type: 'PULL', distance: drag.distance });
    schedulePull();
  };

  const finishDrag = (event, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = 0;
    writePull(drag.visual);
    resetBrand();
    send({ type: 'RELEASE', distance: cancelled ? 0 : drag.distance });
  };

  const onActorAnimationEnd = (event) => {
    if (event.target !== actorRef.current) return;
    if (event.animationName === 'gutter-monkey-balance') {
      balanceRef.current = false;
      setBalanceReacting(false);
    } else if (event.animationName === FINITE_ANIMATION[phaseRef.current]) {
      send({ type: 'ANIMATION_END' });
    }
  };

  if (!assets || !geometry || reducedMotion) return null;
  // Keep the capture target mounted through the drag; removing it loses pointer capture.
  const teasing = [MONKEY_PHASES.HIDDEN_TEASE, MONKEY_PHASES.HOVERING, MONKEY_PHASES.DRAGGING, MONKEY_PHASES.REVEALING, MONKEY_PHASES.STRAINING].includes(phase);
  const activePose = POSE[phase];
  const showPaper = [MONKEY_PHASES.FALLING, MONKEY_PHASES.LANDED, MONKEY_PHASES.DUSTING_OFF].includes(phase);
  const showChair = [MONKEY_PHASES.PULLING_CHAIR, MONKEY_PHASES.SITTING, MONKEY_PHASES.READING].includes(phase);
  const style = {
    '--gutter-monkey-actor-x': `${geometry.actorX}px`,
    '--gutter-monkey-actor-y': `${geometry.actorY}px`,
    '--gutter-monkey-ground-y': `${geometry.groundY}px`,
    '--gutter-monkey-seat-y': `${geometry.seatY}px`,
    '--gutter-monkey-tail-x': `${geometry.tailX}px`,
    '--gutter-monkey-tail-y': `${geometry.tailY}px`,
    '--gutter-monkey-travel-x': `${geometry.travelX}px`,
    '--gutter-monkey-chair-x': `${geometry.chairX}px`,
    '--gutter-monkey-chair-y': `${geometry.chairY}px`,
  };

  return (
    <div aria-hidden="true" className="gutter-monkey-overlay" style={style}>
      {teasing && <button className={`gutter-monkey-teaser${phase === MONKEY_PHASES.HOVERING ? ' is-hovering' : ''}${dragRef.current ? ' is-grabbed' : ''}`} onLostPointerCapture={(event) => finishDrag(event, true)} onPointerCancel={(event) => finishDrag(event, true)} onPointerDown={onPointerDown} onPointerEnter={() => send({ type: 'ENTER' })} onPointerLeave={() => send({ type: 'LEAVE' })} onPointerMove={onPointerMove} onPointerUp={finishDrag} tabIndex={-1} type="button"><img alt="" draggable="false" src={assets['monkey-tail-hidden']} /></button>}
      {activePose && <div className={`gutter-monkey-actor is-${phase.toLowerCase().replaceAll('_', '-')}${balanceReacting ? ' is-balance-reacting' : ''}`} onAnimationEnd={onActorAnimationEnd} ref={actorRef}>
        <img className="gutter-monkey-pose" alt="" draggable="false" src={assets[activePose]} />
        {showPaper && <img className="gutter-monkey-paper" alt="" draggable="false" src={assets.newspaper} />}
      </div>}
      {showChair && <img className={`gutter-monkey-chair is-${phase.toLowerCase().replaceAll('_', '-')}`} alt="" draggable="false" src={assets.chair} />}
      {[MONKEY_PHASES.LANDED, MONKEY_PHASES.DUSTING_OFF].includes(phase) && <img className="gutter-monkey-dust" alt="" draggable="false" src={assets['dust-puff']} />}
    </div>
  );
}
