import React from 'react';
import { Sparkles } from 'lucide-react';

export default function AutomaticImpactStatus({state,busy,onRetry,onApply,onKeep}) {
  if (!state) return null;
  const pending = state.pending;
  const total = Math.max(1, Number(pending?.total) || 1);
  const finished = Math.max(0, Math.min(total, Number(pending?.index || 1) - 1));
  const percent = Math.round((finished / total) * 100);

  return (
    <div className="sampark-report-analysis-status" aria-label="Automatic Samsung impact">
      {pending && (
        <div className="sr-generation-status" role="status">
          <Sparkles size={16} aria-hidden="true"/>
          <span className="sr-generation-label">Writing Samsung impact</span>
          <span className="sr-generation-progress" role="progressbar" aria-label="Samsung impact sections completed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}>
            <span className="sr-generation-track"><span className="sr-generation-fill" style={{width:`${percent}%`}}/></span>
            <span className="sr-generation-tally">{pending.index} of {total}</span>
          </span>
          <small className="sr-generation-note">{pending.title} · Your Ask AI allowance is unchanged.</small>
        </div>
      )}
      {state.issues.map((issue,index)=>(
        <div key={index}>
          <div className="sampark-report-analysis-status-row">
            <span role="status">{issue.target?.title && <strong>{issue.target.title}: </strong>}{issue.message}</span>
          </div>
          {issue.status === 'proposal' && (
            <details>
              <summary>Review generated Samsung impact</summary>
              <p>{issue.result.impact}</p>
              <button className="sampark-report-primary" onClick={()=>onApply(issue)} disabled={busy} type="button">Use generated Samsung impact</button>
              <button onClick={()=>onKeep(issue)} disabled={busy} type="button">Keep my edits</button>
            </details>
          )}
        </div>
      ))}
      {!pending && state.issues.some(issue=>issue.status==='error') && (
        <button onClick={onRetry} disabled={busy} type="button">Retry Samsung impact</button>
      )}
    </div>
  );
}
