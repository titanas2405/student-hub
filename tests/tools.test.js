// Run with: node --test tests/tools.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function frontend(savedCategory = '') {
  const elements = {}, intervals = new Map();
  let now = 0, nextInterval = 0;
  const storage = new Map([['hub:tools-tab', savedCategory]]);
  class Element {
    constructor(tag, attrs, children) {
      this.tag = tag; this.attrs = { ...attrs }; this.events = {}; this.children = children.flat(Infinity).filter((x) => x != null && x !== false);
      this.value = String(attrs?.value ?? ''); this.disabled = !!attrs?.disabled; this.hidden = !!attrs?.hidden; this.files = []; this.textContent = '';
      if (tag === 'select') this.value = this.children[0]?.value || '';
      if (attrs?.id) elements[attrs.id] = this;
      for (const [key, value] of Object.entries(attrs || {})) if (key.startsWith('on')) this.events[key.slice(2)] = value;
    }
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items.flat(Infinity).filter((x) => x != null && x !== false); if (this.tag === 'select') this.value = this.children[0]?.value || ''; }
    get childElementCount() { return this.children.length; }
    focus() { this.focused = true; }
  }
  elements['tools-body'] = new Element('div', {}, []);
  const caps = {pdf:true, gs:true,pdfinfo:true,pdfunite:true,pdfseparate:true};
  const ctx = { h:(tag,attrs,...children)=>new Element(tag,attrs,children), $:id=>elements[id],
    fill:(el,...kids)=>el.replaceChildren(...kids), api:async()=>caps, state:{csrf:'test'},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    Blob, Response, FormData, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Set, Math, Number,
    Date:class extends Date { static now(){return now;} },
    setInterval:fn=>{intervals.set(++nextInterval,fn);return nextInterval;},clearInterval:id=>intervals.delete(id),toast(){},
    downloadToolFile(){}, copyText:async()=>{}, document:{}, URL, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/tools.js'),'utf8'),ctx);
  const all = (el=elements['tools-body']) => [el,...el.children.filter(x=>x instanceof Element).flatMap(x=>all(x))];
  const find = (predicate) => all().find(predicate);
  return {ctx,elements,intervals,find,all,storage,setNow:value=>{now=value;},textButton:text=>find(n=>n.tag==='button'&&n.children.includes(text))};
}

test('tools have six accessible categories; switching preserves inputs and restores selection',async()=>{
  const ui=frontend('Images');ui.ctx.renderTools();await Promise.resolve();
  assert.equal(ui.all().filter(n=>n.attrs.role==='tab').length,6);
  assert.equal(ui.elements['tools-panel-images'].hidden,false);
  assert.equal(ui.elements['tools-panel-documents'].hidden,true);
  assert.equal(ui.all().filter(n=>n.tag==='h2').length,14);
  const text=ui.find(n=>n.attrs['aria-label']==='Text to count');text.value='My notes';
  ui.elements['tools-tab-text'].events.click();
  assert.equal(ui.elements['tools-tab-text'].attrs['aria-selected'],'true');
  assert.equal(ui.elements['tools-panel-text'].hidden,false);
  ui.elements['tools-tab-images'].events.click();ui.elements['tools-tab-text'].events.click();
  assert.equal(ui.find(n=>n.attrs['aria-label']==='Text to count').value,'My notes');
  ui.elements['tools-tab-text'].events.keydown({key:'End',preventDefault(){}});
  assert.equal(ui.storage.get('hub:tools-tab'),'Converters');
  assert.equal(ui.elements['tools-tab-converters'].focused,true);
});

test('unit conversions handle offsets, decimal/binary sizes and invalid temperatures',()=>{
  const {ctx}=frontend();
  assert.equal(ctx.convertToolUnits('Temperature',32,'°F','°C'),0);
  assert.equal(ctx.convertToolUnits('Temperature',0,'°C','K'),273.15);
  assert.equal(ctx.convertToolUnits('Data size',1,'MiB','B'),1048576);
  assert.equal(ctx.convertToolUnits('Data size',1,'MB','B'),1000000);
  assert.equal(ctx.convertToolUnits('Length',1,'miles','m'),1609.344);
  assert.throws(()=>ctx.convertToolUnits('Temperature',-1,'K','°C'));
  assert.throws(()=>ctx.convertToolUnits('Weight',NaN,'kg','g'));
});

test('grade calculation handles attainable, already met and impossible targets',()=>{
  const {ctx}=frontend();
  assert(Math.abs(ctx.gradeToolResult(7,60,5,10)-3.666666666666667)<1e-10);
  assert(ctx.gradeToolResult(10,20,5,10)<0);
  assert(ctx.gradeToolResult(0,20,10,10)>10);
  assert.equal(ctx.gradeToolResult(4,100,5,10),5);
  assert.throws(()=>ctx.gradeToolResult(7,0,5,10));
  assert.throws(()=>ctx.gradeToolResult(11,60,5,10));
});

test('study timer preserves elapsed time across tabs, pause/resume and completion',()=>{
  const ui=frontend();ui.ctx.renderTools();
  const start=ui.textButton('Start');
  const minutes=ui.find(n=>n.attrs['aria-label']==='Timer duration in minutes');
  minutes.value='1';minutes.events.change();start.events.click();
  ui.setNow(20000);[...ui.intervals.values()][0]();
  ui.elements['tools-tab-images'].events.click();
  ui.elements['tools-tab-study'].events.click();
  const clock=ui.find(n=>n.attrs.role==='timer');assert.equal(clock.textContent,'00:40');
  start.events.click();assert.equal(ui.intervals.size,0);
  ui.setNow(80000);start.events.click();
  ui.setNow(120000);[...ui.intervals.values()][0]();
  assert.equal(clock.textContent,'00:00');assert.equal(ui.intervals.size,0);
  assert.equal(start.textContent,'Start');
});

test('humanizer prompt includes the text and chosen style, and updates as options change',()=>{
  const {ctx}=frontend();
  const prompt=ctx.humanizerPrompt({text:'  Recursion is useful.  ',language:'el',tone:'academic',length:'shorter',notes:'Use short paragraphs.'});
  assert.match(prompt,/modern Greek/);assert.match(prompt,/academic register/);assert.match(prompt,/more concise/);
  assert.match(prompt,/Keep technical terms/);assert.match(prompt,/Use short paragraphs\./);
  assert.match(prompt,/"""\nRecursion is useful\.\n"""$/);
  assert.doesNotMatch(ctx.humanizerPrompt({text:'x',keepTerms:false}),/Keep technical terms/);
  assert.match(ctx.humanizerPrompt(),/\[paste your text here\]/);
  const ui=frontend('Text');ui.ctx.renderTools();
  const input=ui.find(n=>n.attrs['aria-label']==='Text to humanize');
  const output=ui.find(n=>n.attrs['aria-label']==='Generated humanizer prompt');
  input.value='My essay';input.events.input();
  assert.match(output.value,/"""\nMy essay\n"""/);
  const tone=ui.find(n=>n.attrs['aria-label']==='Tone');tone.value='casual';tone.events.change();
  assert.match(output.value,/conversational tone/);
});
