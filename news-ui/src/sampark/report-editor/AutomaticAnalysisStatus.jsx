import React from 'react';
import { Sparkles } from 'lucide-react';

export default function AutomaticAnalysisStatus({state, busy, onRetry, onApply}) {
  if (!state) return null;

  if (state.status === 'loading') {
    return (
      <div className="sampark-report-analysis-status" role="status" aria-label="Automatic cross-article analysis">
        <div className="sr-generation-status">
          <Sparkles size={16} aria-hidden="true"/>
          <span className="sr-generation-label">Generating cross-article analysis…</span>
          <span className="sr-generation-pulse" aria-hidden="true"/>
          <small className="sr-generation-note">Your Ask AI allowance is unchanged.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="sampark-report-analysis-status">
      <div className="sampark-report-analysis-status-row">
        <span role="status">{state.message}</span>
        {state.status === 'error' && <button onClick={onRetry} disabled={busy} type="button">Retry analysis</button>}
      </div>
      {state.status === 'proposal' && (
        <details>
          <summary>Review generated analysis</summary>
          <p>{state.result.analysis}</p>
          <button className="sampark-report-primary" onClick={()=>onApply(state.result,state.target,true)} disabled={busy} type="button">Use generated analysis</button>
        </details>
      )}
    </div>
  );
}
