// No package installation needed: asset validation + deterministic runtime checks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = file => assert.ok(fs.existsSync(path.join(ROOT, file)), 'Missing asset: ' + file);

function checkReferences() {
  const home = read('index.html');
  const notFound = read('404.html');
  for (const file of ['index.html', '404.html']) {
    const source = read(file);
    for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1];
      if (/^(?:https?:|data:|#)/.test(url)) continue;
      exists(decodeURIComponent(url.split(/[?#]/)[0]));
    }
    for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  }
  const css = read('assets/css/site.css');
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) exists(path.join('assets/css', match[1]));
  for (const file of ['assets/js/config.js', 'assets/js/app.js', 'sw.js']) new vm.Script(read(file), {filename:file});
  const configContext = vm.createContext({window:{}});
  vm.runInContext(read('assets/js/config.js'), configContext);
  const config = configContext.window.HWL_CONFIG;
  for (const src of Object.values(config.portraits)) exists(src);
  for (const file of config.audioFiles) exists(config.audioDirectory + file);
  assert.equal(config.audioFiles.length, 3);
  const ids = [...home.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate element IDs');
  for (const match of read('assets/js/app.js').matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'Missing UI: ' + match[1]);
  assert.ok(home.includes('class="pyroxene-word">青辉石<img'));
  assert.ok(notFound.includes('<h1>这里没有花语~</h1>'));
  assert.ok(notFound.includes('回去甩花未了'));
  assert.ok(!/ZZL_SAMPLE|three\.module|moonBambooLayer/.test(read('assets/js/app.js')));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, '花未了');
  for (const icon of manifest.icons) exists(icon.src);
  const ico = fs.readFileSync(path.join(ROOT, 'assets/icons/favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 4);
  assert.deepEqual(Array.from({length:4}, (_,i) => ico[6 + i*16] || 256), [16,32,48,256]);
  console.log('PASS: HTML/JS syntax, references, captions, 404 copy, manifest and 4-size ICO');
}

async function checkGame() {
  const ids = [...read('index.html').matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  let now = 1000, frame;
  const timers = [];
  class Target {
    constructor() { this.events = {}; this.style = {}; this.textContent = ''; this.hidden = false; this.classList = {add(){},remove(){},contains(){return false;},toggle(){}}; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    fire(name, event = {}) { for (const fn of this.events[name] || []) fn({stopPropagation(){},preventDefault(){},target:this,...event}); }
    setAttribute() {}
    setPointerCapture() {}
    closest() { return null; }
    remove() {}
  }
  const gradient = {addColorStop(){}};
  const canvas = new Proxy({}, {get(_, key) { return key === 'createLinearGradient' ? () => gradient : () => {}; }});
  const elements = Object.fromEntries(ids.map(id => [id, new Target()]));
  elements.cv.getContext = () => canvas;
  const media = [];
  class AudioMock extends Target {
    constructor() { super(); this.paused = true; this.ended = false; this.currentTime = 0; this.muted = false; media.push(this); }
    play() { this.paused = false; this.ended = false; queueMicrotask(() => { if(!this.paused) this.fire('playing'); }); return Promise.resolve(); }
    pause() { if(!this.paused) { this.paused = true; queueMicrotask(() => this.fire('pause')); } }
    finish() { this.paused = true; this.ended = true; this.fire('ended'); }
  }
  const store = new Map([['zzl_mywah', '7']]);
  const document = new Target();
  document.hidden = false;
  document.body = new Target();
  document.body.appendChild = () => {};
  document.getElementById = id => { assert.ok(elements[id], 'UI not found: ' + id); return elements[id]; };
  document.createElement = () => new Target();
  const window = new Target();
  Object.assign(window, {innerWidth:1280,innerHeight:800,devicePixelRatio:1,isSecureContext:false});
  const context = vm.createContext({
    window, document, console, Audio:AudioMock,
    Image:class {constructor(){this.complete=true;this.naturalWidth=920;this.naturalHeight=988;}},
    CanvasRenderingContext2D:class {roundRect(){}},
    navigator:{platform:'Win32',userAgent:'unit-test',maxTouchPoints:0},
    location:{protocol:'file:'}, matchMedia:()=>({matches:false}),
    performance:{now:()=>now},requestAnimationFrame:fn=>{frame=fn;},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}
  });
  vm.runInContext(read('assets/js/config.js'), context);
  vm.runInContext(read('assets/js/app.js'), context);
  const game = window.__hwl;
  async function tick(count=1) {
    for(let i=0;i<count;i++){
      now += 1000/60; frame(now);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const state = game.state;
      assert.ok(Number.isFinite(state.rps));
      assert.ok(state.captions.every(text=>text===state.voice), 'Caption/audio mismatch');
    }
  }
  assert.equal(game.state.portrait, 'mika1');
  assert.equal(elements.stMine.textContent, '7', 'Legacy count must survive refactor');
  game.setAuto(true);
  await tick(240);
  assert.equal(game.state.portrait, 'mika2');
  assert.equal(game.state.audio, 'playing');
  assert.equal(elements.stMine.textContent, '7', 'Auto mode must not increase manual count');
  const allowed = new Set(window.HWL_CONFIG.audioFiles.map(name=>name.replace(/\.wav$/,'')));
  let previous = game.state.voice;
  for(let i=0;i<15;i++){
    assert.ok(allowed.has(previous));
    media[0].finish(); await tick(4);
    assert.notEqual(game.state.voice, previous, 'Do not repeat the previous voice');
    previous = game.state.voice;
  }
  elements.soundBtn.fire('click'); await tick(3);
  assert.equal(game.state.muted, true);
  assert.equal(game.state.audio, 'paused');
  assert.equal(game.state.captions.length, 0);
  elements.soundBtn.fire('click'); await tick(3);
  assert.equal(game.state.audio, 'playing');
  elements.resetBtn.fire('click'); await tick(10);
  assert.equal(game.state.auto, false);
  assert.equal(game.state.portrait, 'mika1');
  assert.equal(game.state.voice, null);
  assert.equal(elements.stMine.textContent, '7');
  elements.cv.fire('pointerdown', {pointerId:1,pointerType:'mouse',clientX:755,clientY:304});
  for(let i=0;i<180;i++){
    elements.cv.fire('pointermove',{pointerId:1,clientX:755+58*Math.cos(i/20*Math.PI*2),clientY:304+58*Math.sin(i/20*Math.PI*2)});
    await tick();
  }
  assert.equal(game.state.portrait,'mika2');
  assert.ok(Number(elements.stMine.textContent.replaceAll(',',''))>7);
  elements.cv.fire('pointerup',{pointerId:1});
  await tick(3000);
  assert.equal(game.state.portrait,'mika1');
  assert.equal(game.state.audio,'paused');
  for(const timer of timers.filter(t=>t.ms===800))timer.fn();
  assert.ok(Number(store.get('hwl_turns'))>7);
  console.log('PASS: idle/swing/settle, random voice, synchronized captions, mute, reset, manual count migration');
}

async function checkWorker() {
  const origin = 'http://localhost/';
  const cachesByName = new Map([['unrelated-app', new Map()], ['hwl-v2', new Map()], ['zzl-v1', new Map()]]);
  const keyOf = request => typeof request === 'string' ? request : request.url;
  let offline = false;
  const fakeFetch = async request => {
    if(offline)throw new Error('offline');
    const url = new URL(keyOf(request), origin);
    const file = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const absolute = path.join(ROOT, file);
    if(!fs.existsSync(absolute))return new Response('not found', {status:404});
    return new Response(fs.readFileSync(absolute));
  };
  const caches = {
    keys:async()=>[...cachesByName.keys()],
    delete:async name=>cachesByName.delete(name),
    async open(name){
      if(!cachesByName.has(name))cachesByName.set(name,new Map());
      const cache=cachesByName.get(name);
      return {
        put:async(request,response)=>cache.set(keyOf(request),response),
        addAll:async urls=>{for(const url of urls){const response=await fakeFetch(url);assert.equal(response.status,200,'Precache missing: '+url);cache.set(url,response);}}
      };
    },
    async match(request){
      for(const cache of cachesByName.values()){const hit=cache.get(keyOf(request));if(hit)return hit.clone();}
    }
  };
  const events={};
  const self={registration:{scope:origin},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}};
  const context=vm.createContext({self,caches,fetch:fakeFetch,URL,Response,Set,Promise});
  vm.runInContext(read('sw.js'),context);
  async function lifecycle(name){const waits=[];events[name]({waitUntil:p=>waits.push(p)});await Promise.all(waits);}
  await lifecycle('install');await lifecycle('activate');
  assert.ok(cachesByName.has('unrelated-app'),'Do not remove unrelated caches');
  assert.ok(!cachesByName.has('hwl-v2'));
  async function navigate(route){
    let result;
    events.fetch({request:{url:new URL(route,origin).href,method:'GET',mode:'navigate'},respondWith:p=>result=p,waitUntil(){}});
    return await result;
  }
  assert.equal((await navigate('/not/a/real/page')).status,404);
  offline=true;
  const home=await navigate('/');
  assert.equal(home.status,200);
  assert.ok((await home.text()).includes('class="home-page"'),'404 must not overwrite cached homepage');
  const missing=await navigate('/not/a/real/page');
  assert.equal(missing.status,404);
  assert.ok((await missing.text()).includes('这里没有花语~'));
  console.log('PASS: complete precache, scoped cleanup, offline homepage and correct offline 404');
}

(async()=>{
  checkReferences();
  await checkGame();
  await checkWorker();
  console.log('All checks passed (non-browser).');
})().catch(error=>{console.error(error);process.exitCode=1;});
