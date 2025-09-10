/* ==========================================================
   Cup Mapper — app.js  (Smart Mixing + Pattern, Preview, Export)
   ========================================================== */

/* ============ DOM shortcuts ============ */
const $  = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));

/* Map all elements used across modules (guard nulls for flexible markup) */
const els = {
  // top actions
  btnOpenHelp:  $('#btnOpenHelp'),
  btnOpenAbout: $('#btnOpenAbout'),

  // upload & preview
  fileInput:    $('#fileInput'),
  heroCanvas:   $('#heroCanvas'),    // original preview (hero)
  maxW:         $('#maxW'),
  zoom:         $('#zoom'),
  zoomLabel:    $('#zoomLabel'),
  btnZoomFit:   $('#btnZoomFit'),
  btnZoom100:   $('#btnZoom100'),
  btnLoadSample:$('#btnLoadSample'),
  btnClear:     $('#btnClear'),

  // original palette
  kClusters:    $('#kClusters'),
  kClustersOut: $('#kClustersOut'),
  btnExtract:   $('#btnExtract'),
  btnEyedropper:$('#btnEyedropper'),
  origPalette:  $('#origPalette'),

  // restricted palette
  btnFromOriginal: $('#btnFromOriginal'),
  allowWhite:      $('#allowWhite'),
  btnAddInk:       $('#btnAddInk'),
  restrictedList:  $('#restrictedList'),
  kitName:         $('#kitName'),
  btnSaveKit:      $('#btnSaveKit'),
  btnLoadKit:      $('#btnLoadKit'),
  btnDeleteKit:    $('#btnDeleteKit'),

  // smart mixing
  autoSmart:        $('#autoSmart'),
  maxInksPerMix:    $('#maxInksPerMix'),
  gamutSensitivity: $('#gamutSensitivity'),
  gamutSensitivityOut: $('#gamutSensitivityOut'),
  mixBlock:         $('#mixBlock'),
  mixCell:          $('#mixCell'),
  mixPattern:       $('#mixPattern'),
  btnGenerateMixes: $('#btnGenerateMixes'),
  rulesTable:       $('#rulesTable'),
  tplRule:          $('#tplRule'),

  // mapping
  wLight:       $('#wLight'),
  wLightOut:    $('#wLightOut'),
  wChroma:      $('#wChroma'),
  wChromaOut:   $('#wChromaOut'),
  useDither:    $('#useDither'),
  useSharpen:   $('#useSharpen'),
  bgMode:       $('#bgMode'),
  previewScale: $('#previewScale'),
  applyBtn:     $('#applyBtn'),
  bigRegen:     $('#bigRegen'),
  mapProgress:  $('#mapProgress'),
  mapProgressLabel: $('#mapProgressLabel'),

  // canvases (mapped output)
  mappedCanvas: $('#mappedCanvas'),

  // export
  exportScale:      $('#exportScale'),
  exportTransparent:$('#exportTransparent'),
  btnExportPNG:     $('#btnExportPNG'),
  btnExportSVG:     $('#btnExportSVG'),
  btnExportReport:  $('#btnExportReport'),
  downloadLink:     $('#downloadLink'),

  // projects drawer
  openProjects:   $('#openProjects'),
  projectsPane:   $('#projectsPane'),
  closeProjects:  $('#closeProjects'),
  refreshProjects:$('#refreshProjects'),
  saveProject:    $('#saveProject'),
  exportProject:  $('#exportProject'),
  importProject:  $('#importProject'),
  deleteProject:  $('#deleteProject'),
  projectsList:   $('#projectsList'),

  // dialogs & toasts
  dlgHelp:       $('#dlgHelp'),
  btnCloseHelp:  $('#btnCloseHelp'),
  dlgAbout:      $('#dlgAbout'),
  btnCloseAbout: $('#btnCloseAbout'),
  toasts:        $('#toasts'),
};

/* ============ Canvas contexts ============ */
const heroCtx   = els.heroCanvas?.getContext('2d', { willReadFrequently: true });
const mappedCtx = els.mappedCanvas?.getContext('2d', { willReadFrequently: true });

/* ============ App State ============ */
const state = {
  // source image & preview
  srcImage: null,
  srcW: 0, srcH: 0,       // full-res source
  previewScalePx: 1,      // computed to fit hero/maxW

  // palettes
  origPalette: [],        // array of hex (e.g. ["#aabbcc", ...])
  restricted:  [],        // array of { hex, enabled }

  // rules: per-original hex overrides (mix or pattern)
  rules: new Map(),       // key: origHex -> { on, mode:'mix'|'pattern', mix:{...} | pattern:{...}, err: number }

  // mapping cache for preview/export
  mappedImageData: null,  // ImageData at full res
  lastPreview: { paramsHash: '', previewScale: 0, w:0, h:0 },

  // projects
  projectCounter: 0
};

/* ============ Utils ============ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sameHex = (a,b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const hexToRgb = (hex) => {
  hex = hex.replace('#','').trim();
  if (hex.length === 3) hex = hex.split('').map(x=>x+x).join('');
  const n = parseInt(hex, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
};
const rgbToHex = (r,g,b) => '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();

/* sRGB <-> linear helpers for lab */
function srgb2lin(u){ u/=255; return (u<=0.04045)?(u/12.92):Math.pow((u+0.055)/1.055,2.4); }
function lin2srgb(u){ return Math.round(255*((u<=0.0031308)?(u*12.92):(1.055*Math.pow(u,1/2.4)-0.055))); }

/* RGB -> Lab */
function rgb2lab(r,g,b){
  // D65
  let R=srgb2lin(r), G=srgb2lin(g), B=srgb2lin(b);
  let X=R*0.4124+G*0.3576+B*0.1805;
  let Y=R*0.2126+G*0.7152+B*0.0722;
  let Z=R*0.0193+G*0.1192+B*0.9505;
  X/=0.95047; Y/=1.0; Z/=1.08883;
  const f=t=> (t>0.008856)? Math.cbrt(t) : (7.787*t + 16/116);
  const fx=f(X), fy=f(Y), fz=f(Z);
  return { L:116*fy-16, a:500*(fx-fy), b:200*(fy-fz) };
}

/* weighted squared distance */
function deltaE2(l1, l2, wL=1, wC=1){
  const dL=(l1.L-l2.L)*wL;
  const dA=(l1.a-l2.a);
  const dB=(l1.b-l2.b);
  const C1=Math.sqrt(l1.a*l1.a+l1.b*l1.b);
  const C2=Math.sqrt(l2.a*l2.a+l2.b*l2.b);
  const dC=(C1-C2)*wC;
  /* approximate: emphasize chroma via dC; keep da/db too */
  return dL*dL + dC*dC + dA*dA*0.35 + dB*dB*0.35;
}

/* Floyd–Steinberg propagation */
function fsPropagate(err, w, x, y, er, eg, eb){
  const i = (y*w + x)*3;
  const n = w*3;
  const spread = [
    [1,0, 7/16],
    [-1,1,3/16],[0,1,5/16],[1,1,1/16],
  ];
  for(const [dx,dy,k] of spread){
    const xx=x+dx, yy=y+dy;
    if (xx<0||yy<0||xx>=w) continue;
    const j = (yy*w+xx)*3;
    err[j+0]+=er*k; err[j+1]+=eg*k; err[j+2]+=eb*k;
  }
}

/* Unsharp Mask (simple) */
function unsharp(imageData, amount=0.5, radius=1){
  const {width:w,height:h,data:d}=imageData;
  const out=new Uint8ClampedArray(d.length);
  const get=(x,y,c)=> d[(y*w+x)*4+c];
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      for(let c=0;c<3;c++){
        let sum=0, cnt=0;
        for(let dy=-radius;dy<=radius;dy++)
        for(let dx=-radius;dx<=radius;dx++){
          const xx=clamp(x+dx,0,w-1), yy=clamp(y+dy,0,h-1);
          sum+=get(xx,yy,c); cnt++;
        }
        const blur=sum/cnt;
        const val = clamp(Math.round(get(x,y,c) + amount*(get(x,y,c)-blur)),0,255);
        out[i+c]=val;
      }
      out[i+3]=d[i+3];
    }
  }
  d.set(out);
}

