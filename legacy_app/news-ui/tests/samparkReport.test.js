import test from 'node:test';
import assert from 'node:assert/strict';
import {seedReport, safeUrl, quotaClock, paragraphs} from '../src/sampark/report-editor/reportModel.js';
import {validateReportImage} from '../src/sampark/report-editor/reportImages.js';
import {canApplyImpact, impactContext, automaticImpactTarget, canApplyAutomaticImpact} from '../src/sampark/report-editor/reportImpact.js';
import {analysisInputs, analysisSignature, canApplyAnalysis} from '../src/sampark/report-editor/reportAnalysis.js';
test('report seed escapes article text and rejects executable image/link URLs',()=>{
 const html=seedReport([{title:'<script>bad</script>',summary:'<img onerror=x>',image_url:'javascript:x',url:'javascript:x'}]);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src="javascript'));assert.ok(html.includes('&lt;script&gt;'));
});
test('local image import allows supported pictures and rejects large or executable files',()=>{
 for(const type of ['image/png','image/jpeg','image/webp']) {
   assert.doesNotThrow(()=>validateReportImage({type,size:999999}));
 }
 assert.throws(()=>validateReportImage({type:'image/svg+xml',size:100}),/PNG, JPEG or WebP/);
 assert.throws(()=>validateReportImage({type:'image/png',size:1000001}),/smaller than 1 MB/);
});
test('overview and analysis flow together, and stored Samsung implications survive',()=>{
 const html=seedReport([{title:'One',master_summary:'Source summary',why_matters:'Samsung implication',src:'Publisher'}]);
 assert.equal((html.match(/<section/g)||[]).length,2);
 assert.ok(html.indexOf('Cross-article analysis')<html.indexOf('</section>'));
 assert.ok(html.includes('Samsung implication'));
});
test('every article has an editable Samsung impact section after the summary',()=>{
 const html=seedReport([{title:'One',summary:'Summary one',why_matters:'Stored insight'},{title:'Two',summary:'Summary two'}]);
 assert.equal((html.match(/data-kind="samsung-impact"/g)||[]).length,2);
 assert.equal((html.match(/data-kind="impact-body"/g)||[]).length,2);
 assert.ok(html.indexOf('Summary one')<html.indexOf('Stored insight'));
 assert.ok(html.includes('Preparing detailed Samsung impact'));
 assert.ok(!html.includes('Use Samsung impact in the toolbar'));
 assert.equal(paragraphs('First\n\n<script>unsafe</script>'),'<p>First</p><p>&lt;script&gt;unsafe&lt;/script&gt;</p>');
});
test('Samsung impact uses current article text and refuses to overwrite newer edits',()=>{
 const body={innerHTML:'Original insight'};
 const root={contains:node=>node===body};
 const target={body,before:'Original insight'};
 assert.equal(canApplyImpact(root,target),true);
 body.innerHTML='My new edit';assert.equal(canApplyImpact(root,target),false);
 assert.equal(canApplyImpact({contains:()=>false},target),false);
 assert.equal(canApplyImpact(root,null),false);
 const article={innerText:'Current edited summary',querySelectorAll:()=>[{getAttribute:()=> 'https://example.org/article'},{getAttribute:()=> 'javascript:bad'}]};
 assert.ok(impactContext({article}).includes('Current edited summary'));
 assert.ok(impactContext({article}).includes('https://example.org/article'));
 assert.ok(!impactContext({article}).includes('javascript:'));
 body.innerHTML=target.before;
 const contextTarget={...target,article,context:impactContext({article})};
 assert.equal(canApplyImpact(root,contextTarget),true);
 article.innerText='Changed source summary';
 assert.equal(canApplyImpact(root,contextTarget),false);
});
test('quota countdown reaches zero without inventing extra allowance',()=>{
 assert.deepEqual(quotaClock({remaining:0,reset_at:100},90),{remaining:0,seconds:10});
 assert.deepEqual(quotaClock({remaining:0,reset_at:100},101),{remaining:0,seconds:0});
 assert.equal(safeUrl('https://example.org/article'),'https://example.org/article');
 assert.equal(safeUrl('https://user:password@example.org/'),'');
});
test('automatic cross-article analysis uses detailed summaries rather than card captions',()=>{
 const input=analysisInputs([{title:'First',summary_lead:'Short caption',master_summary:'Full summary with technical detail',url:'https://example.org/first'},{title:'Second',summary:'Other full summary',url:'javascript:bad'}]);
 assert.equal(input[0].summary,'Full summary with technical detail');
 assert.equal(input[1].summary,'Other full summary');
 assert.equal(input[1].url,'');
 const long=analysisInputs([{title:'   ',summary:'A'.repeat(20001)}])[0];
 assert.equal(long.title,'Untitled article');
 assert.equal(long.summary.length,20000);
 assert.equal(long.summary_truncated,true);
 const html=seedReport([{title:'First',summary:'First full summary'},{title:'Second',summary:'Second full summary'}]);
 assert.ok(html.includes('data-kind="cross-analysis"'));
 assert.ok(html.includes('Preparing a comparison'));
 assert.ok(!html.includes('Use Ask AI to generate a source-backed analysis'));
 assert.equal((html.match(/data-kind="article-summary"/g)||[]).length,2);
 assert.ok(seedReport([{title:'One'}]).includes('Select at least two articles'));
});
test('automatic analysis protects changed documents and requires explicit replacement of edits',()=>{
 const body={innerHTML:'Preparing comparison'};
 const root={contains:node=>node===body};
 const articles=analysisInputs([{title:'One',summary:'Detailed one'},{title:'Two',summary:'Detailed two'}]);
 const target={body,before:body.innerHTML,signature:analysisSignature(articles)};
 assert.equal(canApplyAnalysis(root,target,articles),true);
 body.innerHTML='My own analysis';
 assert.equal(canApplyAnalysis(root,target,articles),false);
 assert.equal(canApplyAnalysis(root,target,articles,true),true);
 const changed=articles.map(a=>({...a,summary:'Changed summary'}));
 assert.equal(canApplyAnalysis(root,target,changed,true),false);
 assert.equal(canApplyAnalysis({contains:()=>false},target,articles,true),false);
});
test('automatic Samsung impact uses the full article summary and protects section and source edits separately',()=>{
 const body={innerHTML:'Stored short insight'};
 const values={h2:{innerText:'Article title'},':scope > p':{innerText:'Publisher · 2026-09-30'},'[data-kind=article-summary]':{innerText:'Full source summary'},'a[href]':{getAttribute:()=> 'https://example.org/article'}};
 const article={querySelector:selector=>values[selector]};
 const root={contains:node=>[article,body].includes(node)};
 const target=automaticImpactTarget({article,body,title:'Article title'});
 assert.equal(target.input.summary,'Full source summary');
 assert.equal(target.input.source,'Publisher');
 assert.equal(target.input.date,'2026-09-30');
 assert.equal(canApplyAutomaticImpact(root,target),true);
 body.innerHTML='My own Samsung analysis';
 assert.equal(canApplyAutomaticImpact(root,target),false);
 assert.equal(canApplyAutomaticImpact(root,target,true),true);
 values['[data-kind=article-summary]'].innerText='Changed source evidence';
 assert.equal(canApplyAutomaticImpact(root,target,true),false);
 assert.equal(canApplyAutomaticImpact({contains:()=>false},target,true),false);
 assert.equal(canApplyAutomaticImpact(root,null),false);
});
