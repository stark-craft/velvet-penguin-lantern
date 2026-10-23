// Document-only presentation helpers; no LLM call or invented classification.
// Prefer extracted body text. Use category only when extraction has no match.
const TOPICS = [
  ['AI & Machine Learning', /\b(?:artificial intelligence|machine learning|generative ai|ai-powered|ai assisted|large language model|llms?|neural network|deep learning|ai)\b/i],
  ['Software Engineering', /\b(?:software engineering|software development|code generation|developer productivity|source code|quality assurance|continuous integration|ci\/cd)\b/i],
  ['Research & Innovation', /\b(?:research|innovation|r&d|prototype|experimental|discovery)\b/i],
  ['Security', /\b(?:cybersecurity|security|privacy|encryption|zero trust|secure coding)\b/i],
  ['Cloud & Infrastructure', /\b(?:cloud computing|infrastructure|data center|kubernetes|distributed systems)\b/i],
  ['Devices & Experiences', /\b(?:smartphone|television|smart tv|display|connected devices|user experience|smart glasses)\b/i],
  ['Automation', /\b(?:automation|robotics|autonomous|workflow orchestration)\b/i],
  ['Sustainability', /\b(?:sustainability|energy efficiency|emissions|environmental)\b/i],
];
const IMPACT = /\b(?:enabl(?:e|es|ing)|improv(?:e|es|ing)|support(?:s|ing)?|benefit(?:s)?|impact(?:s)?|help(?:s)?|reduc(?:e|es|ing)|accelerat(?:e|es|ing)|empower(?:s|ing)?|strengthen(?:s|ing)?|transform(?:s|ing)?)\b/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function documentTagOf(record) {
  const body = text(record?.body) || text(record?.record?.body) || text(record?.draft?.body);
  const summary = text(record?.summary) || text(record?.record?.summary);
  // Prefer terms present in actual extracted body, then summary.
  for (const content of [body, summary]) {
    if (!content) continue;
    const match = TOPICS.find(([, expression]) => expression.test(content));
    if (match) return match[0];
  }
  return text(record?.category) || 'Internal Document';
}

export function documentInsightOf(record) {
  const body = text(record?.body);
  const summary = text(record?.summary);
  const textToAnalyze = body.replace(/\s+/g, ' ');
  const sentences = textToAnalyze.split(/(?<=[.!?])\s+/).filter(Boolean);
  const grounded = sentences.find(sentence => sentence.length >= 55 && sentence.length <= 300 && IMPACT.test(sentence));
  // This is a selected quote from extracted text, not a generated prediction.
  if (grounded) return grounded;
  if (summary) return summary.slice(0, 520);
  return 'No extracted impact statement is available for this document.';
}

export function documentSignalOf(record) {
  if (!record?.id) return null;
  const owner = text(record.author) || text(record.ownerName) || text(record.owner_name);
  const sourceDocument = record.sourceDocument || record.source_document || null;
  const publishedAt = record.publishedAt || record.published_at || '';
  const image = text(record.cover?.url) || (record.cover
    ? '/internal-content/' + encodeURIComponent(record.id) + '/cover?v=' + encodeURIComponent(record.updatedAt || record.updated_at || '')
    : '');
  const tag = documentTagOf(record);
  return {
    id: record.id,
    canonical_link: 'internal://' + record.id,
    title: record.title || 'Untitled document',
    summary: record.summary || '',
    body: text(record.body).slice(0, 5000),
    why_matters: documentInsightOf(record),
    category: tag,
    keywords: [tag],
    source_count: 1,
    src: owner || 'SRI-D',
    source: owner || 'SRI-D',
    date: publishedAt ? String(publishedAt).slice(0, 10) : '',
    image_url: image,
    top_image: image,
    sources: [{
      name: owner || 'SRI-D Internal Contribution',
      title: sourceDocument?.name || record.title || 'Original document',
      date: publishedAt ? String(publishedAt).slice(0, 10) : '',
    }],
    sourceDocument,
    documentRecord: record,
    contentType: 'document_import',
  };
}
