import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the production event handler without browser, network or model calls.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf("window.addEventListener('pensieve-canonical'");
const end=app.indexOf('window.PensieveSync?.canonical(records);',start);
assert(start>=0&&end>start);
const handlerSource=app.slice(start,end);

for(const sameRevision of [false,true])test(`canonical repair replaces stale images with ${sameRevision?'same':'older'} local revision`,()=>{
 const canonical={id:'server-id',contentRevision:'repair-2',topic:'Correct axis',
  images:[{src:'https://example.org/graph.jpg',sectionIndex:0}],
  sections:[{heading:'Graph',content:'Beginning to End',original:'source'}],sourceText:'source',
  originalTitle:'Actual work',url:'https://example.org/source',quality:{status:'checked'}};
 const current={id:'local-id',_pensieveLaunch:'launch',originalTitle:canonical.originalTitle,contentRevision:sameRevision?'repair-2':'repair-1',
  images:[{src:'https://example.org/ad.jpg'}],topic:'old',sections:[],
  fullTranslation:[{en:'source',ko:'New translation'}],perspective:'My perspective',reviewedSections:'old'};
 const other={...current,id:'other',_pensieveLaunch:'other-launch'};
 let listener,saves=0;
 const context={records:[current,other],currentId:current.id,
  window:{addEventListener:(name,fn)=>{listener=fn;}},
  persist:()=>{saves++;},renderList:()=>{},show:()=>{}};
 vm.runInNewContext(handlerSource,context);
 listener({detail:{launch:'launch',record:canonical}});
 const saved=context.records[0];
 for(const key of ['images','sections','topic','originalTitle','url','contentRevision'])assert.deepEqual(saved[key],canonical[key],key);
 assert.equal(saved.id,current.id);assert.equal(saved._pensieveLaunch,current._pensieveLaunch);
 assert.deepEqual(saved.fullTranslation,current.fullTranslation);assert.equal(saved.perspective,current.perspective);
 assert.equal(saved.reviewedSections,undefined);assert.equal(context.records[1],other);
 assert.equal(saves,1);
 listener({detail:{launch:'launch',record:canonical}});
 assert.equal(saves,1,'unchanged canonical events must not persist/requeue forever');
});