/* Toasts */
function toast(msg, kind){
  const div=document.createElement('div');
  div.className='toast '+(kind==='danger'?'toast--danger':kind==='ok'?'toast--ok':'');
  div.textContent=msg;
  els.toasts?.appendChild(div);
  setTimeout(()=>div.remove(), 3000);
}

/* ============ Image loading & hero preview ============ */
function loadImage(file){
  return new Promise((res, rej)=>{
    const img=new Image();
    img.onload=()=>res(img);
    img.onerror=rej;
    img.src=URL.createObjectURL(file);
  });
}

function drawHero(img){
  // Scale to max width
  const maxW = parseInt(els.maxW.value||1600,10);
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth*scale);
  const h = Math.round(img.naturalHeight*scale);
  els.heroCanvas.width=w; els.heroCanvas.height=h;
  heroCtx.imageSmoothingEnabled=true;
  heroCtx.clearRect(0,0,w,h);
  heroCtx.drawImage(img, 0,0,w,h);
  state.srcImage = img;
  state.srcW = img.naturalWidth;
  state.srcH = img.naturalHeight;
  state.previewScalePx = scale;
  updateZoom();
}

function updateZoom(){
  if (!els.heroCanvas) return;
  const z = parseInt(els.zoom.value||100,10)/100;
  els.zoomLabel.textContent = Math.round(z*100)+'%';
  els.heroCanvas.style.transformOrigin='0 0';
  els.heroCanvas.style.transform=`scale(${z})`;
}

/* Sample image for quick QA */
async function loadSample(){
  // simple 3x stripes PNG data URI
  const p = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAYAAABcVxVtAAAAL0lEQVR4nO3OwQkAMAzDsB7/0yyg7k2Gm5C0m6wFZ5zNQ8H4l0Jd2fX9n7gXx7Q2F9yA0gAAc6bq2hQ8wH8A9S0Q0S1h9BMAAAAASUVORK5CYII=';
  const img = await loadImage(await (await fetch(p)).blob()); // force Image() path
  drawHero(img);
  toast('Loaded sample');
}

/* ============ Palette Extraction (K-means quick) ============ */
function extractPalette(k=8){
  if (!els.heroCanvas || !state.srcImage) return toast('Load an image first','danger');
  k = clamp(k|0,2,16);
  const {width:w,height:h} = els.heroCanvas;
  const imgData = heroCtx.getImageData(0,0,w,h).data;

  // sample pixels (downsample if large)
  const step = Math.max(1, Math.floor(Math.sqrt((w*h) / 20000)));
  const pts=[];
  for(let y=0;y<h;y+=step)
    for(let x=0;x<w;x+=step){
      const i=(y*w+x)*4;
      const a=imgData[i+3]; if (a<10) continue;
      pts.push([imgData[i], imgData[i+1], imgData[i+2]]);
    }

  // init random seeds
  const seeds = [];
  for(let i=0;i<k;i++) seeds.push(pts[(Math.random()*pts.length)|0].slice());
  let changed=true, iter=0;
  const MAX_IT=16;
  const assign=new Array(pts.length).fill(0);

  while(changed && iter++<MAX_IT){
    changed=false;
    // assign
    for(let p=0;p<pts.length;p++){
      const v=pts[p];
      let bi=0, bd=1e18;
      for(let i=0;i<k;i++){
        const s=seeds[i];
        const d=(v[0]-s[0])**2+(v[1]-s[1])**2+(v[2]-s[2])**2;
        if(d<bd){bd=d;bi=i;}
      }
      if(assign[p]!==bi){ assign[p]=bi; changed=true; }
    }
    // recompute
    const sum=Array.from({length:k},()=>[0,0,0,0]);
    for(let p=0;p<pts.length;p++){
      const a=assign[p];
      sum[a][0]+=pts[p][0]; sum[a][1]+=pts[p][1]; sum[a][2]+=pts[p][2]; sum[a][3]++;
    }
    for(let i=0;i<k;i++){
      if(sum[i][3]>0){
        seeds[i][0]=sum[i][0]/sum[i][3];
        seeds[i][1]=sum[i][1]/sum[i][3];
        seeds[i][2]=sum[i][2]/sum[i][3];
      }
    }
  }
  // result
  const hexes = seeds.map(s=>rgbToHex(Math.round(s[0]),Math.round(s[1]),Math.round(s[2])));
  state.origPalette = dedupeHexes(hexes);
  renderOriginalPalette();
  toast(`Extracted ${state.origPalette.length} colors`);
}
function dedupeHexes(arr){
  const seen=new Set(); const out=[];
  for(const h of arr){ const L=h.toUpperCase(); if(!seen.has(L)){ seen.add(L); out.push('#'+L.replace('#','')); } }
  return out;
}
function renderOriginalPalette(){
  if(!els.origPalette) return;
  els.origPalette.innerHTML='';
  for(const hex of state.origPalette){
    const row=document.createElement('div'); row.className='swatch';
    const dot=document.createElement('div'); dot.className='dot'; dot.style.background=hex;
    const inp=document.createElement('input'); inp.type='color'; inp.value=hex;
    const label=document.createElement('div'); label.textContent=hex; label.className='mono';
    const del=document.createElement('button'); del.className='btn btn-ghost'; del.textContent='×';
    del.title='Remove';
    del.addEventListener('click',()=>{
      state.origPalette = state.origPalette.filter(h=>!sameHex(h,hex));
      renderOriginalPalette();
      autoGenerateMixesIfEnabled();
    });
    inp.addEventListener('input',()=>{
      const i=state.origPalette.findIndex(h=>sameHex(h,hex));
      if(i>=0){ state.origPalette[i]=inp.value.toUpperCase(); label.textContent=inp.value.toUpperCase(); dot.style.background=inp.value; }
      autoGenerateMixesIfEnabled();
    });
    row.append(dot, inp, label, del);
    els.origPalette.appendChild(row);
  }
}

