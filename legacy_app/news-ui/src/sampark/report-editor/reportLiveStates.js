// Transient visual state for AI-authored report sections.
// Only data-* attributes are added: no text nodes, markup, or controls are
// inserted into the contentEditable report. The editor strips these on save.
const ATTRIBUTES = ['data-sr-ai-state', 'data-sr-ai-label', 'data-sr-ai-detail'];

function clearState(node) {
  for (const attribute of ATTRIBUTES) node.removeAttribute(attribute);
}

function setState(node, state, label, detail = '') {
  if (!node) return;
  node.setAttribute(ATTRIBUTES[0], state);
  node.setAttribute(ATTRIBUTES[1], label);
  if (detail) node.setAttribute(ATTRIBUTES[2], detail);
  else node.removeAttribute(ATTRIBUTES[2]);
}

function impactBox(root, body) {
  if (!body || !root.contains(body) || typeof body.closest !== 'function') return null;
  const box = body.closest('[data-kind="samsung-impact"]');
  return box && root.contains(box) ? box : null;
}

export function clearReportLiveStates(root) {
  if (!root) return;
  root.querySelectorAll('[data-sr-ai-state]').forEach(clearState);
}

export function stripReportLiveStates(clone) {
  clearReportLiveStates(clone);
}

export function updateReportLiveStates(root, analysis, impact) {
  if (!root) return;
  clearReportLiveStates(root);

  const comparison = root.querySelector('[data-kind="cross-analysis"]');
  if (comparison && analysis?.status === 'loading') {
    setState(comparison, 'loading', 'Comparing selected articles…');
  } else if (comparison && analysis?.status === 'error') {
    setState(comparison, 'error', 'Cross-article analysis needs attention', String(analysis.message || 'Analysis could not be generated. Use Retry analysis above.'));
  } else if (comparison && analysis?.status === 'proposal') {
    setState(comparison, 'review', 'AI suggestion available for review', 'Your existing edits were kept. Review the suggestion above.');
  }

  // The impact queue starts after cross-article analysis. Its visual states
  // never imply that a request already began or that a section completed.
  if (analysis?.status === 'loading') {
    root.querySelectorAll('[data-kind="samsung-impact"]').forEach((box) => {
      setState(box, 'queued', 'Samsung impact is queued…', 'This section will be generated after cross-article analysis.');
    });
  }

  const pending = impact?.pending;
  if (pending) {
    const targets = Array.isArray(pending.targets) ? pending.targets : [];
    const active = Math.max(0, Number(pending.index || 1) - 1);
    for (let index = active + 1; index < targets.length; index++) {
      const box = impactBox(root, targets[index]);
      if (box) setState(box, 'queued', 'Waiting in Samsung impact queue…');
    }
    const activeBox = impactBox(root, pending.body);
    if (activeBox) setState(activeBox, 'loading', 'Generating Samsung impact…');
  }

  // An individual article's error or review requirement takes precedence over
  // queued/loading states. The original generated/editable text stays intact.
  for (const issue of impact?.issues || []) {
    const box = impactBox(root, issue?.target?.body);
    // A batch-level error (for example, too many selected articles) has no
    // single article target. Surface it in the first impact section as well.
    const display = box || (issue.status === 'error' && !issue?.target
      ? root.querySelector('[data-kind="samsung-impact"]') : null);
    if (!display) continue;
    if (issue.status === 'error') {
      setState(display, 'error', 'Samsung impact could not finish',
        String(issue.message || 'Please use Retry Samsung impact above.').slice(0, 500));
    } else if (issue.status === 'proposal') {
      setState(display, 'review', 'Samsung impact ready for review', 'Your existing edits were kept. Review the suggestion above.');
    }
  }
}
