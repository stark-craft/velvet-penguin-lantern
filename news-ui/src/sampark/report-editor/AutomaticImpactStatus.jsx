import React from 'react';

export default function AutomaticImpactStatus({state,busy,onRetry,onApply,onKeep}) {
  if(!state)return null;
  return <div className="sampark-report-analysis-status" aria-label="Automatic Samsung impact">
    {state.pending && <div role="status">Writing Samsung impact · {state.pending.index} of {state.pending.total}<small>{state.pending.title} · Your Ask AI allowance is unchanged.</small></div>}
    {state.issues.map((issue,index)=><div key={index}>
      <div className="sampark-report-analysis-status-row"><span role="status">{issue.target?.title && <strong>{issue.target.title}: </strong>}{issue.message}</span></div>
      {issue.status==='proposal' && <details><summary>Review generated Samsung impact</summary><p>{issue.result.impact}</p><button className="sampark-report-primary" onClick={()=>onApply(issue)} disabled={busy}>Use generated Samsung impact</button><button onClick={()=>onKeep(issue)} disabled={busy}>Keep my edits</button></details>}
    </div>)}
    {!state.pending && state.issues.some(issue=>issue.status==='error') && <button onClick={onRetry} disabled={busy}>Retry Samsung impact</button>}
  </div>;
}
