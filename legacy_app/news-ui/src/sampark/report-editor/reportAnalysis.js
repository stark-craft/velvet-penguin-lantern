import { safeUrl } from './reportModel.js';

export function analysisInputs(items) {
  return items.map(item=>({
    title:String(item.title || '').trim().slice(0,1000) || 'Untitled article',
    summary:String(item.master_summary || item.summary || item.summary_lead || '').trim().slice(0,20000),
    summary_truncated:!!item.summary_truncated || String(item.master_summary || item.summary || item.summary_lead || '').trim().length>20000,
    source:String(item.src || item.source || '').trim().slice(0,500),
    date:String(item.date || item.published_date || '').trim().slice(0,80),
    url:safeUrl(item.url || item.link).slice(0,2048),
  }));
}

export function currentAnalysisInputs(root, originalItems) {
  const original=analysisInputs(originalItems);
  return [...root.querySelectorAll('section[data-kind=article]')].map((article,index)=>currentAnalysisInput(article,original[index]));
}

export function currentAnalysisInput(article, original={}) {
  const metadata=article.querySelector(':scope > p')?.innerText.split(' · ') || [];
  return analysisInputs([{
    title:article.querySelector('h2')?.innerText || original.title,
    summary:article.querySelector('[data-kind=article-summary]')?.innerText ?? original.summary,
    src:metadata.length>1?metadata.slice(0,-1).join(' · '):original.source,
    date:metadata.length>1?metadata.at(-1):original.date,
    url:article.querySelector('a[href]')?.getAttribute('href') || original.url,
  }])[0];
}

export const analysisSignature = articles => JSON.stringify(articles);

export function canApplyAnalysis(root, target, currentArticles, replaceEdited=false) {
  return !!target?.body && root.contains(target.body)
    && (replaceEdited || target.body.innerHTML===target.before)
    && analysisSignature(currentArticles)===target.signature;
}
