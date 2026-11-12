export const MONKEY_PHASES = Object.freeze({
  HIDDEN_TEASE: 'HIDDEN_TEASE',
  HOVERING: 'HOVERING',
  DRAGGING: 'DRAGGING',
  REVEALING: 'REVEALING',
  STRAINING: 'STRAINING',
  RESETTING: 'RESETTING',
  SLIPPING: 'SLIPPING',
  FALLING: 'FALLING',
  LANDED: 'LANDED',
  DUSTING_OFF: 'DUSTING_OFF',
  WALKING: 'WALKING',
  DRAGGING_NEWSPAPER: 'DRAGGING_NEWSPAPER',
  PULLING_CHAIR: 'PULLING_CHAIR',
  SITTING: 'SITTING',
  READING: 'READING',
});

export const MONKEY_BODY_WIDTH = 160;
export const MONKEY_BODY_HEIGHT = 205;
export const MONKEY_CHAIR_WIDTH = 145;
export const MONKEY_MIN_GUTTER = Math.max(180, MONKEY_BODY_WIDTH + 20);
export const MONKEY_STRAIN_DISTANCE = 135;
export const MONKEY_REVEAL_DISTANCE = 80;
export const MONKEY_SLIP_DISTANCE = 205;

export function measureMonkeyGutters(viewportWidth, workspaceRect) {
  const left = Math.max(0, workspaceRect?.left || 0);
  const right = Math.max(0, viewportWidth - (workspaceRect?.right || viewportWidth));
  return {
    left,
    right,
    enabled: viewportWidth >= 2000 && Math.min(left, right) >= MONKEY_MIN_GUTTER,
  };
}

// Saturating pull: the first 100 pointer pixels move the artwork only ~64 pixels.
export function resistedMonkeyPull(pointerDistance) {
  const distance = Math.max(0, Number(pointerDistance) || 0);
  return 132 * (1 - Math.exp(-distance / 150));
}

const AFTER_ANIMATION = Object.freeze({
  [MONKEY_PHASES.RESETTING]: MONKEY_PHASES.HIDDEN_TEASE,
  [MONKEY_PHASES.SLIPPING]: MONKEY_PHASES.FALLING,
  [MONKEY_PHASES.FALLING]: MONKEY_PHASES.LANDED,
  [MONKEY_PHASES.LANDED]: MONKEY_PHASES.DUSTING_OFF,
  [MONKEY_PHASES.DUSTING_OFF]: MONKEY_PHASES.WALKING,
  [MONKEY_PHASES.WALKING]: MONKEY_PHASES.DRAGGING_NEWSPAPER,
  [MONKEY_PHASES.DRAGGING_NEWSPAPER]: MONKEY_PHASES.PULLING_CHAIR,
  [MONKEY_PHASES.PULLING_CHAIR]: MONKEY_PHASES.SITTING,
  [MONKEY_PHASES.SITTING]: MONKEY_PHASES.READING,
});

export function nextMonkeyPhase(phase, event) {
  if (event.type === 'RESET') return MONKEY_PHASES.HIDDEN_TEASE;
  if (event.type === 'RESTORE_READING') return MONKEY_PHASES.READING;
  if (event.type === 'ANIMATION_END') return AFTER_ANIMATION[phase] || phase;
  if (event.type === 'ENTER' && phase === MONKEY_PHASES.HIDDEN_TEASE) return MONKEY_PHASES.HOVERING;
  if (event.type === 'LEAVE' && phase === MONKEY_PHASES.HOVERING) return MONKEY_PHASES.HIDDEN_TEASE;
  if (event.type === 'GRAB' && (phase === MONKEY_PHASES.HIDDEN_TEASE || phase === MONKEY_PHASES.HOVERING)) return MONKEY_PHASES.DRAGGING;
  if (event.type === 'PULL' && (phase === MONKEY_PHASES.DRAGGING || phase === MONKEY_PHASES.REVEALING || phase === MONKEY_PHASES.STRAINING)) {
    return event.distance >= MONKEY_STRAIN_DISTANCE
      ? MONKEY_PHASES.STRAINING
      : event.distance >= MONKEY_REVEAL_DISTANCE ? MONKEY_PHASES.REVEALING : MONKEY_PHASES.DRAGGING;
  }
  if (event.type === 'RELEASE' && (phase === MONKEY_PHASES.DRAGGING || phase === MONKEY_PHASES.REVEALING || phase === MONKEY_PHASES.STRAINING)) {
    return event.distance >= MONKEY_SLIP_DISTANCE ? MONKEY_PHASES.SLIPPING : MONKEY_PHASES.RESETTING;
  }
  return phase;
}
