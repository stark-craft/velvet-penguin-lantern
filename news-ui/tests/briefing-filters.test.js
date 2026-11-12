import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, emptyFilters } from '../src/news-scrapper/screens/briefingFilters.js';
const ai = {id:'ai', title:'A new AI chip', source:'Source A', category:'AI Models', region:'Global', date:'2026-09-10', importance:90, is_fresh:true, source_count:3, image_url:'/cover.jpg', keywords_found:['AI'], verticals:['technology']};
const tv = {id:'tv', title:'A television service', source:'Source B', category:'Broadcasting', region:'India', date:'2026-09-09', importance:50, source_count:1, keywords_found:['television'], verticals:['broadcast']};
const items = [ai,tv];
const run = patch => applyFilters(items,{...emptyFilters,...patch},new Set(['ai']));
test('briefing filters combine search, facets and workflow without changing article identity',()=>{
 assert.deepEqual(run({}),items);
 for(const patch of [{query:' AI '},{category:'AI Models'},{source:'Source A'},{region:'Global'},{date:'2026-09-10'},{scope:'technology'},{keyword:'ai'},{signal:'high'},{fresh:'fresh'},{cluster:'multi'},{image:'with'},{selected:'selected'}]) assert.deepEqual(run(patch),[ai]);
 for(const patch of [{scope:'broadcast'},{signal:'normal'},{image:'without'},{selected:'unselected'}]) assert.deepEqual(run(patch),[tv]);
 assert.deepEqual(run({query:'AI',source:'Source B'}),[]);
 assert.deepEqual(run({category:'AI Models',keyword:'AI',image:'with'}),[ai]);
 assert.equal(run({query:'chip'})[0],ai);
 assert.equal(items.length,2);
});
