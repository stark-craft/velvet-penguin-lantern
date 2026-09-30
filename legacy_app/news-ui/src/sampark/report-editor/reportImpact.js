import { safeUrl } from './reportModel.js';
import { currentAnalysisInput, analysisSignature } from './reportAnalysis.js';

// Add structural wrappers to older private drafts without changing their words.
export function prepareImpactSections(root) {
  root.querySelectorAll('section[data-kind=article]').forEach(article=>{
    const heading=[...article.querySelectorAll('h3')].find(h=>h.textContent.trim()==='Why this matters to Samsung');
    if(!heading || heading.closest('[data-kind=samsung-impact]'))return;
    const section=document.createElement('div');section.dataset.kind='samsung-impact';
    const body=document.createElement('div');body.dataset.kind='impact-body';
    heading.before(section);section.append(heading,body);
    while(section.nextSibling && !/^H[1-4]$/.test(section.nextSibling.nodeName))body.append(section.nextSibling);
  });
}

export function reportImpactArticles(root) {
  return [...root.querySelectorAll('section[data-kind=article]')].map(article=>({
    article,
    title:article.querySelector('h2')?.textContent.trim() || 'Untitled article',
    body:article.querySelector('[data-kind=impact-body]'),
  })).filter(item=>item.body);
}

export function impactContext(item) {
  const links=[...item.article.querySelectorAll('a[href]')].map(a=>safeUrl(a.getAttribute('href'))).filter(Boolean);
  return `${item.article.innerText.slice(0,28000)}\n\nOriginal source URLs:\n${links.join('\n')}`.slice(0,30000);
}

export function canApplyImpact(root, target) {
  return !!target?.body && root.contains(target.body) && target.body.innerHTML===target.before
    && (target.context===undefined || impactContext(target)===target.context);
}

export function automaticImpactTarget(item) {
  const input=currentAnalysisInput(item.article);
  return {...item,input,before:item.body.innerHTML,signature:analysisSignature([input])};
}

export function canApplyAutomaticImpact(root, target, replaceEdited=false) {
  return !!target?.body && root.contains(target.body) && root.contains(target.article)
    && (replaceEdited || target.body.innerHTML===target.before)
    && analysisSignature([currentAnalysisInput(target.article)])===target.signature;
}
