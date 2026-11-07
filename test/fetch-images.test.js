import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchArticle} from '../src/lib/fetchArticle.js';

async function collect(html) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, {headers: {'content-type':'text/html; charset=utf-8'}});
  try { return await fetchArticle('https://example.org/story/'); }
  finally { globalThis.fetch = original; }
}

test('WordPress body graphs are not displaced by the first twelve sidebar images', async () => {
  const ads = Array.from({length:15}, (_,i) => `<img src="/book-${i}.jpg">`).join('');
  const graphs = ['hole','boy','cinderella','kafka','hamlet'];
  const result = await collect(`<body><div class="sidebar">${ads}</div><div class="post"><div class="entry_content"><p>${'Article body. '.repeat(30)}</p>${graphs.map(x=>`<img src="/${x}.jpg">`).join('')}</div></div></body>`);
  assert.deepEqual(result.images.map(x=>x.src), graphs.map(x=>`https://example.org/${x}.jpg`));
});

test('semantic article ignores navigation ads and resolves lazy-loaded graph URL', async () => {
  const result = await collect(`<article><header><img src="/promotion.jpg"></header><p>${'Article body. '.repeat(30)}</p><figure><img src="data:image/gif;base64,R0lGODlh" data-src="../graph.jpg"><figcaption>Good Fortune / Ill Fortune</figcaption></figure><aside><img src="/recommendation.jpg"></aside></article>`);
  assert.deepEqual(result.images, [{src:'https://example.org/graph.jpg',caption:'Good Fortune / Ill Fortune'}]);
});
