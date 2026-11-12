// Analysis reports expected request failures in the editor and resolves either
// way. Its completion, rather than a loading-state render, releases the impact
// queue. Scheduling the start in a microtask skips a discarded StrictMode mount.
export function startReportIntelligence({analysis, impacts, cancelPending}) {
  let cancelled=false;
  const done=Promise.resolve().then(async()=>{
    if(cancelled)return;
    await analysis();
    if(cancelled)return;
    await impacts();
  });
  return {
    done,
    get cancelled(){return cancelled;},
    cancel(){
      if(cancelled)return;
      cancelled=true;
      cancelPending();
    },
  };
}
