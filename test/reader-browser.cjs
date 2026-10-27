// Browser integration tests. Every request is intercepted; no real model or PC writes.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ORIGIN='https://meeting-notes-eu0u.onrender.com', HOST='https://laptop-6lmt6gii.tailcb76be.ts.net';
const id='a'.repeat(32), credential={id,endpoint:HOST+'/reader-launch/'+id,token:'test-only-'.repeat(5)};
const LENS='서재의 최신 사용자 표현을 바탕으로 한 테스트 관점.', CUSTOM='내가 직접 정한 새로운 관점.';
const valid={id:'existing',originalTitle:'Fixture',koreanTitle:'테스트 자료',url:'https://example.com/article',sourceText:'A source paragraph.',sections:[{heading:'First',content:'원문에 근거한 완전한 문장이다.',original:'A source paragraph.'}],marketerAngle:{relevance:'none',notes:[]}};
const broken={...valid,id:'new',sections:[{heading:'First',content:'그가 말한 이유(',original:''}]};
const repaired={...valid,contentRevision:'repair-1',sections:[{heading:'First',content:'원문과 대조하여 복구한 문장이다.',original:'A source paragraph.'}]};

async function setup(browser,{storage={},offline=false,record=valid,canonical=null,launch=false}={}) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  await context.addInitScript(storage=>{for(const [k,v] of Object.entries(storage))localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));},storage);
  const page=await context.newPage(), calls=[], errors=[]; let pcOffline=offline;
  page.on('pageerror',error=>errors.push(error.message)); page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===HOST){
      if(pcOffline)return route.abort('connectionfailed');
      const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
      assert.equal(req.headers().authorization,'Bearer '+credential.token);
      const reply=json=>route.fulfill({json,headers});
      if(url.pathname.endsWith('/perspective'))return reply({perspective:LENS,evidenceAt:1});
      if(url.pathname.endsWith('/document'))return reply({record:canonical});
      if(url.pathname.endsWith('/start'))return reply({started:true});
      if(url.pathname.endsWith('/result')){calls.push({pc: req.postDataJSON()});return reply(canonical?{record:canonical}:{status:'updated'});}
      return reply({id,item_id:'card',title:'자료',kind:'article',url:valid.url,perspective:'Old launch lens',currentPerspective:LENS,status:'ready'});
    }
    if(url.origin!==ORIGIN)throw Error('Unexpected external request: '+url.origin);
    if(url.pathname==='/api/health')return route.fulfill({json:{anthropic:true}});
    if(url.pathname.startsWith('/api/digest')){calls.push({model:req.postDataJSON()});return route.fulfill({json:{jobId:'test'}});}
    if(url.pathname.startsWith('/api/job/'))return route.fulfill({json:{status:'done',steps:[],result:record}});
    const file=path.join(__dirname,'../public',url.pathname==='/'?'index.html':path.basename(url.pathname));
    return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  await page.goto(ORIGIN+(launch?'/#pensieve-launch='+encodeURIComponent(JSON.stringify(credential)):'/'));
  await page.waitForFunction(()=>!document.getElementById('profile-status').textContent.includes('PC 확인 중'));
  return {page,context,calls,errors,setOffline:value=>{pcOffline=value;}};
}
const paired={'pensieve-reader-launches/v1':{[id]:credential}};
async function run(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    let t=await setup(browser);
    assert.match(await t.page.locator('#profile-status').innerText(),/연결.*필요/);
    assert.equal(await t.page.locator('#lens-input').inputValue(),'');
    await t.page.locator('#url').fill(valid.url);await t.page.locator('#run-btn').click();
    assert.equal(t.calls.length,0,'uncached disconnected default cannot claim to be current taste');
    await t.context.close();

    t=await setup(browser,{storage:paired});
    assert.equal(await t.page.locator('#lens-input').inputValue(),LENS);
    await t.page.locator('#lens-input').fill(CUSTOM);await t.page.locator('#lens-refresh').click();
    await t.page.waitForFunction(()=>document.getElementById('profile-status').textContent.includes('PC 연결됨'));
    assert.equal(await t.page.locator('#lens-input').inputValue(),CUSTOM);
    await t.page.reload();assert.equal(await t.page.locator('#lens-input').inputValue(),CUSTOM);
    await t.page.locator('#lens-reset').click();await t.page.waitForFunction(lens=>document.getElementById('lens-input').value===lens,LENS);
    await t.page.locator('#url').fill(valid.url);await t.page.locator('#run-btn').click();
    await t.page.locator('#r-title').filter({hasText:'테스트 자료'}).waitFor();
    assert.equal(t.calls.filter(x=>x.model).length,1);assert.equal(t.calls.find(x=>x.model).model.perspective,LENS);
    assert.equal(t.calls.filter(x=>x.pc).length,0,'direct reader does not import into PC');
    t.setOffline(true);await t.page.locator('#lens-refresh').click();
    await t.page.waitForFunction(()=>document.getElementById('profile-status').textContent.includes('PC 연결 안 됨'));
    assert.equal(await t.page.locator('#lens-input').inputValue(),LENS);
    assert.match(await t.page.locator('#profile-status').innerText(),/마지막 정상 동기화:/);
    assert.equal(await t.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.TEST_EVIDENCE_DIR)await t.page.screenshot({path:path.join(process.env.TEST_EVIDENCE_DIR,'reader-offline.png'),fullPage:true});
    assert.deepEqual(t.errors,[]);await t.context.close();

    t=await setup(browser,{storage:{...paired,'reader-perspective/v1':CUSTOM},launch:true});
    await t.page.locator('.pensieve-launch-panel button').waitFor();
    assert.equal(t.calls.length,0,'library launch waits for perspective review');
    assert.equal(await t.page.locator('#lens-input').inputValue(),CUSTOM);
    await t.page.locator('.pensieve-launch-panel button').click();
    await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader-archive/v1')||'[]').length===1);
    assert.equal(t.calls.find(x=>x.model).model.perspective,CUSTOM);
    assert.deepEqual(t.errors,[]);await t.context.close();

    t=await setup(browser,{storage:{...paired,'reader-archive/v1':[valid]},record:broken});
    await t.page.locator('#url').fill('https://example.com/new');await t.page.locator('#run-btn').click();
    await t.page.waitForFunction(()=>!!localStorage.getItem('reader-review-draft/v1'));
    assert.equal(await t.page.evaluate(()=>JSON.parse(localStorage.getItem('reader-archive/v1')).length),1);
    assert.equal(t.calls.filter(x=>x.pc).length,0);
    assert.match(await t.page.locator('#quality-panel').innerText(),/정상 완료가 아닙니다/);
    await t.page.reload();await t.page.getByRole('button',{name:'검토 중인 초안 열기'}).click();
    await t.page.locator('#quality-panel summary').click();
    await t.page.getByRole('textbox',{name:'1번 한글 본문',exact:true}).fill('원문과 대조해 끝까지 복구한 문장이다.');
    await t.page.getByRole('textbox',{name:'1번 대응 영어 원문',exact:true}).fill('A source paragraph.');
    await t.page.getByRole('button',{name:'해당 구간 검토 후 저장'}).click();
    assert.equal(await t.page.evaluate(()=>JSON.parse(localStorage.getItem('reader-archive/v1')).length),2);
    assert.equal(t.calls.filter(x=>x.model).length,1,'section repair does not bill a second full document');
    assert.deepEqual(t.errors,[]);await t.context.close();

    t=await setup(browser,{storage:{...paired,'reader-archive/v1':[{...broken,_pensieveLaunch:id}]},canonical:repaired});
    await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader-archive/v1'))[0].contentRevision==='repair-1');
    const saved=await t.page.evaluate(()=>JSON.parse(localStorage.getItem('reader-archive/v1'))[0]);
    assert.deepEqual(saved.sections,repaired.sections);assert.equal(saved._pensieveLaunch,id);
    await t.page.reload();await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader-archive/v1'))[0].contentRevision==='repair-1');
    assert.deepEqual(t.errors,[]);await t.context.close();
    console.log('PASS: direct/library defaults, explicit override/reset, offline/uncached state, no auto-start, standalone exclusion, draft persistence, section-only repair, canonical recovery, mobile layout');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