/* ============ Restricted Palette (inks) + Kits ============ */
function renderRestricted(focusEnd=false){
  if(!els.restrictedList) return;
  els.restrictedList.innerHTML='';
  const frag=document.createDocumentFragment();

  state.restricted.forEach((ink, idx)=>{
    const card=document.createElement('div');
    card.className='restricted-item';

    const row=document.createElement('div'); row.className='row wrap';

    const dot=document.createElement('div'); dot.className='color-dot'; dot.style.background=ink.hex;
    const color=document.createElement('input'); color.type='color'; color.value=ink.hex;
    const hexLabel=document.createElement('input'); hexLabel.type='text'; hexLabel.value=ink.hex; hexLabel.className='mono'; hexLabel.style.minWidth='110px';

    const onWrap=document.createElement('label'); onWrap.className='switch';
    const on=document.createElement('input'); on.type='checkbox'; on.checked=!!ink.enabled;
    const onSpan=document.createElement('span');
    onWrap.append(on,onSpan);
    const onText=document.createElement('span'); onText.textContent='On'; onText.className='muted';

    const del=document.createElement('button'); del.className='btn btn-danger'; del.textContent='Remove';

    color.addEventListener('input', ()=>{
      ink.hex=color.value.toUpperCase(); dot.style.background=ink.hex; hexLabel.value=ink.hex;
      autoGenerateMixesIfEnabled();
    });
    hexLabel.addEventListener('change', ()=>{
      const val = hexLabel.value.trim();
      if(/^#?[0-9a-fA-F]{6}$/.test(val)){ ink.hex=('#'+val.replace('#','')).toUpperCase(); color.value=ink.hex; dot.style.background=ink.hex; }
      else { hexLabel.value=ink.hex; }
      autoGenerateMixesIfEnabled();
    });
    on.addEventListener('change', ()=> { ink.enabled=on.checked; autoGenerateMixesIfEnabled(); });
    del.addEventListener('click', ()=>{
      state.restricted.splice(idx,1); renderRestricted(); autoGenerateMixesIfEnabled();
    });

    row.append(dot,color,hexLabel,onWrap,onText,del);
    card.append(row);
    frag.append(card);
  });

  els.restrictedList.appendChild(frag);
  if (focusEnd) els.restrictedList.lastElementChild?.scrollIntoView({block:'nearest'});
}
function buildEnabledInks(){
  const set = state.restricted.filter(i=>i.enabled!==false).map(i=>i.hex);
  if (els.allowWhite?.checked && !set.some(h=>sameHex(h,'#FFFFFF'))) set.push('#FFFFFF');
  return set;
}
function fromOriginalToRestricted(){
  const base = state.origPalette.slice(0, 10).map(h=>({hex:h, enabled:true}));
  state.restricted = base;
  if (els.allowWhite?.checked) state.restricted.push({hex:'#FFFFFF', enabled:true});
  renderRestricted();
  autoGenerateMixesIfEnabled();
}
/* Kits in localStorage */
function saveKit(){
  const name=(els.kitName.value||'My Kit').trim();
  if(!name) return toast('Enter kit name','danger');
  const kits = JSON.parse(localStorage.getItem('cm_kits')||'{}');
  kits[name] = state.restricted.map(x=>({hex:x.hex, enabled:!!x.enabled}));
  localStorage.setItem('cm_kits', JSON.stringify(kits));
  toast('Kit saved');
}
function loadKit(){
  const kits = JSON.parse(localStorage.getItem('cm_kits')||'{}');
  const names=Object.keys(kits);
  if(!names.length) return toast('No kits saved yet');
  // pick first for simplicity; could add a modal list
  const name = prompt('Load which kit?\n'+names.join('\n'), names[0]);
  if(!name || !kits[name]) return;
  state.restricted = kits[name].map(x=>({hex:x.hex, enabled:!!x.enabled}));
  renderRestricted();
  autoGenerateMixesIfEnabled();
}
function deleteKit(){
  const kits = JSON.parse(localStorage.getItem('cm_kits')||'{}');
  const names=Object.keys(kits);
  if(!names.length) return toast('No kits to delete');
  const name = prompt('Delete which kit?\n'+names.join('\n'), names[0]);
  if(!name || !kits[name]) return;
  delete kits[name];
  localStorage.setItem('cm_kits', JSON.stringify(kits));
  toast('Kit deleted', 'ok');
}

/* ============ Smart Mixing (auto + per-color rule rows) ============ */

/* Find best 2- or 3-ink mix by brute-force small search (RGB least-squares) */
function bestMixForTarget(targetHex, inks, maxInks=2){
  const target = hexToRgb(targetHex);
  const combos = [];
  // build combinations of 2 or 3
  for(let i=0;i<inks.length;i++){
    for(let j=i+1;j<inks.length;j++){
      combos.push([inks[i], inks[j]]);
      if (maxInks>=3){
        for(let k=j+1;k<inks.length;k++) combos.push([inks[i], inks[j], inks[k]]);
      }
    }
  }
  let best=null, bestErr=1e18;
  for(const combo of combos){
    const rgb = combo.map(hexToRgb);
    // grid-search weights that sum to 1 (10% step)
    const step = combo.length===2? 0.05 : 0.1;
    if (combo.length===2){
      for(let a=0;a<=1.0001;a+=step){
        const b=1-a;
        const R=rgb[0].r*a + rgb[1].r*b;
        const G=rgb[0].g*a + rgb[1].g*b;
        const B=rgb[0].b*a + rgb[1].b*b;
        const err=(R-target.r)**2 + (G-target.g)**2 + (B-target.b)**2;
        if(err<bestErr){ bestErr=err; best={inks:combo, weights:[a,b]}; }
      }
    }else{
      for(let a=0;a<=1.0001;a+=step){
        for(let b=0;b<=1.0001-a;b+=step){
          const c=1-a-b;
          const R=rgb[0].r*a + rgb[1].r*b + rgb[2].r*c;
          const G=rgb[0].g*a + rgb[1].g*b + rgb[2].g*c;
          const B=rgb[0].b*a + rgb[1].b*b + rgb[2].b*c;
          const err=(R-target.r)**2 + (G-target.g)**2 + (B-target.b)**2;
          if(err<bestErr){ bestErr=err; best={inks:combo, weights:[a,b,c]}; }
        }
      }
    }
  }
  if (!best) return null;
  // Normalize weights to percentages (integers sum 100)
  let w = best.weights.map(v=>Math.max(0, v));
  const s = w.reduce((a,b)=>a+b,0)||1;
  w = w.map(v=>v/s);
  let p = w.map(v=>Math.round(v*100));
  // fix rounding to 100
  let diff = 100 - p.reduce((a,b)=>a+b,0);
  while(diff!==0){
    const idx = diff>0 ? p.indexOf(Math.min(...p)) : p.indexOf(Math.max(...p));
    p[idx]+= diff>0 ? 1 : -1;
    diff = 100 - p.reduce((a,b)=>a+b,0);
  }
  return { inks: best.inks, percents: p, err: Math.sqrt(bestErr) };
}

/* Small pattern generators */
function makeChecker(cell, fg, bg){
  const w=cell, h=cell; const c=document.createElement('canvas');
  c.width=w; c.height=h;
  const ctx=c.getContext('2d');
  ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
  ctx.fillStyle=fg;
  ctx.fillRect(0,0,Math.ceil(w/2),Math.ceil(h/2));
  ctx.fillRect(Math.floor(w/2),Math.floor(h/2),Math.ceil(w/2),Math.ceil(h/2));
  return c;
}
function makeStripe(cell, fg, bg, vertical=false){
  const c=document.createElement('canvas'); c.width=cell; c.height=cell;
  const ctx=c.getContext('2d');
  ctx.fillStyle=bg; ctx.fillRect(0,0,cell,cell);
  ctx.fillStyle=fg;
  if(vertical) ctx.fillRect(Math.floor(cell/2),0,Math.ceil(cell/2),cell);
  else ctx.fillRect(0,Math.floor(cell/2),cell,Math.ceil(cell/2));
  return c;
}
function makeDots(cell, sizePct, fg, bg, stagger=false){
  const c=document.createElement('canvas'); c.width=cell; c.height=cell;
  const ctx=c.getContext('2d');
  ctx.fillStyle=bg; ctx.fillRect(0,0,cell,cell);
  ctx.fillStyle=fg;
  const r = Math.max(1, Math.round((cell*Math.sqrt(sizePct/100))/2));
  const off = stagger? Math.floor(cell/4) : 0;
  ctx.beginPath(); ctx.arc(Math.floor(cell/2)+off, Math.floor(cell/2), r, 0, Math.PI*2); ctx.fill();
  return c;
}

/* Build a mix tile (block*cell)^2 pixels), assign ink by blue-noise-ish ranking */
function buildMixTile(block, inks, pattern='bluenoise', cellSize=3){
  const size = block * cellSize;
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const ctx=c.getContext('2d', { willReadFrequently: true });
  const ranks = [];
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      // quick quasi blue-noise: rank by (x*131 + y*197) % size
      let r = (x*131 + y*197) % (size);
      if (pattern==='checker') r = ((x/cellSize|0)+(y/cellSize|0)) % 2 ? 9999 : 0;
      if (pattern==='stripeH') r = (y% (2*cellSize))<cellSize ? 0:9999;
      if (pattern==='stripeV') r = (x% (2*cellSize))<cellSize ? 0:9999;
      if (pattern==='bayer') {
        const B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
        r = B[y%4][x%4];
      }
      ranks.push({x,y,r});
    }
  }
  ranks.sort((a,b)=>a.r-b.r);
  // paint by densities
  const total = ranks.length;
  const rgbInks = inks.map(h=>hexToRgb(h));
  const percents = state._tmpMixPercents || new Array(inks.length).fill(Math.floor(100/inks.length));
  let cuts = [];
  let acc=0;
  for(let i=0;i<percents.length;i++){
    acc += Math.round(percents[i]/100 * total);
    cuts.push(acc);
  }
  let idx=0;
  for(let i=0;i<ranks.length;i++){
    while(i>=cuts[idx]) idx++;
    const ink = rgbInks[idx] || rgbInks[rgbInks.length-1];
    ctx.fillStyle = `rgb(${ink.r},${ink.g},${ink.b})`;
    ctx.fillRect(ranks[i].x, ranks[i].y, 1, 1);
  }
  return ctx.getImageData(0,0,size,size);
}

