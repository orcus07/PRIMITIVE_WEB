import test from 'node:test';
import assert from 'node:assert/strict';
import {assertArticleSource,pdfTextContent} from '../src/lib/sourceIdentity.js';
test('a selected Scapegoat work cannot be distilled from the transcript directory',()=>{
 assert.throws(()=>assertArticleSource({title:'Transcripts — davidcayley.com',text:'Archive with The Scapegoat link'},'The Scapegoat: René Girard’s Anthropology of Violence and Religion (Transcript)'),/목록 페이지/);
 assert.doesNotThrow(()=>assertArticleSource({title:'The Scapegoat — David Cayley',text:'Actual transcript'},'The Scapegoat (Transcript)'));
 assert.doesNotThrow(()=>assertArticleSource({title:'Transcripts — davidcayley.com',text:'Index deliberately selected'},'Transcripts'));
});
test('scanned PDF page markers are not claimed as recovered text',()=>{
 assert.equal(pdfTextContent('-- 1 of 54 --\n\n-- 2 of 54 --'),'');
 assert.equal(pdfTextContent('Original paragraph\n-- 1 of 54 --'),'Original paragraph');
});
