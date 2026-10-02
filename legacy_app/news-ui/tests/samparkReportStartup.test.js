import test from 'node:test';
import assert from 'node:assert/strict';
import {startReportIntelligence} from '../src/sampark/report-editor/reportStartup.js';

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('report startup waits for cross-analysis completion before beginning impacts',async()=>{
  const analysis=deferred();
  const impacts=deferred();
  const calls=[];
  const startup=startReportIntelligence({
    analysis:async()=>{calls.push('analysis start');await analysis.promise;calls.push('analysis done');},
    impacts:async()=>{calls.push('impacts start');await impacts.promise;calls.push('impacts done');},
    cancelPending:()=>calls.push('cancel'),
  });
  assert.deepEqual(calls,[]);
  await Promise.resolve();
  assert.deepEqual(calls,['analysis start']);
  analysis.resolve();
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['analysis start','analysis done','impacts start']);
  impacts.resolve();await startup.done;
  assert.deepEqual(calls,['analysis start','analysis done','impacts start','impacts done']);
});

test('a handled analysis failure still releases the article impact queue',async()=>{
  const response=deferred();
  const calls=[];
  const startup=startReportIntelligence({
    analysis:async()=>{
      calls.push('analysis start');
      try{await response.promise;}catch(error){calls.push(error.message);}
    },
    impacts:async()=>calls.push('impacts start'),
    cancelPending:()=>{},
  });
  await Promise.resolve();
  assert.deepEqual(calls,['analysis start']);
  response.reject(new Error('analysis unavailable'));await startup.done;
  assert.deepEqual(calls,['analysis start','analysis unavailable','impacts start']);
});

test('single-article reports proceed when comparison has no work',async()=>{
  const calls=[];
  const startup=startReportIntelligence({
    analysis:async()=>calls.push('comparison skipped'),
    impacts:async()=>calls.push('article impact'),
    cancelPending:()=>{},
  });
  await startup.done;
  assert.deepEqual(calls,['comparison skipped','article impact']);
});

test('closing or loading a saved draft cancels late startup continuation',async()=>{
  for(const outcome of ['success','failure']) {
    const response=deferred();
    const calls=[];
    const startup=startReportIntelligence({
      analysis:async()=>{try{await response.promise;}catch{}},
      impacts:async()=>calls.push('impact started in replaced document'),
      cancelPending:()=>calls.push('invalidate analysis and impact queue'),
    });
    await Promise.resolve();
    startup.cancel();startup.cancel();
    if(outcome==='success')response.resolve();else response.reject(new Error('late failure'));
    await startup.done;
    assert.equal(startup.cancelled,true);
    assert.deepEqual(calls,['invalidate analysis and impact queue']);
  }
});

test('StrictMode cleanup skips the discarded mount and preserves the active startup order',async()=>{
  const response=deferred();
  const calls=[];
  const options={
    analysis:async()=>{calls.push('analysis');await response.promise;},
    impacts:async()=>calls.push('impacts'),
    cancelPending:()=>calls.push('cancel pending'),
  };
  const discarded=startReportIntelligence(options);
  discarded.cancel();
  const active=startReportIntelligence(options);
  await Promise.resolve();
  assert.deepEqual(calls,['cancel pending','analysis']);
  response.resolve();await Promise.all([discarded.done,active.done]);
  assert.deepEqual(calls,['cancel pending','analysis','impacts']);
  active.cancel();
  assert.deepEqual(calls,['cancel pending','analysis','impacts','cancel pending']);
});
