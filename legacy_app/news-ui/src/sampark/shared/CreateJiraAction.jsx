import React, { useEffect, useMemo, useState } from 'react';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';
import { createJiraNewsTicket } from '../../news-scrapper/api.js';
import { sanitizeExternalUrl } from './safeLink.js';

/**
 * Reusable action for existing batch-selection surfaces.
 * One click creates one Jira issue containing the entire selected set.
 */
export default function CreateJiraAction({
  items = [],
  disabled = false,
  buttonClassName = 'btn-dark-secondary h-9',
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const selectionSignature = useMemo(
    () => items.map(articleKey).join('|'),
    [items],
  );

  useEffect(() => {
    setResult(null);
    setError('');
  }, [selectionSignature]);

  const create = async () => {
    if (!items.length || busy || disabled || result) return;
    setBusy(true);
    setError('');
    try {
      const created = await createJiraNewsTicket(items);
      if (!created?.key || !sanitizeExternalUrl(created.url)) {
        throw new Error('Jira did not return a usable issue link. Check Jira before retrying.');
      }
      setResult(created);
    } catch (err) {
      setError(err?.message || 'Could not create the Jira ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        aria-busy={busy}
        className={buttonClassName}
        disabled={!items.length || busy || disabled || Boolean(result)}
        onClick={create}
        type="button"
      >
        {busy ? 'Creating Jira…' : 'Create Jira'}
      </button>
      {result && (
        <span className="jira-create-result" role="status" style={{ fontSize: 12 }}>
          {result.status === 'partial' ? 'Jira created (image warnings)' : 'Jira created'}:
          {' '}
          <a
            href={sanitizeExternalUrl(result.url)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline', fontWeight: 700 }}
          >
            Open {result.key}
          </a>
          {result.warnings?.length > 0 && <span title={result.warnings.join('\n')}> · {result.warnings.length} warning(s)</span>}
        </span>
      )}
      {error && <span role="alert" style={{ color: '#fda4af', fontSize: 12 }}>{error}</span>}
    </>
  );
}
