export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value) { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username ? u.href : ''; } catch { return ''; } }
export const paragraphs = value => String(value || '').split(/\n+/).filter(Boolean).map(p=>{const parts=p.split(/\s+•\s+/);return `<p>${escapeHtml(parts[0])}</p>`+(parts.length>1?`<ul>${parts.slice(1).map(v=>`<li>${escapeHtml(v)}</li>`).join('')}</ul>`:'');}).join('') || '<p><br></p>';
export function seedReport(items) {
  const lead = items.map(item=>`${item.title || 'Untitled'} — ${item.summary_lead || item.summary || item.master_summary || 'Summary unavailable.'}`).join('\n');
  return `<section data-kind="overview"><h1>Technology report</h1><h2>Executive summary</h2>${paragraphs(lead)}<h2>Cross-article analysis</h2><div data-kind="cross-analysis"><p>${items.length > 1 ? 'Preparing a comparison of the selected articles…' : 'Select at least two articles for cross-article analysis.'}</p></div></section>` + items.map(item=>{
    const image = safeUrl(item.image_url || item.image);
    const link = safeUrl(item.url || item.link);
    return `<section data-kind="article"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.src || item.source || '')} · ${escapeHtml(item.date || item.published_date || '')}</p>${image ? `<img src="${escapeHtml(image)}" alt="Article image" referrerpolicy="no-referrer">` : ''}<div><h3>Summary</h3><div data-kind="article-summary">${paragraphs(item.master_summary || item.summary || item.summary_lead)}</div><div data-kind="samsung-impact"><h3>Why this matters to Samsung</h3><div data-kind="impact-body">${paragraphs(item.why_matters || item.why_it_matters || item.insight || 'Preparing detailed Samsung impact analysis…')}</div></div><h3>Relevant teams</h3>${paragraphs(item.target_team || item.targeted_team || item.targeted_srid_team || 'Add the relevant Samsung teams.')}${link ? `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open original article</a></p>` : ''}</div></section>`;
  }).join('');
}
export function quotaClock(quota, now = Date.now()/1000) {
  if (!quota) return { remaining: 0, seconds: 0 };
  const seconds = Math.max(0, Math.ceil(quota.reset_at - now - (quota.clock_offset || 0)));
  // Refresh authoritative allowance when the first reservation expires.
  return { remaining: quota.remaining, seconds };
}