/* Build Pattern tile for Pattern mode */
function buildPatternTile(pr){
  const cell = Math.max(2, pr.cell|0);
  const fg = pr.inkHex || (pr.inks?.[0]) || '#000000';
  const bg = pr.bgHex || '#FFFFFF';
  let tmp;
  switch(pr.shape){
    case 'checker': tmp = makeChecker(cell, fg, bg); break;
    case 'stripeH': tmp = makeStripe(cell, fg, bg, false); break;
    case 'stripeV': tmp = makeStripe(cell, fg, bg, true ); break;
    case 'dot':
    default:
      tmp = makeDots(cell, clamp((pr.size||65),10,100), fg, bg, !!pr.stagger);
      break;
  }
  const ctx=tmp.getContext('2d');
  return ctx.getImageData(0,0,tmp.width,tmp.height);
}

/* Auto-generate rules for missing colors */
function autoSmartMix(){
  const inks = buildEnabledInks();
  if(!inks.length || !state.origPalette.length) return;
  const maxInks = parseInt(els.maxInksPerMix.value||2,10);
  const sensitivity = parseInt(els.gamutSensitivity.value||60,10); // larger = more willing to mix
  const snapE = 6 + (100 - sensitivity)*0.05; // ∈ ~[6..11]

  for(const oh of state.origPalette){
    // if already exactly present among inks, clear rule
    if (inks.some(h=>sameHex(h,oh))) {
      state.rules.delete(oh);
      continue;
    }
    // try best mix
    const best = bestMixForTarget(oh, inks, maxInks);
    if(!best){ state.rules.delete(oh); continue; }
    // compute approx lab error against mix centroid
    const tgtLab = rgb2lab(...Object.values(hexToRgb(oh)));
    const mixRgb = best.inks
      .map(hexToRgb)
      .reduce((acc, rgb, i)=>({ r:acc.r+rgb.r*best.percents[i]/100,
                                g:acc.g+rgb.g*best.percents[i]/100,
                                b:acc.b+rgb.b*best.percents[i]/100 }),
              {r:0,g:0,b:0});
    const e2 = deltaE2(tgtLab, rgb2lab(mixRgb.r, mixRgb.g, mixRgb.b), 1, 1);
    const e = Math.sqrt(e2);
    if (e > snapE) {
      // if off-gamut, fallback to nearest single ink
      let nearest = inks[0], bestD=1e18;
      for(const ih of inks){
        const c=hexToRgb(ih);
        const d=(c.r-mixRgb.r)**2+(c.g-mixRgb.g)**2+(c.b-mixRgb.b)**2;
        if(d<bestD){bestD=d; nearest=ih;}
      }
      state.rules.set(oh, { on:true, mode:'mix', err:e,
        mix: { inks:[nearest], percents:[100], block: parseInt(els.mixBlock.value||6,10),
               cell: parseInt(els.mixCell.value||3,10), pattern: els.mixPattern.value } });
    } else {
      state.rules.set(oh, { on:true, mode:'mix', err:e,
        mix: { inks: best.inks, percents: best.percents,
               block: parseInt(els.mixBlock.value||6,10),
               cell:  parseInt(els.mixCell.value||3,10),
               pattern: els.mixPattern.value } });
    }
  }
  renderRulesTable();
}

