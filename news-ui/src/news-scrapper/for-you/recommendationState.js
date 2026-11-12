export const emptyRecommendationState = Object.freeze({
  status: null,
  preferences: null,
  feed: null,
  loading: true,
  error: '',
});

export function recommendationGreeting(mode, name) {
  if (mode === 'learned') return `Personalized for ${name || 'you'}`;
  if (mode === 'configured') return 'Tuned from your choices';
  if (mode === 'paused') return 'Personalization paused';
  return 'Starter Mix';
}

export function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
