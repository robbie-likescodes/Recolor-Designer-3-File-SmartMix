// Recolor Designer — app.js (ES Module)
// -----------------------------------------------------------------------------
// Zero-dependency, browser-only implementation that wires up the full UI in
// index.html, provides: upload/preview, k-means palette, restricted inks,
// Auto Smart Mix (2–3 inks), Pattern Replace (shapes on BG), mapping,
// PNG/SVG/Report export, and project persistence.
// -----------------------------------------------------------------------------

/* ========================= DOM HELPERS ========================= */
const $ = (id, root=document) => root.getElementById(id);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, attrs={}) => { const n = document.createElement(tag); if(cls) n.className=cls; for(const k in attrs) n.setAttribute(k, attrs[k]); return n; };

/* ========================= GLOBAL STATE ========================= */
const State = {
  // Image
  img: null,               // HTMLImageElement
  imgBitmap: null,         // ImageBitmap (optional)
  srcW: 0, srcH: 0,
  maxPreviewW: 1600,

  // Canvases
  hero: $('#heroCanvas'),
  mapped: $('#mappedCanvas'),

  // Palettes
  origPalette: [],         // [{r,g,b, hex}]
  restricted: [],          // [{r,g,b, hex, on:true}]

  // Rules (per original color index)
  rules: [],               // Array<MixRule>

  // Options
  opts: {
    wLight: 1, wChroma: 1,
    dither: false, sharpen: false,
    bgMode: 'keep',
    previewScale: 1,
  },

  // Auto Smart Mix options
  auto: {
    enabled: true,
    maxInksPerMix: 2,
    gamutSensitivity: 0.6, // 0..1; higher means more willing to mix
    block: 6,
    cell: 3,
    pattern: 'bluenoise',
  },

  // Derived
  srcPreview: null,        // ImageData (preview resolution)
  mappedPreview: null,     // ImageData (preview resolution)
  previewZoom: 1,

  // Projects
  kits: {},                // name -> [hex,...]
  projects: {},            // name -> serialized JSON
};

/* ========================= UI ELEMENTS ========================= */
const els = {
  // Header / dialogs / projects
  btnOpenHelp: $('#btnOpenHelp'),
  btnOpenAbout: $('#btnOpenAbout'),
  btnCloseHelp: $('#btnCloseHelp'),
  btnCloseAbout: $('#btnCloseAbout'),
  dlgHelp: $('#dlgHelp'),
  dlgAbout: $('#dlgAbout'),

  openProjects: $('#openProjects'),
  projectsPane: $('#projectsPane'),
  closeProjects: $('#closeProjects'),
  projectsList: $('#projectsList'),
  refreshProjects: $('#refreshProjects'),
  saveProject: $('#saveProject'),
  exportProject: $('#exportProject'),
  importProject: $('#importProject'),
  deleteProject: $('#deleteProject'),

  // Upload & preview
  heroCanvas: $('#heroCanvas'),
  fileInput: $('#fileInput'),
  btnLoadSample: $('#btnLoadSample'),
  btnClear: $('#btnClear'),
  zoom: $('#zoom'),
  zoomLabel: $('#zoomLabel'),
  btnZoomFit: $('#btnZoomFit'),
  btnZoom100: $('#btnZoom100'),
  maxW: $('#maxW'),

  // Original palette
  kClusters: $('#kClusters'),
  kClustersOut: $('#kClustersOut'),
  btnExtract: $('#btnExtract'),
  btnEyedropper: $('#btnEyedropper'),
  origPalette: $('#origPalette'),

  // Restricted
  btnFromOriginal: $('#btnFromOriginal'),
  allowWhite: $('#allowWhite'),
  btnAddInk: $('#btnAddInk'),
  restrictedList: $('#restrictedList'),
  kitName: $('#kitName'),
  btnSaveKit: $('#btnSaveKit'),
  btnLoadKit: $('#btnLoadKit'),
  btnDeleteKit: $('#btnDeleteKit'),

  // Smart mixing
  autoSmart: $('#autoSmart'),
  maxInksPerMix: $('#maxInksPerMix'),
  gamutSensitivity: $('#gamutSensitivity'),
  gamutSensitivityOut: $('#gamutSensitivityOut'),
  mixBlock: $('#mixBlock'),
  mixCell: $('#mixCell'),
  mixPattern: $('#mixPattern'),
  btnGenerateMixes: $('#btnGenerateMixes'),

  rulesTable: $('#rulesTable'),
  tplRule: $('#tplRule'),

  // Mapping
  wLight: $('#wLight'),
  wLightOut: $('#wLightOut'),
  wChroma: $('#wChroma'),
  wChromaOut: $('#wChromaOut'),
  useDither: $('#useDither'),
  useSharpen: $('#useSharpen'),
  bgMode: $('#bgMode'),
  previewScale: $('#previewScale'),
  applyBtn: $('#applyBtn'),
  bigRegen: $('#bigRegen'),
  mapProgress: $('#mapProgress'),
  mapProgressLabel: $('#mapProgressLabel'),

  mappedCanvas: $('#mappedCanvas'),

  // Export
  exportScale: $('#exportScale'),
  exportTransparent: $('#exportTransparent'),
  btnExportPNG: $('#btnExportPNG'),
  btnExportSVG: $('#btnExportSVG'),
  btnExportReport: $('#btnExportReport'),

  // Toasts
  toasts: $('#toasts'),
};

/* ========================= TOASTS ========================= */
function toast(msg, cls=''){
  const t = el('div', `toast ${cls}`); t.textContent = msg; els.toasts.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 3000);
}