/* Render rules table rows */
function renderRulesTable(){
  const tbody = els.rulesTable?.querySelector('tbody');
  if(!tbody) return;
  tbody.innerHTML='';

  for(const oh of state.origPalette){
    const rule = state.rules.get(oh) || { on:false, mode:'mix',
      mix:{ inks:[], percents:[], block:6, cell:3, pattern:'bluenoise' }, err: NaN
    };
    const tr = els.tplRule.content.firstElementChild.cloneNode(true);

    // on
    const chk = tr.querySelector('[data-fn="toggleOn"]');
    chk.checked = !!rule.on;
    chk.addEventListener('change', ()=>{ rule.on = chk.checked; });

    // original swatch
    const sw = tr.querySelector('[data-ref="origSwatch"]');
    sw.style.background = oh;

    // mode
    const modeSel = tr.querySelector('[data-ref="mode"]');
    modeSel.value = rule.mode || 'mix';

    const preview = tr.querySelector('[data-ref="preview"]');
    const pctx = preview.getContext('2d');

    // Mix params block
    const mixWrap = tr.querySelector('[data-ref="mixParams"]');
    const mixInks = tr.querySelector('[data-ref="mixInks"]');
    const mixWeights = tr.querySelector('[data-ref="mixWeights"]');
    const mixBlock = tr.querySelector('[data-ref="mixBlock"]');
    const mixCell  = tr.querySelector('[data-ref="mixCell"]');
    const mixPattern=tr.querySelector('[data-ref="mixPattern"]');

    // Pattern params block
    const patWrap = tr.querySelector('[data-ref="patternParams"]');
    const patShape= tr.querySelector('[data-ref="shape"]');
    const patBG   = tr.querySelector('[data-ref="bgHex"]');
    const patInks = tr.querySelector('[data-ref="shapeInks"]');
    const patCell = tr.querySelector('[data-ref="patCell"]');
    const patSize = tr.querySelector('[data-ref="shapeSize"]');
    const patSizeOut = tr.querySelector('[data-ref="shapeSizeOut"]');
    const patStag = tr.querySelector('[data-ref="stagger"]');
    const patBlock= tr.querySelector('[data-ref="patBlock"]');

    function refreshPreview(){
      pctx.clearRect(0,0,64,64);
      if(modeSel.value==='mix'){
        state._tmpMixPercents = rule.mix.percents;
        const tile = buildMixTile(rule.mix.block|0, rule.mix.inks, rule.mix.pattern, rule.mix.cell|0);
        const tmp=document.createElement('canvas'); tmp.width=tile.width; tmp.height=tile.height;
        tmp.getContext('2d').putImageData(tile,0,0);
        pctx.imageSmoothingEnabled=false;
        pctx.fillStyle='#fff'; pctx.fillRect(0,0,64,64);
        for(let y=0;y<64;y+=tile.height)
          for(let x=0;x<64;x+=tile.width)
            pctx.drawImage(tmp,x,y);
      } else {
        const pr = {
          shape: patShape.value, bgHex: patBG.value,
          inkHex: rule.pattern?.inks?.[0] || patInks.querySelector('input')?.value || '#000000',
          size:  parseInt(patSize.value,10)||65,
          cell:  parseInt(patCell.value,10)||3,
          stagger: !!patStag.checked
        };
        const tile = buildPatternTile(pr);
        const tmp=document.createElement('canvas'); tmp.width=tile.width; tmp.height=tile.height;
        tmp.getContext('2d').putImageData(tile,0,0);
        pctx.imageSmoothingEnabled=false;
        for(let y=0;y<64;y+=tile.height)
          for(let x=0;x<64;x+=tile.width)
            pctx.drawImage(tmp,x,y);
      }
    }

    function renderInkPills(container, list, asPattern=false){
      container.innerHTML='';
      const inks = buildEnabledInks();
      if (asPattern && !list.length) list.push(inks[0]||'#000000');
      list.forEach((hex, idx)=>{
        const pill=document.createElement('span'); pill.className='pill';
        const dot=document.createElement('span'); dot.className='dot'; dot.style.background=hex;
        const pick=document.createElement('input'); pick.type='color'; pick.value=hex;
        pick.addEventListener('input',()=>{
          list[idx]=pick.value.toUpperCase(); dot.style.background=pick.value;
          if(!asPattern) refreshPreview();
        });
        const rm=document.createElement('button'); rm.className='btn btn-ghost'; rm.textContent='×';
        rm.addEventListener('click',()=>{ list.splice(idx,1); renderInkPills(container, list, asPattern); refreshPreview(); });
        pill.append(dot,pick,rm);
        container.appendChild(pill);
      });
      const add=document.createElement('button'); add.className='btn btn-ghost'; add.textContent='+';
      add.addEventListener('click',()=>{ list.push(inks[0]||'#000000'); renderInkPills(container,list,asPattern); refreshPreview(); });
      container.appendChild(add);
    }

    /* Initialize rule defaults if missing */
    if (modeSel.value==='mix' && (!rule.mix || !rule.mix.inks?.length)){
      rule.mix = { inks: [buildEnabledInks()[0]||'#000000'], percents:[100], block:6, cell:3, pattern:'bluenoise' };
    }
    if (modeSel.value==='pattern' && !rule.pattern){
      rule.pattern = { shape:'dot', bgHex:'#FFFFFF', inks:[buildEnabledInks()[0]||'#000000'], size:65, cell:3, stagger:false, block:6 };
    }

    // hook mode toggle
    function updateModeUI(){
      if(modeSel.value==='mix'){
        mixWrap.classList.remove('hidden');
        patWrap.classList.add('hidden');
      } else {
        mixWrap.classList.add('hidden');
        patWrap.classList.remove('hidden');
      }
      refreshPreview();
    }
    modeSel.addEventListener('change', ()=>{
      rule.mode = modeSel.value;
      updateModeUI();
    });

    // init MIX controls
    mixBlock.value = rule.mix.block|0;   mixCell.value = rule.mix.cell|0;   mixPattern.value = rule.mix.pattern||'bluenoise';
    renderInkPills(mixInks,  rule.mix.inks||[]);
    // weights
    function renderWeights(){
      mixWeights.innerHTML='';
      rule.mix.percents = (rule.mix.percents?.length===rule.mix.inks.length) ? rule.mix.percents : new Array(rule.mix.inks.length).fill(Math.floor(100/(rule.mix.inks.length||1))||100);
      rule.mix.percents.forEach((v,i)=>{
        const row=document.createElement('div'); row.className='row';
        const rng=document.createElement('input'); rng.type='range'; rng.min=0; rng.max=100; rng.value=v; rng.className='mix-ink-range';
        const out=document.createElement('span'); out.className='mix-ink-val mono'; out.textContent=v+'%';
        rng.addEventListener('input', ()=>{
          rule.mix.percents[i]=parseInt(rng.value,10);
          // normalize to sum 100
          const sum = rule.mix.percents.reduce((a,b)=>a+b,0);
          if(sum!==100 && rule.mix.percents.length){
            const idx = i===0?1:0;
            if(rule.mix.percents[idx]!=null){
              rule.mix.percents[idx] = clamp(rule.mix.percents[idx] + (100 - sum), 0, 100);
            }
          }
          out.textContent = rule.mix.percents[i]+'%';
          refreshPreview();
        });
        row.append(rng,out);
        mixWeights.appendChild(row);
      });
    }
    renderWeights();
    mixBlock.addEventListener('change', ()=>{ rule.mix.block=parseInt(mixBlock.value,10)||6; refreshPreview(); });
    mixCell .addEventListener('change', ()=>{ rule.mix.cell =parseInt(mixCell.value,10)||3; refreshPreview(); });
    mixPattern.addEventListener('change', ()=>{ rule.mix.pattern=mixPattern.value; refreshPreview(); });

    // init PATTERN controls
    if (!rule.pattern) rule.pattern = { shape:'dot', bgHex:'#FFFFFF', inks:[buildEnabledInks()[0]||'#000000'], size:65, cell:3, stagger:false, block:6 };
    patShape.value = rule.pattern.shape;
    patBG.value    = rule.pattern.bgHex || '#FFFFFF';
    patCell.value  = rule.pattern.cell || 3;
    patSize.value  = rule.pattern.size || 65; patSizeOut.textContent=(rule.pattern.size||65)+'%';
    patStag.checked= !!rule.pattern.stagger;
    patBlock.value = rule.pattern.block || 6;
    renderInkPills(patInks, rule.pattern.inks||['#000000'], true);

    // bind PATTERN events
    patShape.addEventListener('change', ()=>{ rule.pattern.shape=patShape.value; refreshPreview(); });
    patBG.addEventListener('change',   ()=>{ rule.pattern.bgHex=patBG.value.toUpperCase(); refreshPreview(); });
    patCell.addEventListener('change', ()=>{ rule.pattern.cell=parseInt(patCell.value,10)||3; refreshPreview(); });
    patSize.addEventListener('input',  ()=>{ rule.pattern.size=parseInt(patSize.value,10)||65; patSizeOut.textContent=rule.pattern.size+'%'; refreshPreview(); });
    patStag.addEventListener('change', ()=>{ rule.pattern.stagger=!!patStag.checked; refreshPreview(); });
    patBlock.addEventListener('change',()=>{ rule.pattern.block=parseInt(patBlock.value,10)||6; refreshPreview(); });

    // actions & ΔE
    tr.querySelector('[data-ref="errOut"]').textContent = isFinite(rule.err)? (rule.err.toFixed(2)) : '—';
    tr.querySelector('[data-fn="reset"]').addEventListener('click', ()=>{
      state.rules.delete(oh);
      renderRulesTable();
    });

    // finalize
    tbody.appendChild(tr);
    updateModeUI();
  });
}

function autoGenerateMixesIfEnabled(){
  if (els.autoSmart?.checked) {
    autoSmartMix();
  } else {
    renderRulesTable();
  }
}

/* ============ Mapping (preview) ============ */
function currentParamsHash(scale=1){
  const params = {
    inks: buildEnabledInks(),
    rules: [...state.rules.entries()],
    wL: +els.wLight.value, wC:+els.wChroma.value,
    dither: !!els.useDither.checked,
    sharpen: !!els.useSharpen.checked,
    bg: els.bgMode.value,
    scale
  };
  return JSON.stringify(params);
}

function getScaledSrcImageData(scale){
  const w = Math.round(state.srcW * scale);
  const h = Math.round(state.srcH * scale);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const cx=c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  cx.drawImage(state.srcImage, 0,0,w,h);
  return { imageData: cx.getImageData(0,0,w,h), width:w, height:h };
}

