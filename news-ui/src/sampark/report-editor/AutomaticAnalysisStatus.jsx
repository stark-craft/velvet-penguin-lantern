import React from 'react';

export default function AutomaticAnalysisStatus({state, busy, onRetry, onApply}) {
  if(!state)return null;
  if(state.status==='loading')return <div className="sampark-report-analysis-status" role="status">Generating cross-article analysis… <small>Your Ask AI allowance is unchanged.</small></div>;
  return <div className="sampark-report-analysis-status">
    <div className="sampark-report-analysis-status-row"><span role="status">{state.message}</span>{state.status==='error' && <button onClick={onRetry} disabled={busy}>Retry analysis</button>}</div>
    {state.status==='proposal' && <details><summary>Review generated analysis</summary><p>{state.result.analysis}</p><button className="sampark-report-primary" onClick={()=>onApply(state.result,state.target,true)} disabled={busy}>Use generated analysis</button></details>}
  </div>;
}