/* ========================= COLOR UTILS ========================= */
const clamp01 = v => Math.max(0, Math.min(1, v));
const hexToRgb = (hex)=>{
  if(!hex) return {r:0,g:0,b:0};
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex,16); return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
};
const rgbToHex = (r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');

// sRGB <-> linear
function toLin(u){ u/=255; return (u<=0.04045)? u/12.92 : Math.pow((u+0.055)/1.055, 2.4); }
function fromLin(u){ const v = (u<=0.0031308)? 12.92*u : 1.055*Math.pow(u,1/2.4)-0.055; return Math.round(clamp01(v)*255); }

// RGB -> Lab (D65)
function rgbToLab(r,g,b){
  // sRGB to XYZ
  let rl=toLin(r), gl=toLin(g), bl=toLin(b);
  let x = rl*0.4124 + gl*0.3576 + bl*0.1805;
  let y = rl*0.2126 + gl*0.7152 + bl*0.0722;
  let z = rl*0.0193 + gl*0.1192 + bl*0.9505;
  // Reference white D65
  const xr = x/0.95047, yr = y/1.00000, zr = z/1.08883;
  const f = t=> (t>0.008856)? Math.cbrt(t) : (7.787*t + 16/116);
  const fx=f(xr), fy=f(yr), fz=f(zr);
  return { L: (116*fy-16), a: 500*(fx-fy), b: 200*(fy-fz) };
}

function deltaE2Weighted(lab1, lab2, wL=1, wC=1){
  const dL = (lab1.L - lab2.L)*wL;
  const da = lab1.a - lab2.a, db = lab1.b - lab2.b;
  const c1 = Math.hypot(lab1.a, lab1.b), c2 = Math.hypot(lab2.a, lab2.b);
  const dC = (c1 - c2)*wC;
  const dH2 = Math.max(0, da*da + db*db - dC*dC);
  return Math.sqrt(dL*dL + dC*dC + dH2);
}

/* ========================= CANVAS HELPERS ========================= */
function ensureCtx(c){ return c.getContext('2d', { willReadFrequently:true }); }
function fitWidthDraw(img, maxW, canvas){
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
  canvas.width = w; canvas.height = h;
  const ctx = ensureCtx(canvas); ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0,0,w,h); ctx.drawImage(img, 0,0,w,h);
  return ctx.getImageData(0,0,w,h);
}

/* ========================= FILE LOAD ========================= */
els.fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image(); img.onload = ()=>{
    State.img = img; State.srcW = img.width; State.srcH = img.height;
    State.srcPreview = fitWidthDraw(img, +els.maxW.value||1600, els.heroCanvas);
    drawMappedPlaceholder();
  }; img.src = url;
});

els.btnLoadSample.addEventListener('click', async ()=>{
  // tiny embedded sample gradient
  const c = document.createElement('canvas'); c.width=640; c.height=360; const ctx=c.getContext('2d');
  const g = ctx.createLinearGradient(0,0,640,360); g.addColorStop(0,'#ff8a00'); g.addColorStop(1,'#0066ff');
  ctx.fillStyle=g; ctx.fillRect(0,0,640,360);
  const img = new Image(); img.onload=()=>{
    State.img = img; State.srcW=img.width; State.srcH=img.height;
    State.srcPreview = fitWidthDraw(img, +els.maxW.value||1600, els.heroCanvas);
    drawMappedPlaceholder();
  }; img.src = c.toDataURL('image/png');
});

els.btnClear.addEventListener('click', ()=>{
  State.img = null; State.srcPreview=null; State.mappedPreview=null;
  const ctx=ensureCtx(els.heroCanvas); ctx.clearRect(0,0,els.heroCanvas.width,els.heroCanvas.height);
  const m=ensureCtx(els.mappedCanvas); m.clearRect(0,0,els.mappedCanvas.width,els.mappedCanvas.height);
});

els.maxW.addEventListener('change', ()=>{
  if(State.img){ State.srcPreview = fitWidthDraw(State.img, +els.maxW.value||1600, els.heroCanvas); }
});

/* ========================= ZOOM ========================= */
function updateZoom(){
  const z = +els.zoom.value/100; els.zoomLabel.textContent = `${Math.round(z*100)}%`;
  els.heroCanvas.style.transform = `scale(${z})`; els.heroCanvas.style.transformOrigin='top left';
}
els.zoom.addEventListener('input', updateZoom);
els.btnZoomFit.addEventListener('click', ()=>{ els.zoom.value = 100; updateZoom(); });
els.btnZoom100.addEventListener('click', ()=>{ els.zoom.value = 100; updateZoom(); });
updateZoom();

/* ========================= PALETTE (K-MEANS) ========================= */
function kmeansFromImageData(imgData, k=8){
  // Fast sampler: take every Nth pixel
  const step = Math.max(1, Math.floor((imgData.width*imgData.height)/50000));
  const pts = [];
  for(let i=0, p=0; i<imgData.data.length; i+=4*step){ pts[p++] = [imgData.data[i], imgData.data[i+1], imgData.data[i+2]]; }
  // init centers by random picks
  const centers = Array.from({length:k}, ()=> pts[Math.floor(Math.random()*pts.length)].slice());
  const labels = new Array(pts.length).fill(0);
  for(let iter=0; iter<12; iter++){
    // assign
    for(let i=0;i<pts.length;i++){
      let bi=0, bd=1e9; const [r,g,b]=pts[i];
      for(let c=0;c<k;c++){
        const cr=centers[c][0]-r, cg=centers[c][1]-g, cb=centers[c][2]-b;
        const d = cr*cr+cg*cg+cb*cb; if(d<bd){ bd=d; bi=c; }
      }
      labels[i]=bi;
    }
    // update
    const sum = Array.from({length:k}, ()=>[0,0,0,0]);
    for(let i=0;i<pts.length;i++){ const c=labels[i]; sum[c][0]+=pts[i][0]; sum[c][1]+=pts[i][1]; sum[c][2]+=pts[i][2]; sum[c][3]++; }
    for(let c=0;c<k;c++){ if(sum[c][3]){ centers[c][0]=sum[c][0]/sum[c][3]; centers[c][1]=sum[c][1]/sum[c][3]; centers[c][2]=sum[c][2]/sum[c][3]; } }
  }
  // output palette
  const pal = centers.map(([r,g,b])=>({r:Math.round(r), g:Math.round(g), b:Math.round(b), hex:rgbToHex(Math.round(r),Math.round(g),Math.round(b))}));
  return pal;
}