function applyMappingPreview(){
  if(!state.srcImage) return toast('Load an image first','danger');
  const pScale = parseFloat(els.previewScale.value||'1');
  const paramsHash = currentParamsHash(pScale);
  if (state.lastPreview.paramsHash === paramsHash &&
      state.lastPreview.previewScale === pScale &&
      state.mappedImageData && state.mappedImageData.width && state.mappedImageData.height){
    // already up-to-date
    els.mapProgress?.classList.add('hidden');
    return;
  }

  els.mapProgressLabel.textContent='Mapping…';
  els.mapProgress.classList.remove('hidden');

  const { imageData, width, height } = getScaledSrcImageData(pScale);

  const wL = (+els.wLight.value||100)/100;
  const wC = (+els.wChroma.value||100)/100;
  const dither = !!els.useDither.checked;
  const doSharpen = !!els.useSharpen.checked;
  const snapE2 = 1.2;

  // build ink list incl. rule-mix special tiles
  const inkLabs = buildEnabledInks().map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { type:'ink', hex, rgb:{r,g,b}, lab: rgb2lab(r,g,b) };
  });

  //  Per-color overrides: store quickly
  const activeRules = new Map();
  state.rules.forEach((r, key)=>{
    if(!r.on) return;
    activeRules.set(key, r);
  });

  const err = dither ? new Float32Array(width * height * 3) : null;
  const out = new ImageData(width, height);
  const src = imageData;

  const ruleCache = {}; // prebuild tiles per rule for speed
  function getRuleTile(rule){
    const key = JSON.stringify(rule);
    if (ruleCache[key]) return ruleCache[key];
    if (rule.mode==='mix'){
      state._tmpMixPercents = rule.mix.percents;
      ruleCache[key] = buildMixTile(rule.mix.block|0, rule.mix.inks, rule.mix.pattern, rule.mix.cell|0);
    } else {
      ruleCache[key] = buildPatternTile(rule.pattern);
    }
    return ruleCache[key];
  }

  // main loop
  for (let y=0;y<height;y++){
    for (let x=0;x<width;x++){
      const idx = (y * width + x);
      const i4 = idx * 4;
      let r = src.data[i4], g = src.data[i4+1], b = src.data[i4+2], a = src.data[i4+3];
      if (a < 10) { out.data.set([0,0,0,0], i4); continue; }

      if (dither) {
        r = clamp(r + err[idx * 3 + 0], 0, 255);
        g = clamp(g + err[idx * 3 + 1], 0, 255);
        b = clamp(b + err[idx * 3 + 2], 0, 255);
      }

      // nearest original for rule mapping
      let nearestOrig = null;
      if (state.origPalette.length && activeRules.size){
        let bestHex = null, bestD = 1e18;
        for (const oh of state.origPalette) {
          const c = hexToRgb(oh);
          const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d2 < bestD) { bestD = d2; bestHex = oh; }
        }
        nearestOrig = bestHex;
      }

      // rule override?
      const rule = nearestOrig ? activeRules.get(nearestOrig) : null;
      if (rule){
        const tile = getRuleTile(rule);
        // tile addressing
        const block = (rule.mode==='mix') ? (rule.mix.block|0) : (rule.pattern.block|0);
        const cell  = (rule.mode==='mix') ? (rule.mix.cell|0) : (rule.pattern.cell|0);
        const full  = Math.max(1, block*cell);
        const tx = x % full, ty = y % full;
        const ti = (ty*tile.width + tx)*4;
        out.data[i4+0]=tile.data[ti+0];
        out.data[i4+1]=tile.data[ti+1];
        out.data[i4+2]=tile.data[ti+2];
        out.data[i4+3]=a;
        if (dither){
          const er = r - tile.data[ti+0];
          const eg = g - tile.data[ti+1];
          const eb = b - tile.data[ti+2];
          fsPropagate(err, width, x, y, er, eg, eb);
        }
        continue;
      }

      // otherwise nearest ink
      const lab = rgb2lab(r,g,b);
      let chosen = inkLabs[0], bestE = 1e18;
      for (const ink of inkLabs) {
        const e2 = deltaE2(lab, ink.lab, wL, wC);
        if (e2 < bestE) { bestE = e2; chosen = ink; }
        if (e2 < snapE2) { chosen = ink; bestE = e2; break; }
      }
      out.data[i4 + 0] = chosen.rgb.r;
      out.data[i4 + 1] = chosen.rgb.g;
      out.data[i4 + 2] = chosen.rgb.b;
      out.data[i4 + 3] = a;

      if (dither) {
        const er = r - chosen.rgb.r;
        const eg = g - chosen.rgb.g;
        const eb = b - chosen.rgb.b;
        fsPropagate(err, width, x, y, er, eg, eb);
      }
    }
    if (y % 64 === 0) els.mapProgressLabel.textContent = `Mapping… ${Math.round((y/height)*100)}%`;
  }

  if (doSharpen) unsharp(out);

  // BG mode (for preview canvas only)
  els.mappedCanvas.width = width; els.mappedCanvas.height = height;
  mappedCtx.imageSmoothingEnabled = false;
  if (els.bgMode.value==='white'){ mappedCtx.fillStyle='#FFFFFF'; mappedCtx.fillRect(0,0,width,height); }
  if (els.bgMode.value==='transparent'){ mappedCtx.clearRect(0,0,width,height); }
  mappedCtx.putImageData(out, 0, 0);

  state.mappedImageData = out; // cache latest (at preview scale)
  state.lastPreview = { paramsHash, previewScale: pScale, w:width, h:height };
  els.mapProgress.classList.add('hidden');
}

