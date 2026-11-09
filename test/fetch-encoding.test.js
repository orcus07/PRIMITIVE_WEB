import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchArticle} from '../src/lib/fetchArticle.js';
const sjis = Buffer.from('PGh0bWw+PGhlYWQ+PG1ldGEgaHR0cC1lcXVpdj0iQ29udGVudC1UeXBlIiBjb250ZW50PSJ0ZXh0L2h0bWw7Y2hhcnNldD1TaGlmdF9KSVMiPjx0aXRsZT6X9oiki8iQ/DwvdGl0bGU+PC9oZWFkPjxib2R5PjxhcnRpY2xlPpBliKSCyILpgmCMToFJl/aIpIvIkPyBQoKxguqCzZW2jpqJu4KvgrWCyIKik/qWe4zqgsyWe5W2gsWCt4FCkGWIpILIgumCYIxOgUmX9oiki8iQ/IFCgrGC6oLNlbaOmom7gq+CtYLIgqKT+pZ7jOqCzJZ7lbaCxYK3gUKQZYikgsiC6YJgjE6BSZf2iKSLyJD8gUKCsYLqgs2Vto6aibuCr4K1gsiCopP6lnuM6oLMlnuVtoLFgreBQpBliKSCyILpgmCMToFJl/aIpIvIkPyBQoKxguqCzZW2jpqJu4KvgrWCyIKik/qWe4zqgsyWe5W2gsWCt4FCkGWIpILIgumCYIxOgUmX9oiki8iQ/IFCgrGC6oLNlbaOmom7gq+CtYLIgqKT+pZ7jOqCzJZ7lbaCxYK3gUKQZYikgsiC6YJgjE6BSZf2iKSLyJD8gUKCsYLqgs2Vto6aibuCr4K1gsiCopP6lnuM6oLMlnuVtoLFgreBQpBliKSCyILpgmCMToFJl/aIpIvIkPyBQoKxguqCzZW2jpqJu4KvgrWCyIKik/qWe4zqgsyWe5W2gsWCt4FCkGWIpILIgumCYIxOgUmX9oiki8iQ/IFCgrGC6oLNlbaOmom7gq+CtYLIgqKT+pZ7jOqCzJZ7lbaCxYK3gUKQZYikgsiC6YJgjE6BSZf2iKSLyJD8gUKCsYLqgs2Vto6aibuCr4K1gsiCopP6lnuM6oLMlnuVtoLFgreBQpBliKSCyILpgmCMToFJl/aIpIvIkPyBQoKxguqCzZW2jpqJu4KvgrWCyIKik/qWe4zqgsyWe5W2gsWCt4FCkGWIpILIgumCYIxOgUmX9oiki8iQ/IFCgrGC6oLNlbaOmom7gq+CtYLIgqKT+pZ7jOqCzJZ7lbaCxYK3gUKQZYikgsiC6YJgjE6BSZf2iKSLyJD8gUKCsYLqgs2Vto6aibuCr4K1gsiCopP6lnuM6oLMlnuVtoLFgreBQjwvYXJ0aWNsZT48L2JvZHk+PC9odG1sPg==', 'base64');
async function collect(bytes, type='text/html') {
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>String(url).startsWith('https://r.jina.ai/')
    ? new Response('',{status:502}) : new Response(bytes,{headers:{'content-type':type}});
  try{return await fetchArticle('https://example.org/article');}finally{globalThis.fetch=original;}
}
test('direct collector decodes Aozora-style Shift_JIS meta before extracting body', async()=>{
 const result=await collect(sjis);
 assert.equal(result.title,'恋愛曲線');
 assert(result.text.includes('親愛なるＡ君'));
 assert.equal(result.text.includes('\ufffd'),false);
 assert.equal(result.via,'direct');
});
test('HTTP charset is respected without an HTML charset declaration',async()=>{
 const bytes=Buffer.from(sjis.toString('latin1').replace(/<meta[^>]+>/,''),'latin1');
 const result=await collect(bytes,'text/html; charset="Shift_JIS"');
 assert.equal(result.title,'恋愛曲線');assert(result.text.includes('親愛なるＡ君'));
});
test('UTF-8, UTF-16 BOM and normal accented text retain all characters',async()=>{
 const title='한글 café 日本語';const html='<title>'+title+'</title><article>'+('정상 본문 日本語 café. '.repeat(30))+'</article>';
 for(const bytes of [Buffer.from(html),Buffer.concat([Buffer.from([255,254]),Buffer.from(html,'utf16le')])]){
  const result=await collect(bytes);assert.equal(result.title,title);assert(!result.text.includes('\ufffd'));
 }
});
test('unsupported encoding or replacement-filled source never reaches distillation as success',async()=>{
 for(const html of ['<meta charset="made-up-encoding"><body>'+('abc '.repeat(100))+'</body>','<body>'+('broken \ufffd\ufffd '.repeat(100))+'</body>']){
  await assert.rejects(()=>collect(Buffer.from(html)),/본문을 가져오지 못했습니다/);
 }
});

test('unlabelled legacy English HTML decodes Windows-1252 punctuation without a proxy',async()=>{
 const html='<title>Maker\'s Schedule, Manager\'s Schedule</title><article>'+('Morning\x96afternoon; \x93maker\x92s schedule\x94. '.repeat(20))+'</article>';
 for(const type of ['text/html','text/html; charset=windows-1252','text/html; charset=iso-8859-1']){
  const result=await collect(Buffer.from(html,'latin1'),type);
  assert.equal(result.via,'direct');
  assert(result.text.includes('Morning–afternoon; “maker’s schedule”.'));
  assert(!result.text.includes('\ufffd'));
 }
});

test('invalid explicitly declared UTF-8 is not silently relabelled as Windows-1252',async()=>{
 const body=Buffer.from('<body>'+('Morning\x96afternoon. '.repeat(30))+'</body>','latin1');
 for(const bytes of [body,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),body])]){
  await assert.rejects(()=>collect(bytes,'text/html; charset=utf-8'),/본문을 가져오지 못했습니다/);
 }
 await assert.rejects(()=>collect(Buffer.concat([Buffer.from('<meta charset="utf-8">'),body])),/본문을 가져오지 못했습니다/);
});