function renderOrigPalette(){
  els.origPalette.innerHTML='';
  State.origPalette.forEach((c, idx)=>{
    const sw = el('div','swatch');
    const dot = el('div','dot'); dot.style.background=c.hex; sw.appendChild(dot);
    const inp = el('input'); inp.type='color'; inp.value=c.hex; inp.addEventListener('input', ()=>{ const rgb=hexToRgb(inp.value); c.r=rgb.r;c.g=rgb.g;c.b=rgb.b;c.hex=inp.value; regenRulesPreview();}); sw.appendChild(inp);
    const meta = el('div'); meta.innerHTML = `<div>${c.hex}</div><div class="muted mono">#${String(idx).padStart(2,'0')}</div>`; sw.appendChild(meta);
    const btn = el('button','btn btn-ghost'); btn.textContent='Remove'; btn.onclick=()=>{ State.origPalette.splice(idx,1); renderOrigPalette(); regenRulesPreview(); }; sw.appendChild(btn);
    els.origPalette.appendChild(sw);
  });
}

els.kClusters.addEventListener('input', ()=>{ els.kClustersOut.textContent = els.kClusters.value; });
els.btnExtract.addEventListener('click', ()=>{
  if(!State.srcPreview) return toast('Load an image first','warn');
  State.origPalette = kmeansFromImageData(State.srcPreview, +els.kClusters.value);
  renderOrigPalette();
  if(els.autoSmart.checked) generateMixes();
});

/* ========================= RESTRICTED PALETTE ========================= */
function renderRestricted(){
  els.restrictedList.innerHTML='';
  State.restricted.forEach((c, i)=>{
    const card = el('div','restricted-item');
    const row = el('div','row');
    const left = el('div','row');
    const dot = el('div','color-dot'); dot.style.background = c.hex; left.appendChild(dot);
    const hex = el('input'); hex.type='text'; hex.value=c.hex; hex.className='mono'; hex.size=8; hex.addEventListener('change',()=>{ const rgb=hexToRgb(hex.value); c.r=rgb.r;c.g=rgb.g;c.b=rgb.b;c.hex=rgbToHex(c.r,c.g,c.b); dot.style.background=c.hex; regenRulesPreview();}); left.appendChild(hex);
    row.appendChild(left);

    const chk = el('label','chk');
    const cb = el('input'); cb.type='checkbox'; cb.checked = c.on!==false; cb.onchange=()=>{ c.on = cb.checked; regenRulesPreview(); };
    chk.appendChild(cb); chk.appendChild(document.createTextNode('Enable'));
    row.appendChild(chk);

    const del = el('button','btn btn-danger'); del.textContent='Remove'; del.onclick=()=>{ State.restricted.splice(i,1); renderRestricted(); regenRulesPreview(); };
    row.appendChild(del);

    card.appendChild(row);
    els.restrictedList.appendChild(card);
  });
}
els.btnFromOriginal.addEventListener('click', ()=>{
  State.restricted = State.origPalette.slice(0,10).map(c=>({...c,on:true}));
  if(els.allowWhite.checked) State.restricted.unshift({r:255,g:255,b:255,hex:'#ffffff',on:true});
  renderRestricted(); regenRulesPreview(); if(els.autoSmart.checked) generateMixes();
});
els.btnAddInk.addEventListener('click', ()=>{
  State.restricted.push({r:0,g:0,b:0,hex:'#000000',on:true}); renderRestricted(); regenRulesPreview();
});
els.btnSaveKit.addEventListener('click', ()=>{
  const name = els.kitName.value.trim()||`Kit ${Object.keys(State.kits).length+1}`;
  State.kits[name] = State.restricted.map(c=>c.hex); saveLocal('kits', State.kits); toast(`Saved kit: ${name}`, 'ok');
});
els.btnLoadKit.addEventListener('click', ()=>{
  const name = prompt('Load kit by name:', Object.keys(State.kits)[0]||''); if(!name||!State.kits[name]) return;
  State.restricted = State.kits[name].map(h=>{const {r,g,b}=hexToRgb(h); return {r,g,b,hex:h,on:true};});
  renderRestricted(); regenRulesPreview(); if(els.autoSmart.checked) generateMixes();
});
els.btnDeleteKit.addEventListener('click', ()=>{
  const name = prompt('Delete kit by name:'); if(!name||!State.kits[name]) return;
  delete State.kits[name]; saveLocal('kits', State.kits); toast(`Deleted kit: ${name}`,'warn');
});

/* ========================= MIX RULES ========================= */
// Rule: { on, origIndex, mode:'mix'|'pattern', dE,
//         // mix
//         inks:[i,j(,k)], weights:[w1,w2(,w3)], block, cell, pattern,
//         // pattern
//         shape, bgHex, shapeInks:[i(,j)], shapeSize, stagger, patBlock, patCell,
//         // cached tiles
//         tile, // {B, arr[]} for mix (ink index per cell)
//         patternTile // ImageData for pattern mode
// }

function regenRulesPreview(){
  renderRulesTable(); // re-paints each preview swatch too
}

