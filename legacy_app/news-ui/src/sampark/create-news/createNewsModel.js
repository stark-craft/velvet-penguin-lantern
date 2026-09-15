export const URL_LIMIT = 20;

export const SRI_CREATE_OPTIONS = Object.freeze([
  {
    id: 'story',
    label: 'Create Story',
    icon: 'note',
    description: 'Start with a blank canvas or import a PDF or Word document.',
  },
  {
    id: 'leadership',
    label: 'Leadership Message',
    icon: 'star',
    description: 'Prepare a leadership message for the SRI-D feature area.',
  },
  {
    id: 'announcement',
    label: 'Announcement',
    icon: 'megaphone',
    description: 'Create a clear internal notice with an optional cover image.',
  },
]);

export const STORY_TEMPLATES = Object.freeze([
  { id: 'two-column', label: 'Two Column', description: 'Image and key details beside the full story.' },
  { id: 'list-view', label: 'List View', description: 'A structured, easy-to-scan story layout.' },
  { id: 'feature-card', label: 'Feature Card', description: 'A strong image-led feature presentation.' },
  { id: 'text-top', label: 'Text Top', description: 'Headline and context before the image.' },
]);

export function blankCreateForm(contentType = 'story') {
  return {
    id: '',
    title: '',
    summary: '',
    body: '',
    category: contentType === 'announcement' ? 'Announcement' : contentType === 'leadership' ? 'Leadership' : 'General',
    author: '',
    team: '',
    layout: contentType === 'story' ? 'two-column' : contentType === 'leadership' ? 'feature-card' : 'text-top',
    displaySection: contentType === 'leadership' ? 'hero' : 'srid',
  };
}

export function formFromContribution(record = {}) {
  const contentType = ['leadership', 'announcement'].includes(record.contentType) ? record.contentType : 'story';
  return {
    ...blankCreateForm(contentType),
    id: record.id || '',
    title: record.title || '',
    summary: record.summary || '',
    body: record.body || '',
    category: record.category || blankCreateForm(contentType).category,
    author: record.author || '',
    team: record.team || '',
    layout: record.layout || blankCreateForm(contentType).layout,
    displaySection: record.displaySection || blankCreateForm(contentType).displaySection,
  };
}

export function cleanCreateSnapshot(form, coverPreview = '') {
  return {
    title: form.title || '',
    summary: form.summary || '',
    body: form.body || '',
    category: form.category || '',
    author: form.author || '',
    team: form.team || '',
    layout: form.layout || '',
    displaySection: form.displaySection || '',
    coverPreview: coverPreview || '',
  };
}

export function countEnteredUrls(value = '') {
  return String(value)
    .split(/[\s,]+/)
    .filter((candidate) => /^https?:\/\//i.test(candidate.trim()))
    .length;
}

export function contributionFromBriefing(article = {}) {
  const sources = Array.isArray(article.sources) ? article.sources : [];
  const source = article.src || article.source || sources[0]?.name || '';
  const body = article.full_contents
    || article.full_content
    || article.master_summary
    || article.summary
    || article.snippet
    || '';
  return {
    ...blankCreateForm('story'),
    title: String(article.title || article.headline || '').slice(0, 120),
    summary: String(article.summary || article.master_summary || article.snippet || '').slice(0, 300),
    body: String(body),
    category: article.category || article.topic || 'General',
    author: source,
  };
}

export function previewParagraphs(body = '', limit = 4) {
  const paragraphs = String(body)
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return paragraphs.slice(0, limit);
}

export function documentIsPdf(sourceDocument) {
  return sourceDocument?.type === 'application/pdf' || /\.pdf$/i.test(sourceDocument?.name || '');
}
