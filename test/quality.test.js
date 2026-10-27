import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/quality.js';
const {assess, parseResponse} = globalThis.ReaderQuality;
const section = {heading:'정상', content:'원문에 근거한 완성 문장이다.', original:'A complete sentence.'};
test('parseable JSON with broken interior sections is review, not complete', () => {
  const doc = {sections:[section,{heading:'중단',content:'그는 다른 사람의 말 ',original:''},section]};
  const result = parseResponse({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(doc)}]});
  assert.equal(result.quality.status,'review');
  assert.deepEqual(result.quality.issues.filter(x=>x.review).map(x=>x.section),[1]);
  assert.deepEqual(result.sections,doc.sections);
});
test('single ambiguous signal does not reject a normal caption or absent excerpt', () => {
  assert.notEqual(assess({sections:[{...section,content:'표의 핵심 수치'}]}).status,'review');
  assert.notEqual(assess({sections:[{...section,original:''}]}).status,'review');
  assert.equal(assess({sections:[section]}).status,'checked');
});
test('stop reason and empty content cannot pass even with valid JSON', () => {
  assert.equal(assess({sections:[section]},'max_tokens').status,'review');
  assert.equal(assess({sections:[{...section,content:''}]}).status,'review');
  assert.throws(()=>parseResponse({content:[{type:'text',text:'{"sections":'}]}),/전체 재증류/);
});