/* ============ Projects (localStorage) ============ */
function openProjects(){ els.projectsPane?.classList.add('show'); els.projectsPane?.classList.remove('hidden'); listProjects(); }
function closeProjects(){ els.projectsPane?.classList.remove('show'); setTimeout(()=>els.projectsPane?.classList.add('hidden'), 280); }
function listProjects(){
  const store = JSON.parse(localStorage.getItem('cm_projects')||'{}');
  els.projectsList.innerHTML='';
  for (const [id, proj] of Object.entries(store)){
    const li=document.createElement('li');
    const a=document.createElement('div'); a.textContent=proj.name||('Project '+id);
    const load=document.createElement('button'); load.className='btn'; load.textContent='Load';
    load.addEventListener('click', ()=> loadProject(id));
    li.append(a,load);
    els.projectsList.appendChild(li);
  }
}
function saveProject(){
  const id='p'+Date.now();
  const payload = {
    name: prompt('Project name?', 'Untitled '+(++state.projectCounter)) || 'Untitled',
    srcW: state.srcW, srcH: state.srcH,
    origPalette: state.origPalette,
    restricted: state.restricted,
    rules: Array.from(state.rules.entries()),
    settings: {
      wLight:+els.wLight.value, wChroma:+els.wChroma.value,
      dither: !!els.useDither.checked, sharpen: !!els.useSharpen.checked,
      bgMode: els.bgMode.value
    }
  };
  const store = JSON.parse(localStorage.getItem('cm_projects')||'{}');
  store[id]=payload;
  localStorage.setItem('cm_projects', JSON.stringify(store));
  toast('Project saved','ok'); listProjects();
}
function loadProject(id){
  const store = JSON.parse(localStorage.getItem('cm_projects')||'{}');
  const p = store[id]; if(!p) return toast('Project not found','danger');
  state.origPalette = p.origPalette||[];
  state.restricted  = p.restricted||[];
  state.rules = new Map(p.rules||[]);
  els.wLight.value = p.settings?.wLight ?? 100;
  els.wChroma.value= p.settings?.wChroma?? 100;
  els.useDither.checked = !!p.settings?.dither;
  els.useSharpen.checked= !!p.settings?.sharpen;
  els.bgMode.value = p.settings?.bgMode || 'keep';
  renderOriginalPalette(); renderRestricted(); renderRulesTable();
  toast('Project loaded','ok');
}
function exportProject(){
  const payload = {
    version: 1,
    origPalette: state.origPalette,
    restricted: state.restricted,
    rules: Array.from(state.rules.entries())
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  download(url, 'cup-mapper-project.json');
}
function importProjectFile(file){
  const fr=new FileReader();
  fr.onload=()=>{
    try{
      const p=JSON.parse(fr.result);
      state.origPalette=p.origPalette||[];
      state.restricted=p.restricted||[];
      state.rules=new Map(p.rules||[]);
      renderOriginalPalette(); renderRestricted(); renderRulesTable();
      toast('Project imported','ok');
    }catch(e){ toast('Invalid project file','danger'); }
  };
  fr.readAsText(file);
}
function deleteProject(){
  const store = JSON.parse(localStorage.getItem('cm_projects')||'{}');
  const keys = Object.keys(store);
  if(!keys.length) return toast('No projects to delete');
  const id = prompt('Delete which id?\n'+keys.join('\n'), keys[0]);
  if(!id || !store[id]) return;
  delete store[id];
  localStorage.setItem('cm_projects', JSON.stringify(store));
  listProjects(); toast('Deleted','ok');
}
function download(url, name){
  const a=document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

/* ============ Eyedropper (if supported) ============ */
async function doEyedropper(){
  if ('EyeDropper' in window){
    try{
      const res = await new window.EyeDropper().open();
      state.origPalette.push(res.sRGBHex.toUpperCase());
      state.origPalette = dedupeHexes(state.origPalette);
      renderOriginalPalette();
      autoGenerateMixesIfEnabled();
    }catch(e){ /* cancelled */ }
  } else {
    toast('Your browser does not support the EyeDropper API','danger');
  }
}

/* ============ Export (provided block; wired to our elements) ============ */

/* expose helpers the export block expects */
function rgbToHexSafe(r,g,b){ return rgbToHex(r,g,b); }

/* Map names used in the export starter to current IDs */
els.btnMap = els.applyBtn;
const outCtx = mappedCtx;
els.outCanvas = els.mappedCanvas;

/* -------------------- Stage 6: Export (full-res remap before save) -------------------- */
els.btnExportPNG?.addEventListener('click', exportPNG);
els.btnExportSVG?.addEventListener('click', exportSVG);
els.btnExportReport?.addEventListener('click', exportReport);

// Small helper to show/hide the existing progress pill during export too
function beginBusy(label = 'Processing…') {
  els.mapProgressLabel.textContent = label;
  els.mapProgress.classList.remove('hidden');
  els.btnExportPNG && (els.btnExportPNG.disabled = true);
  els.btnExportSVG && (els.btnExportSVG.disabled = true);
  els.btnMap && (els.btnMap.disabled = true);
}
function endBusy() {
  els.mapProgress.classList.add('hidden');
  els.btnExportPNG && (els.btnExportPNG.disabled = false);
  els.btnExportSVG && (els.btnExportSVG.disabled = false);
  els.btnMap && (els.btnMap.disabled = false);
}

// Typical safe canvas limits across browsers (very conservative)
const MAX_DIM   = 16384;        // clamp per-axis dimension
const MAX_PIXELS = 268_000_000; // ~268 MP area cap

function ensureFullResMap(cb){
  let enabled=buildEnabledInks();
  if (enabled.length===0){
    enabled = state.origPalette.slice(0, Math.min(10, state.origPalette.length));
    state.restricted = enabled.map(h => ({hex:h, enabled:true}));
    renderRestricted(true);
  }

  const paramsHashFull = currentParamsHash(1);
  const upToDate = state.mappedImageData &&
                   state.lastPreview.paramsHash === paramsHashFull &&
                   state.lastPreview.previewScale === 1 &&
                   state.mappedImageData.width === state.srcW &&
                   state.mappedImageData.height === state.srcH;

  if (upToDate) return cb(state.mappedImageData);

  beginBusy('Building export…');

  const { imageData, width, height } = getScaledSrcImageData(1);
  const wL = (+els.wLight.value||100)/100;
  const wC = (+els.wChroma.value||100)/100;
  const dither = !!els.useDither.checked;
  const doSharpen = !!els.useSharpen.checked;
  const snapE2 = 1.2;

  const inkLabs = buildEnabledInks().map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, rgb:{r,g,b}, lab: rgb2lab(r,g,b) };
  });

  // Build quick lookup to nearest original
  const err = dither ? new Float32Array(width * height * 3) : null;

  // Precompute rule tiles
  const activeRules = new Map();
  state.rules.forEach((r,k)=>{ if(r.on) activeRules.set(k,r); });
  const ruleCache = {};
  function getRuleTile(rule){
    const key = JSON.stringify(rule);
    if (ruleCache[key]) return ruleCache[key];
    if (rule.mode==='mix'){
      state._tmpMixPercents = rule.mix.percents;
      ruleCache[key] = buildMixTile(rule.mix.block|0, rule.mix.inks, rule.mix.pattern, rule.mix.cell|0);
    } else {
      ruleCache[key] = buildPatternTile(rule.pattern);
    }
    return ruleCache[key];
  }

  const src = imageData;
  const out = new ImageData(width, height);

  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      const idx = (y * width + x);
      const i4 = idx * 4;
      let r = src.data[i4], g = src.data[i4+1], b = src.data[i4+2], a = src.data[i4+3];
      if (a < 10) { out.data.set([0,0,0,0], i4); continue; }

      if (dither) {
        r = clamp(r + err[idx * 3 + 0], 0, 255);
        g = clamp(g + err[idx * 3 + 1], 0, 255);
        b = clamp(b + err[idx * 3 + 2], 0, 255);
      }

      // nearest original for 4a/4b
      let nearestOrig = null;
      if ((activeRules.size)) {
        let bestHex = null, bestD = 1e18;
        for (const oh of state.origPalette) {
          const c = hexToRgb(oh);
          const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d2 < bestD) { bestD = d2; bestHex = oh; }
        }
        nearestOrig = bestHex;
      }

      const rule = nearestOrig ? activeRules.get(nearestOrig) : null;
      if (rule){
        const tile = getRuleTile(rule);
        const block = (rule.mode==='mix') ? (rule.mix.block|0) : (rule.pattern.block|0);
        const cell  = (rule.mode==='mix') ? (rule.mix.cell|0)  : (rule.pattern.cell|0);
        const fullBlock = Math.max(1, block*cell);
        const mx = x % fullBlock, my = y % fullBlock;
        const mi = (my * tile.width + mx) * 4;
        out.data[i4 + 0] = tile.data[mi + 0];
        out.data[i4 + 1] = tile.data[mi + 1];
        out.data[i4 + 2] = tile.data[mi + 2];
        out.data[i4 + 3] = a;
        if (dither) {
          const er = r - tile.data[mi + 0];
          const eg = g - tile.data[mi + 1];
          const eb = b - tile.data[mi + 2];
          fsPropagate(err, width, x, y, er, eg, eb);
        }
        continue;
      }

      const lab = rgb2lab(r,g,b);
      let chosen = null, bestE = 1e18;
      for (const ink of inkLabs) {
        const e2 = deltaE2(lab, ink.lab, wL, wC);
        if (e2 < bestE) { bestE = e2; chosen = ink; }
        if (e2 < snapE2) { chosen = ink; bestE = e2; break; }
      }
      out.data[i4 + 0] = chosen.rgb.r;
      out.data[i4 + 1] = chosen.rgb.g;
      out.data[i4 + 2] = chosen.rgb.b;
      out.data[i4 + 3] = a;

      if (dither) {
        const er = r - chosen.rgb.r;
        const eg = g - chosen.rgb.g;
        const eb = b - chosen.rgb.b;
        fsPropagate(err, width, x, y, er, eg, eb);
      }
    }
    if (y % 64 === 0) els.mapProgressLabel.textContent = `Building export… ${Math.round((y/height)*100)}%`;
  }

  if (doSharpen) unsharp(out);

  state.mappedImageData = out;
  state.lastPreview = { paramsHash: paramsHashFull, previewScale: 1, w: width, h: height };
  els.outCanvas.width = width; els.outCanvas.height = height;
  outCtx.putImageData(out, 0, 0);
  endBusy();
  cb(out);
}

/* ------ NEW: fast + memory-safe tiled upscaler for PNG ------ */
async function drawScaledTiled(dstCtx, srcImgData, scale, onProgress) {
  const sw = srcImgData.width, sh = srcImgData.height;
  const tile = 512; // tile size in source pixels (keeps temp memory tiny)
  dstCtx.imageSmoothingEnabled = false;

  // Use createImageBitmap when available (faster & lean)
  const canBitmap = 'createImageBitmap' in window;

  for (let sy = 0; sy < sh; sy += tile) {
    const shh = Math.min(tile, sh - sy);
    for (let sx = 0; sx < sw; sx += tile) {
      const sww = Math.min(tile, sw - sx);

      if (canBitmap) {
        // Crop directly from ImageData without making a big temp canvas
        const bmp = await createImageBitmap(srcImgData, sx, sy, sww, shh);
        dstCtx.drawImage(bmp, sx * scale, sy * scale, sww * scale, shh * scale);
        bmp.close?.();
      } else {
        // Fallback: tiny temp canvas for this tile only
        const t = document.createElement('canvas');
        t.width = sww; t.height = shh;
        const tctx = t.getContext('2d', { willReadFrequently: true });
        const part = new ImageData(
          srcImgData.data.slice((sy * sw + sx) * 4, (sy * sw + sx) * 4 + shh * sw * 4),
          sw, shh
        );
        // putImageData can't offset into the slice horizontally, so copy row-by-row:
        const row = new ImageData(sww, 1);
        for (let y = 0; y < shh; y++) {
          const off = (y * sw + sx) * 4;
          row.data.set(srcImgData.data.slice(off, off + sww * 4));
          tctx.putImageData(row, 0, y);
        }
        dstCtx.drawImage(t, sx * scale, sy * scale, sww * scale, shh * scale);
      }
    }
    onProgress?.(Math.round((sy + shh) / sh * 100));
    // Yield to UI
    await new Promise(r => setTimeout(r, 0));
  }
}

function clampExportScale(w, h, desiredScale) {
  let scale = Math.max(1, Math.floor(desiredScale));
  // Per-axis clamp
  scale = Math.min(scale, Math.floor(MAX_DIM / Math.max(1, w)));
  scale = Math.min(scale, Math.floor(MAX_DIM / Math.max(1, h)));
  // Area clamp
  while ((w * scale) * (h * scale) > MAX_PIXELS && scale > 1) scale--;
  return Math.max(1, scale);
}