function renderRulesTable(){
  const tbody = els.rulesTable?.querySelector('tbody'); if(!tbody) return;
  tbody.innerHTML='';
  State.origPalette.forEach((c, idx)=>{
    let rule = State.rules[idx]; if(!rule) rule = State.rules[idx] = defaultRule(idx);
    const row = els.tplRule.content.firstElementChild.cloneNode(true);

    // toggle on
    const onToggle = row.querySelector('[data-fn="toggleOn"]'); onToggle.checked = rule.on!==false; onToggle.addEventListener('change',()=>{ rule.on = onToggle.checked; requestMap(); });

    // original swatch
    const os = row.querySelector('[data-ref="origSwatch"]'); os.style.background = c.hex;

    // mode
    const modeSel = row.querySelector('[data-ref="mode"]'); modeSel.value = rule.mode; modeSel.addEventListener('change',()=>{ rule.mode = modeSel.value; buildRuleCaches(idx); drawRulePreview(idx, row); requestMap(); });

    // preview canvas
    const prev = row.querySelector('[data-ref="preview"]'); drawRulePreview(idx, row);

    // MIX PARAMS
    const mixWrap = row.querySelector('[data-ref="mixParams"]');
    const mixInks = row.querySelector('[data-ref="mixInks"]');
    const mixWeights = row.querySelector('[data-ref="mixWeights"]');
    const mixBlock = row.querySelector('[data-ref="mixBlock"]');
    const mixCell = row.querySelector('[data-ref="mixCell"]');
    const mixPattern = row.querySelector('[data-ref="mixPattern"]');

    // render ink pills
    mixInks.innerHTML='';
    (rule.inks||[]).forEach((ri, k)=>{
      const pill = el('span','pill');
      const dot = el('span','dot'); dot.style.background = State.restricted[ri]?.hex||'#000'; pill.appendChild(dot);
      pill.appendChild(document.createTextNode(`Ink ${ri}`));
      mixInks.appendChild(pill);
      // weight control
      const wrow = el('div','row');
      const lab = el('label'); lab.textContent = `w${k+1}`; wrow.appendChild(lab);
      const rng = el('input'); rng.type='range'; rng.min='0'; rng.max='100'; rng.value = Math.round((rule.weights?.[k]||0)*100); rng.className='mix-ink-range';
      const out = el('span','mix-ink-val mono'); out.textContent = `${rng.value}%`;
      rng.addEventListener('input',()=>{ out.textContent = `${rng.value}%`; const ws = (rule.weights||[]).slice(); ws[k]=+rng.value/100; normalizeWeights(ws); rule.weights=ws; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
      wrow.appendChild(rng); wrow.appendChild(out);
      mixWeights.appendChild(wrow);
    });

    mixBlock.value = rule.block||State.auto.block; mixCell.value = rule.cell||State.auto.cell; mixPattern.value = rule.pattern||State.auto.pattern;
    mixBlock.addEventListener('change',()=>{ rule.block=+mixBlock.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMap(); });
    mixCell.addEventListener('change',()=>{ rule.cell=+mixCell.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMap(); });
    mixPattern.addEventListener('change',()=>{ rule.pattern=mixPattern.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMap(); });

    // PATTERN PARAMS
    const patWrap = row.querySelector('[data-ref="patternParams"]');
    const shapeSel = row.querySelector('[data-ref="shape"]');
    const bgHex = row.querySelector('[data-ref="bgHex"]');
    const shapeInks = row.querySelector('[data-ref="shapeInks"]');
    const patCell = row.querySelector('[data-ref="patCell"]');
    const shapeSize = row.querySelector('[data-ref="shapeSize"]');
    const shapeSizeOut = row.querySelector('[data-ref="shapeSizeOut"]');
    const stagger = row.querySelector('[data-ref="stagger"]');
    const patBlock = row.querySelector('[data-ref="patBlock"]');

    const showMix = rule.mode==='mix'; mixWrap.classList.toggle('hidden', !showMix); patWrap.classList.toggle('hidden', showMix);

    // init defaults
    shapeSel.value = rule.shape||'dot'; bgHex.value = rule.bgHex||'#ffffff'; patCell.value = rule.patCell||3; patBlock.value = rule.patBlock||6; stagger.checked = !!rule.stagger; shapeSize.value = Math.round((rule.shapeSize||0.65)*100); shapeSizeOut.textContent = `${shapeSize.value}%`;

    // shape inks UI (simplified: pick 1 or 2 inks via pills list)
    shapeInks.innerHTML='';
    (rule.shapeInks||[]).forEach((ri)=>{
      const pill = el('span','pill'); const dot=el('span','dot'); dot.style.background=State.restricted[ri]?.hex||'#000'; pill.appendChild(dot); pill.appendChild(document.createTextNode(`Ink ${ri}`)); shapeInks.appendChild(pill);
    });

    const errOut = row.querySelector('[data-ref="errOut"]'); errOut.textContent = rule.dE?.toFixed?.(2)||'—';

    // Listeners for pattern params
    shapeSel.addEventListener('change',()=>{ rule.shape=shapeSel.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
    bgHex.addEventListener('change',()=>{ rule.bgHex=bgHex.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
    patCell.addEventListener('change',()=>{ rule.patCell=+patCell.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
    shapeSize.addEventListener('input',()=>{ rule.shapeSize=(+shapeSize.value)/100; shapeSizeOut.textContent=`${shapeSize.value}%`; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
    stagger.addEventListener('change',()=>{ rule.stagger=stagger.checked; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });
    patBlock.addEventListener('change',()=>{ rule.patBlock=+patBlock.value; buildRuleCaches(idx); drawRulePreview(idx,row); requestMapDebounced(); });

    // reset button
    row.querySelector('[data-fn="reset"]').addEventListener('click',()=>{ State.rules[idx]=defaultRule(idx); buildRuleCaches(idx); drawRulePreview(idx,row); requestMap(); });

    tbody.appendChild(row);
  });
}

function defaultRule(origIndex){
  return { on:true, origIndex, mode:'mix', dE:null, inks:[], weights:[], block:State.auto.block, cell:State.auto.cell, pattern:State.auto.pattern,
           shape:'dot', bgHex:'#ffffff', shapeInks:[], shapeSize:0.65, stagger:true, patBlock:State.auto.block, patCell:State.auto.cell, tile:null, patternTile:null };
}

function drawRulePreview(idx, rowEl){
  const cvs = rowEl.querySelector('[data-ref="preview"]'); const ctx = cvs.getContext('2d'); ctx.clearRect(0,0,cvs.width,cvs.height);
  const rule = State.rules[idx]; const B = (rule.mode==='mix') ? (rule.block||6) : (rule.patBlock||6); const S = (rule.mode==='mix') ? (rule.cell||3) : (rule.patCell||3);
  // build a tiny tile preview
  if(rule.mode==='mix'){
    if(!rule.tile) buildRuleCaches(idx);
    if(!rule.tile) return;
    const W = B*S, H=W; const off = document.createElement('canvas'); off.width=W; off.height=H; const o=off.getContext('2d');
    for(let y=0;y<B;y++) for(let x=0;x<B;x++){
      const inkIndex = rule.tile.arr[y*B+x]; const ink = State.restricted[inkIndex]; if(!ink) continue;
      o.fillStyle = ink.hex; o.fillRect(x*S,y*S,S,S);
    }
    // paint into preview scaled
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0,0, W,H, 0,0,cvs.width,cvs.height);
  } else {
    if(!rule.patternTile) buildRuleCaches(idx);
    if(!rule.patternTile) return;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(rule.patternTile, 0,0, rule.patternTile.width, rule.patternTile.height, 0,0, cvs.width, cvs.height);
  }
}

/* ========================= AUTO SMART MIX ========================= */
els.autoSmart.addEventListener('change', ()=>{ State.auto.enabled = els.autoSmart.checked; if(State.auto.enabled) generateMixes(); });
els.maxInksPerMix.addEventListener('change', ()=>{ State.auto.maxInksPerMix = +els.maxInksPerMix.value; if(els.autoSmart.checked) generateMixes(); });
els.gamutSensitivity.addEventListener('input', ()=>{ State.auto.gamutSensitivity = +els.gamutSensitivity.value/100; els.gamutSensitivityOut.textContent = Math.round(+els.gamutSensitivity.value); });
els.mixBlock.addEventListener('change', ()=>{ State.auto.block = +els.mixBlock.value; if(els.autoSmart.checked) generateMixes(); });
els.mixCell.addEventListener('change', ()=>{ State.auto.cell = +els.mixCell.value; if(els.autoSmart.checked) generateMixes(); });
els.mixPattern.addEventListener('change', ()=>{ State.auto.pattern = els.mixPattern.value; if(els.autoSmart.checked) generateMixes(); });
els.btnGenerateMixes.addEventListener('click', generateMixes);

function generateMixes(){
  if(!State.origPalette.length || !State.restricted.length) return;
  const wL = State.opts.wLight, wC = State.opts.wChroma;
  const rp = State.restricted.filter(r=>r.on!==false);
  const rpIdx = State.restricted.map((r,i)=> r.on!==false?i:-1).filter(i=>i>=0);
  // For each original color, decide if needs mix
  State.origPalette.forEach((oc, idx)=>{
    let nearest = nearestInk(oc, rp, wL, wC); // {i,dE}
    const tol = 4 + 8*(1-State.auto.gamutSensitivity); // 4..12
    if(nearest.dE <= tol){
      // no mix needed — set simple rule with single ink tile
      const rule = State.rules[idx]||defaultRule(idx); rule.mode='mix'; rule.inks=[rpIdx[nearest.i]]; rule.weights=[1]; rule.block=State.auto.block; rule.cell=State.auto.cell; rule.pattern=State.auto.pattern; rule.dE=nearest.dE; State.rules[idx]=rule; buildRuleCaches(idx);
    } else if(State.auto.enabled) {
      // find best 2..max inks mix
      const best = bestMixForTarget(oc, rp, {maxK: State.auto.maxInksPerMix, wL, wC});
      const rule = State.rules[idx]||defaultRule(idx);
      rule.mode='mix'; rule.inks = best.inks.map(j=> rpIdx[j]); rule.weights = best.weights; rule.block=State.auto.block; rule.cell=State.auto.cell; rule.pattern=State.auto.pattern; rule.dE=best.dE; State.rules[idx]=rule; buildRuleCaches(idx);
    }
  });
  renderRulesTable(); requestMap();
}

function nearestInk(color, rInks, wL, wC){
  const lab = rgbToLab(color.r,color.g,color.b); let bestI=0, best=1e9;
  for(let i=0;i<rInks.length;i++){
    const p=rInks[i]; const plab=rgbToLab(p.r,p.g,p.b); const d=deltaE2Weighted(lab, plab, wL, wC); if(d<best){best=d;bestI=i;}
  }
  return { i:bestI, dE:best };
}

function normalizeWeights(ws){
  const s = ws.reduce((a,b)=>a+b,0)||1; for(let i=0;i<ws.length;i++) ws[i]/=s; return ws;
}

// Simplified optimizer: search 2–3-ink combos from nearest 5 inks; use coarse grid if needed
function bestMixForTarget(target, rInks, {maxK=2, wL=1, wC=1}){
  const tLab = rgbToLab(target.r,target.g,target.b);
  // preselect nearest 5 inks
  const scored = rInks.map((p,i)=>({i, d: deltaE2Weighted(tLab, rgbToLab(p.r,p.g,p.b), wL, wC)})).sort((a,b)=>a.d-b.d).slice(0,5);
  let best=null;
  const combos = kCombos(scored.map(s=>s.i), 2, maxK);
  for(const combo of combos){
    // grid search weights at 5% steps (fast, good enough for per-color)
    if(combo.length===2){
      for(let a=0;a<=100;a+=5){ const b=100-a; const w=[a/100,b/100]; const d=mixError(rInks, combo, w, tLab, wL, wC); if(!best||d<best.dE) best={inks:combo, weights:w, dE:d}; }
    } else if(combo.length===3){
      for(let a=0;a<=100;a+=10){ for(let b=0;b<=100-a;b+=10){ const c=100-a-b; const w=[a/100,b/100,c/100]; const d=mixError(rInks, combo, w, tLab, wL, wC); if(!best||d<best.dE) best={inks:combo, weights:w, dE:d}; }}
    }
  }
  // fallback
  if(!best){ const i=scored[0].i; best={inks:[i], weights:[1], dE:scored[0].d}; }
  return best;
}

function kCombos(arr, kMin, kMax){
  const out=[]; const n=arr.length;
  function rec(start, pick, k){ if(pick.length===k){ out.push(pick.slice()); return; } for(let i=start;i<n;i++){ pick.push(arr[i]); rec(i+1,pick,k); pick.pop(); } }
  for(let k=kMin;k<=kMax;k++) rec(0,[],k); return out;
}

function mixError(rInks, combo, weights, tLab, wL, wC){
  // linear RGB mixture
  let rl=0, gl=0, bl=0;
  for(let i=0;i<combo.length;i++){ const p=rInks[combo[i]]; rl += toLin(p.r)*weights[i]; gl += toLin(p.g)*weights[i]; bl += toLin(p.b)*weights[i]; }
  const R=fromLin(rl), G=fromLin(gl), B=fromLin(bl); const lab=rgbToLab(R,G,B); return deltaE2Weighted(lab, tLab, wL, wC);
}

/* ========================= TILES (MIX + PATTERN) ========================= */
function buildRuleCaches(idx){
  const rule = State.rules[idx]; if(!rule) return;
  if(rule.mode==='mix'){
    const B = rule.block||6; const S = rule.cell||3;
    const arr = new Array(B*B).fill(0);
    // compute counts by weights
    const N=B*B; const counts = (rule.weights||[]).map(w=> Math.round(w*N));
    let sum=counts.reduce((a,b)=>a+b,0); // adjust rounding
    while(sum>N){ for(let i=0;i<counts.length&&sum>N;i++){ if(counts[i]>0){ counts[i]--; sum--; } } }
    while(sum<N){ for(let i=0;i<counts.length&&sum<N;i++){ counts[i]++; sum++; } }
    const order = patternOrder(rule.pattern||'bluenoise', B);
    let k=0; for(let j=0;j<counts.length;j++){ const c=counts[j]; for(let t=0;t<c;t++){ arr[order[k++]] = rule.inks[j]; } }
    rule.tile = { B, S, arr };
    rule.patternTile = null;
  } else {
    // build bitmap tile for pattern
    const B = rule.patBlock||6; const S = rule.patCell||3; const W=B*S, H=W;
    const off = document.createElement('canvas'); off.width=W; off.height=H; const ctx=off.getContext('2d');
    // BG fill per cell
    ctx.fillStyle = rule.bgHex||'#ffffff'; ctx.fillRect(0,0,W,H);
    // draw shape per cell
    const colRGB = (rule.shapeInks?.length? State.restricted[rule.shapeInks[0]] : {hex:'#000000'});
    ctx.fillStyle = colRGB?.hex||'#000000';
    for(let y=0;y<B;y++) for(let x=0;x<B;x++){
      drawShapeCell(ctx, rule.shape||'dot', x, y, S, rule.shapeSize||0.65, !!rule.stagger);
    }
    rule.patternTile = off;
    rule.tile = null;
  }
}

function patternOrder(kind, B){
  const N=B*B; const arr=[...Array(N).keys()];
  if(kind==='checker'){
    return arr.sort((a,b)=> ((a%B + Math.floor(a/B))%2) - ((b%B + Math.floor(b/B))%2));
  }
  if(kind==='bayer'){
    // simple 4x4 bayer expanded
    const b4=[ [0,8,2,10], [12,4,14,6], [3,11,1,9], [15,7,13,5] ];
    const idx=[]; for(let y=0;y<B;y++) for(let x=0;x<B;x++){ const v = b4[y%4][x%4] + 16*Math.floor(y/4) + 16*B*Math.floor(x/4); idx.push({i:y*B+x, v}); }
    return idx.sort((a,b)=>a.v-b.v).map(o=>o.i);
  }
  if(kind==='stripeH'){
    return arr.sort((a,b)=> Math.floor(a/B) - Math.floor(b/B));
  }
  if(kind==='stripeV'){
    return arr.sort((a,b)=> (a%B) - (b%B));
  }
  // bluenoise: just seeded shuffle for now
  for(let i=N-1;i>0;i--){ const j=(Math.random()* (i+1))|0; const t=arr[i]; arr[i]=arr[j]; arr[j]=t; }
  return arr;
}

function drawShapeCell(ctx, shape, cx, cy, S, frac=0.65, stagger=false){
  const x0 = cx*S + (stagger && (cy%2)? S/2 : 0); const y0 = cy*S; const s = Math.max(1, Math.round(S*frac));
  const midX = x0 + S/2, midY = y0 + S/2;
  ctx.save();
  switch(shape){
    case 'dot':
      ctx.beginPath(); ctx.arc(midX, midY, s/2, 0, Math.PI*2); ctx.fill(); break;
    case 'square':
      ctx.fillRect(midX - s/2, midY - s/2, s, s); break;
    case 'triangle':
      ctx.beginPath(); ctx.moveTo(midX, midY - s/2); ctx.lineTo(midX - s/2, midY + s/2); ctx.lineTo(midX + s/2, midY + s/2); ctx.closePath(); ctx.fill(); break;
    case 'diamond':
      ctx.beginPath(); ctx.moveTo(midX, midY - s/2); ctx.lineTo(midX - s/2, midY); ctx.lineTo(midX, midY + s/2); ctx.lineTo(midX + s/2, midY); ctx.closePath(); ctx.fill(); break;
    case 'cross':
      const w = Math.max(1, Math.round(s*0.3));
      ctx.fillRect(midX - w/2, y0, w, S);
      ctx.fillRect(x0, midY - w/2, S, w);
      break;
    case 'stripeH':
      ctx.fillRect(x0, midY - s/2, S, s); break;
    case 'stripeV':
      ctx.fillRect(midX - s/2, y0, s, S); break;
    case 'checker':
      if(((cx+cy)&1)===0) ctx.fillRect(x0, y0, S, S); break;
  }
  ctx.restore();
}

/* ========================= MAPPING ========================= */
function requestMap(){ mapNow(); }
let mapTimer=null; function requestMapDebounced(){ clearTimeout(mapTimer); mapTimer=setTimeout(mapNow, 120); }

function mapNow(){
  if(!State.srcPreview || !State.restricted.length) return;
  showBusy('Mapping…');
  const src = State.srcPreview; const w=src.width, h=src.height;
  const out = new ImageData(w,h);

  // Build quick centroids array for original palette to label pixels
  const cents = State.origPalette.map(c=> rgbToLab(c.r,c.g,c.b));
  const rInks = State.restricted.map((r,i)=> ({...r,i})).filter(r=> r.on!==false);
  const rInksLab = rInks.map(r=> rgbToLab(r.r,r.g,r.b));

  const ruleByOrig = State.rules;
  const wL = State.opts.wLight, wC = State.opts.wChroma;

  // Pre-cache rule tiles
  for(let i=0;i<ruleByOrig.length;i++) if(ruleByOrig[i]?.on){ buildRuleCaches(i); }

  const Bcache = {}; // key per rule -> {B,S,arr} or pattern tile

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p4 = (y*w+x)*4; const r=src.data[p4], g=src.data[p4+1], b=src.data[p4+2];
      // find nearest original centroid
      const lab=rgbToLab(r,g,b); let oi=0, bd=1e9; for(let i=0;i<cents.length;i++){ const d=deltaE2Weighted(lab,cents[i], wL, wC); if(d<bd){bd=d;oi=i;} }
      const rule = ruleByOrig[oi];
      if(rule?.on){
        if(rule.mode==='mix' && rule.tile){
          const B=rule.tile.B, S=rule.tile.S; const idx = ( (y% B) * B + (x% B) );
          const inkIndex = rule.tile.arr[idx]; const ink = State.restricted[inkIndex];
          const R=ink?.r??0,G=ink?.g??0,Bb=ink?.b??0; out.data[p4]=R; out.data[p4+1]=G; out.data[p4+2]=Bb; out.data[p4+3]=255;
        } else if(rule.mode==='pattern' && rule.patternTile){
          const W = rule.patternTile.width, H=rule.patternTile.height; const ix = x%W, iy = y%H; const p2 = rule.patternTile.getContext('2d').getImageData(ix, iy, 1,1).data; out.data[p4]=p2[0]; out.data[p4+1]=p2[1]; out.data[p4+2]=p2[2]; out.data[p4+3]=255;
        } else {
          // fallback nearest restricted ink
          let bi=0,bd2=1e9; for(let i=0;i<rInks.length;i++){ const d=deltaE2Weighted(lab, rInksLab[i], wL, wC); if(d<bd2){bd2=d;bi=i;} }
          const ink=rInks[bi]; out.data[p4]=ink.r; out.data[p4+1]=ink.g; out.data[p4+2]=ink.b; out.data[p4+3]=255;
        }
      } else {
        // no rule → nearest restricted
        let bi=0,bd2=1e9; for(let i=0;i<rInks.length;i++){ const d=deltaE2Weighted(lab, rInksLab[i], wL, wC); if(d<bd2){bd2=d;bi=i;} }
        const ink=rInks[bi]; out.data[p4]=ink.r; out.data[p4+1]=ink.g; out.data[p4+2]=ink.b; out.data[p4+3]=255;
      }
    }
  }

  State.mappedPreview = out;
  const ctx = ensureCtx(els.mappedCanvas); els.mappedCanvas.width = w; els.mappedCanvas.height=h; ctx.putImageData(out,0,0);
  hideBusy();
}

/* ========================= MAPPING OPTIONS ========================= */
els.wLight.addEventListener('input', ()=>{ State.opts.wLight = +els.wLight.value/100; els.wLightOut.textContent=(State.opts.wLight).toFixed(2); requestMapDebounced(); });
els.wChroma.addEventListener('input', ()=>{ State.opts.wChroma = +els.wChroma.value/100; els.wChromaOut.textContent=(State.opts.wChroma).toFixed(2); requestMapDebounced(); });
els.useDither.addEventListener('change', ()=>{ State.opts.dither = els.useDither.checked; requestMapDebounced(); });
els.useSharpen.addEventListener('change', ()=>{ State.opts.sharpen = els.useSharpen.checked; requestMapDebounced(); });
els.bgMode.addEventListener('change', ()=>{ State.opts.bgMode = els.bgMode.value; requestMapDebounced(); });
els.previewScale.addEventListener('change', ()=>{ State.opts.previewScale = +els.previewScale.value; requestMapDebounced(); });
els.applyBtn.addEventListener('click', requestMap);
els.bigRegen.addEventListener('click', ()=>{ generateMixes(); requestMap(); });

/* ========================= BUSY ========================= */
function showBusy(label='Working…'){ els.mapProgressLabel.textContent=label; els.mapProgress.classList.remove('hidden'); setExportDisabled(true); }
function hideBusy(){ els.mapProgress.classList.add('hidden'); setExportDisabled(false); }
function setExportDisabled(dis){ els.btnExportPNG.disabled=dis; els.btnExportSVG.disabled=dis; els.btnExportReport.disabled=dis; els.applyBtn.disabled=dis; }

/* ========================= EXPORT ========================= */
els.btnExportPNG.addEventListener('click', ()=>{
  if(!State.mappedPreview) return toast('Map first','warn');
  const scale = Math.max(1, Math.min(16, +els.exportScale.value||4));
  const src = State.mappedPreview; const c=document.createElement('canvas'); c.width=src.width*scale; c.height=src.height*scale; const ctx=c.getContext('2d');
  const tmp=document.createElement('canvas'); tmp.width=src.width; tmp.height=src.height; tmp.getContext('2d').putImageData(src,0,0);
  ctx.imageSmoothingEnabled=false; ctx.drawImage(tmp,0,0,c.width,c.height);
  c.toBlob((blob)=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='recolor.png'; a.click(); }, 'image/png');
});

els.btnExportSVG.addEventListener('click', ()=>{
  if(!State.mappedPreview) return toast('Map first','warn');
  const src=State.mappedPreview; const w=src.width,h=src.height; let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">`;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p4=(y*w+x)*4; const r=src.data[p4],g=src.data[p4+1],b=src.data[p4+2];
      svg+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${rgbToHex(r,g,b)}"/>`;
    }
  }
  svg+='</svg>';
  const blob=new Blob([svg],{type:'image/svg+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='recolor.svg'; a.click();
});

els.btnExportReport.addEventListener('click', ()=>{
  const lines=[];
  lines.push('# Recolor Designer Report');
  lines.push('');
  lines.push('## Restricted Inks (active)');
  State.restricted.forEach((r,i)=>{ if(r.on!==false) lines.push(`- Ink ${i}: ${r.hex}`); });
  lines.push('');
  lines.push('## Original Palette');
  State.origPalette.forEach((c,i)=> lines.push(`- #${String(i).padStart(2,'0')} ${c.hex}`));
  lines.push('');
  lines.push('## Mix/Pattern Rules');
  State.rules.forEach((r,i)=>{
    if(!r) return;
    const mode = r.mode==='mix'? `mix inks=${(r.inks||[]).join(',')} weights=${(r.weights||[]).map(x=>x.toFixed(2)).join(',')} block=${r.block} cell=${r.cell} pattern=${r.pattern}`
                               : `pattern shape=${r.shape} bg=${r.bgHex} cell=${r.patCell} block=${r.patBlock}`;
    lines.push(`- orig #${String(i).padStart(2,'0')} → ${mode} ΔE=${r.dE?.toFixed?.(2)||'—'}`);
  });
  const blob = new Blob([lines.join('\n')],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='recolor-report.txt'; a.click();
});

/* ========================= PROJECTS (drawer) ========================= */
function saveLocal(key, obj){ localStorage.setItem(`recolor.${key}`, JSON.stringify(obj)); }
function loadLocal(key, def){ try{ return JSON.parse(localStorage.getItem(`recolor.${key}`))||def; }catch(e){ return def; } }

State.kits = loadLocal('kits', {});

els.openProjects.addEventListener('click', ()=>{ els.projectsPane.classList.add('show'); els.projectsPane.classList.remove('hidden'); refreshProjectsUI(); });
els.closeProjects.addEventListener('click', ()=>{ els.projectsPane.classList.remove('show'); setTimeout(()=>els.projectsPane.classList.add('hidden'), 300); });
els.refreshProjects.addEventListener('click', refreshProjectsUI);
els.saveProject.addEventListener('click', ()=>{
  const name = prompt('Project name:','My Project'); if(!name) return;
  const data = serializeProject(); const all = loadLocal('projects', {}); all[name]=data; saveLocal('projects', all); refreshProjectsUI(); toast('Saved','ok');
});
els.exportProject.addEventListener('click', ()=>{
  const data = serializeProject(); const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='project.json'; a.click();
});
els.importProject.addEventListener('change', (e)=>{
  const f=e.target.files[0]; if(!f) return; const fr=new FileReader(); fr.onload=()=>{ try{ const data=JSON.parse(fr.result); applyProject(data); toast('Imported','ok'); }catch(err){ toast('Invalid JSON','err'); } }; fr.readAsText(f);
});
els.deleteProject.addEventListener('click', ()=>{
  const all = loadLocal('projects', {}); const names=Object.keys(all); const name = prompt('Delete which project? Available: '+names.join(', ')); if(!name||!all[name]) return; delete all[name]; saveLocal('projects', all); refreshProjectsUI(); toast('Deleted','warn');
});

function refreshProjectsUI(){
  const list = els.projectsList; list.innerHTML=''; const all=loadLocal('projects', {}); Object.entries(all).forEach(([name,data])=>{
    const li=el('li'); const a=el('a'); a.href='#'; a.textContent=name; a.onclick=(e)=>{ e.preventDefault(); applyProject(data); toast(`Loaded ${name}`,'ok'); };
    const del=el('button','btn btn-danger'); del.textContent='X'; del.onclick=()=>{ if(confirm('Delete?')){ delete all[name]; saveLocal('projects', all); refreshProjectsUI(); } };
    li.appendChild(a); li.appendChild(del); list.appendChild(li);
  });
}

function serializeProject(){
  return {
    imgW: State.srcW, imgH: State.srcH,
    origPalette: State.origPalette,
    restricted: State.restricted,
    rules: State.rules,
    opts: State.opts,
    auto: State.auto,
  };
}

function applyProject(data){
  State.origPalette = data.origPalette||[]; renderOrigPalette();
  State.restricted = data.restricted||[]; renderRestricted();
  State.rules = (data.rules||[]).map((r,i)=> ({...defaultRule(i), ...r}));
  State.opts = {...State.opts, ...(data.opts||{})};
  State.auto = {...State.auto, ...(data.auto||{})};
  els.wLight.value = Math.round(State.opts.wLight*100); els.wLightOut.textContent = State.opts.wLight.toFixed(2);
  els.wChroma.value = Math.round(State.opts.wChroma*100); els.wChromaOut.textContent = State.opts.wChroma.toFixed(2);
  els.autoSmart.checked = State.auto.enabled; els.maxInksPerMix.value = State.auto.maxInksPerMix;
  els.gamutSensitivity.value = Math.round(State.auto.gamutSensitivity*100); els.gamutSensitivityOut.textContent=String(Math.round(State.auto.gamutSensitivity*100));
  els.mixBlock.value = State.auto.block; els.mixCell.value = State.auto.cell; els.mixPattern.value = State.auto.pattern;
  renderRulesTable(); requestMap();
}

/* ========================= DIALOGS ========================= */
els.btnOpenHelp?.addEventListener('click', ()=> els.dlgHelp.showModal());
els.btnOpenAbout?.addEventListener('click', ()=> els.dlgAbout.showModal());
els.btnCloseHelp?.addEventListener('click', ()=> els.dlgHelp.close());
els.btnCloseAbout?.addEventListener('click', ()=> els.dlgAbout.close());

/* ========================= START ========================= */
function drawMappedPlaceholder(){
  if(!State.srcPreview) return;
  const c = ensureCtx(els.mappedCanvas); els.mappedCanvas.width = State.srcPreview.width; els.mappedCanvas.height=State.srcPreview.height; c.putImageData(State.srcPreview,0,0);
}

// Initial UI values
els.kClustersOut.textContent = els.kClusters.value;
els.gamutSensitivityOut.textContent = els.gamutSensitivity.value;
els.wLightOut.textContent = (State.opts.wLight).toFixed(2);
els.wChromaOut.textContent = (State.opts.wChroma).toFixed(2);

// Ready
toast('Ready. Load an image to begin.','ok');
