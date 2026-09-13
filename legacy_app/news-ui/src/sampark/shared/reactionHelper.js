// Pure helpers for All News hydration, used in AllNewsPage and tested behaviorally
export function getCurrentVote(votes, item, reactionsHydrated) {
  const key = item ? (item.article_id || item.id || item.canonical_link || item.link || item.url || item.title || '') : '';
  // Prefer hydrated votes, fallback to trustworthy item.reactions
  const snap = votes[key];
  if (snap) return snap;
  if (item && item.reactions) {
    return {
      like_count: Number(item.reactions.like_count || 0),
      dislike_count: Number(item.reactions.dislike_count || 0),
      viewer_reaction: item.reactions.viewer_reaction || 'neutral',
    };
  }
  if (!reactionsHydrated) return null;
  return { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
}

export function isReactionReady(votes, item, reactionsHydrated) {
  const key = item ? (item.article_id || item.id || item.canonical_link || item.link || item.url || item.title || '') : '';
  // Use articleKey logic is more accurate, but for helper we use simple id
  // In production, AllNewsPage uses articleKey; here we approximate
  return Boolean(reactionsHydrated || (votes && votes[key]) || (item && item.reactions));
}

export function computeOptimisticVote(prevSnap, currentReaction, nextReaction) {
  let lc = Number(prevSnap.like_count || 0);
  let dc = Number(prevSnap.dislike_count || 0);
  if (currentReaction === 'like') lc = Math.max(0, lc - 1);
  if (currentReaction === 'dislike') dc = Math.max(0, dc - 1);
  if (nextReaction === 'like') lc += 1;
  if (nextReaction === 'dislike') dc += 1;
  return { like_count: lc, dislike_count: dc, viewer_reaction: nextReaction };
}