function exportPNG(){
  if(!state.srcW) return toast('Load an image first','danger');

  ensureFullResMap(async (fullImg)=>{
    let scale = +els.exportScale.value || 1;
    const transparent = !!els.exportTransparent.checked;

    // Safety clamp to the largest sane size the browser can handle
    const safeScale = clampExportScale(fullImg.width, fullImg.height, scale);
    if (safeScale < scale) {
      toast(`Scale clamped to ${safeScale}× for browser limits`, 'danger');
      scale = safeScale;
      els.exportScale.value = String(scale);
    }

    const outW = fullImg.width * scale;
    const outH = fullImg.height * scale;

    beginBusy('Exporting PNG…');

    // Create destination canvas
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;

    // Optional white background
    if (!transparent) { cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, outW, outH); }

    // Tiled, nearest-neighbour exact scale
    try {
      await drawScaledTiled(cx, fullImg, scale, (p)=> {
        els.mapProgressLabel.textContent = `Exporting PNG… ${p}%`;
      });
    } catch (e) {
      // Fallback to one-shot draw if tiling fails (still nearest-neighbour)
      const tmp = document.createElement('canvas');
      tmp.width = fullImg.width; tmp.height = fullImg.height;
      tmp.getContext('2d').putImageData(fullImg, 0, 0);
      cx.drawImage(tmp, 0, 0, outW, outH);
    }

    c.toBlob((blob)=>{
      endBusy();
      if(!blob){ toast('PNG export failed', 'danger'); return; }
      const url = URL.createObjectURL(blob);
      els.downloadLink.href = url;
      els.downloadLink.download = 'cup-mapper.png';
      els.downloadLink.style.display = 'inline-flex';
      els.downloadLink.textContent = 'Download PNG';
      toast('PNG ready');
    }, 'image/png');
  });
}

function exportSVG(){
  if(!state.srcW) return toast('Load an image first','danger');
  ensureFullResMap((img)=>{
    beginBusy('Exporting SVG…');
    const {width,height,data}=img;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`;
    for(let y=0;y<height;y++){
      const row=y*width*4;
      for(let x=0;x<width;x++){
        const i=row+x*4; const a=data[i+3]; if(a<10) continue;
        const hex=rgbToHex(data[i],data[i+1],data[i+2]);
        svg+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
      }
      if (y % 128 === 0) els.mapProgressLabel.textContent = `Exporting SVG… ${Math.round((y/height)*100)}%`;
    }
    svg+=`</svg>`;
    const blob=new Blob([svg],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);
    els.downloadLink.href=url; els.downloadLink.download='cup-mapper.svg';
    els.downloadLink.style.display='inline-flex'; els.downloadLink.textContent='Download SVG';
    endBusy();
    toast('SVG ready');
  });
}

function exportReport(){
  const lines=[];
  lines.push('Cup Mapper — Report');
  lines.push('');
  lines.push('Original Palette:');
  for(const h of state.origPalette) lines.push('  - '+h);
  lines.push('');
  lines.push('Restricted Inks:');
  for(const i of state.restricted) lines.push(`  - ${i.enabled?'[x]':'[ ]'} ${i.hex}`);
  lines.push('');
  lines.push('Rules:');
  for(const [oh, r] of state.rules.entries()){
    if(!r.on){ lines.push(`  - ${oh}: (off)`); continue; }
    if(r.mode==='mix'){
      lines.push(`  - ${oh}: MIX  inks=[${r.mix.inks.join(', ')}]  perc=[${r.mix.percents.join('% , ')}%]  block=${r.mix.block}  cell=${r.mix.cell}  pattern=${r.mix.pattern}`);
    } else {
      lines.push(`  - ${oh}: PATTERN  shape=${r.pattern.shape}  bg=${r.pattern.bgHex}  inks=[${(r.pattern.inks||[]).join(', ')}]  cell=${r.pattern.cell}  size=${r.pattern.size}% stagger=${r.pattern.stagger?'Y':'N'}`);
    }
  }
  const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  els.downloadLink.href=url; els.downloadLink.download='cup-mapper-report.txt';
  els.downloadLink.style.display='inline-flex'; els.downloadLink.textContent='Download Report';
  toast('Report ready');
}

/* ============ Wire up UI events ============ */
// Topbar dialogs
els.btnOpenHelp?.addEventListener('click', ()=> els.dlgHelp?.showModal());
els.btnCloseHelp?.addEventListener('click', ()=> els.dlgHelp?.close());
els.btnOpenAbout?.addEventListener('click', ()=> els.dlgAbout?.showModal());
els.btnCloseAbout?.addEventListener('click', ()=> els.dlgAbout?.close());

// Upload & preview
els.fileInput?.addEventListener('change', async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const img=await loadImage(f); drawHero(img);
});
els.btnLoadSample?.addEventListener('click', loadSample);
els.btnClear?.addEventListener('click', ()=>{
  state.srcImage=null; state.srcW=state.srcH=0;
  els.heroCanvas.width=els.heroCanvas.height=0;
  els.mappedCanvas.width=els.mappedCanvas.height=0;
  toast('Cleared');
});
els.maxW?.addEventListener('change', ()=> state.srcImage && drawHero(state.srcImage));
els.zoom?.addEventListener('input', updateZoom);
els.btnZoomFit?.addEventListener('click', ()=>{ els.zoom.value='100'; updateZoom(); });
els.btnZoom100?.addEventListener('click', ()=>{ els.zoom.value='100'; updateZoom(); });

// Original palette
els.kClusters?.addEventListener('input', ()=> els.kClustersOut.textContent=els.kClusters.value);
els.btnExtract?.addEventListener('click', ()=> extractPalette(parseInt(els.kClusters.value||'8',10)));
els.btnEyedropper?.addEventListener('click', doEyedropper);

// Restricted palette
els.btnFromOriginal?.addEventListener('click', fromOriginalToRestricted);
els.allowWhite?.addEventListener('change', ()=>{ renderRestricted(); autoGenerateMixesIfEnabled(); });
els.btnAddInk?.addEventListener('click', ()=>{
  state.restricted.push({hex:'#0099FF', enabled:true});
  renderRestricted(true); autoGenerateMixesIfEnabled();
});
els.btnSaveKit?.addEventListener('click', saveKit);
els.btnLoadKit?.addEventListener('click', loadKit);
els.btnDeleteKit?.addEventListener('click', deleteKit);

// Smart mixing controls
els.gamutSensitivity?.addEventListener('input', ()=> els.gamutSensitivityOut.textContent=els.gamutSensitivity.value);
els.btnGenerateMixes?.addEventListener('click', autoSmartMix);
els.autoSmart?.addEventListener('change', autoGenerateMixesIfEnabled);

// Mapping
function syncWeightsUI(){
  els.wLightOut.textContent=( (+els.wLight.value||100)/100 ).toFixed(2);
  els.wChromaOut.textContent=( (+els.wChroma.value||100)/100 ).toFixed(2);
}
['input','change'].forEach(ev=>{
  els.wLight?.addEventListener(ev, syncWeightsUI);
  els.wChroma?.addEventListener(ev, syncWeightsUI);
});
syncWeightsUI();

els.applyBtn?.addEventListener('click', applyMappingPreview);
els.bigRegen?.addEventListener('click', ()=>{ autoSmartMix(); applyMappingPreview(); });

// Projects
els.openProjects?.addEventListener('click', openProjects);
els.closeProjects?.addEventListener('click', closeProjects);
els.refreshProjects?.addEventListener('click', listProjects);
els.saveProject?.addEventListener('click', saveProject);
els.exportProject?.addEventListener('click', exportProject);
els.importProject?.addEventListener('change', (e)=> {
  const f = e.target.files?.[0]; if (f) importProjectFile(f);
});
els.deleteProject?.addEventListener('click', deleteProject);

// Initial UI
if (els.kClustersOut) els.kClustersOut.textContent = els.kClusters?.value || '8';
if (els.gamutSensitivityOut) els.gamutSensitivityOut.textContent = els.gamutSensitivity?.value || '60';
toast('Ready');

