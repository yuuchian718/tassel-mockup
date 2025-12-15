console.log("APP JS LOADED v2");
const el = (id) => document.getElementById(id);

const fileInput = el("file");
const pad = el("pad");
const fringe = el("fringe");
const density = el("density");
const padVal = el("padVal");
const fringeVal = el("fringeVal");
const densityVal = el("densityVal");

const btnGen = el("generate");
const btnDown = el("download");
const status = el("status");

const canvas = el("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let sourceImg = null;
let sourceData = null; // ImageData

function setStatus(t){ status.textContent = t; }

function updateLabels(){
  padVal.textContent = `${pad.value}px`;
  fringeVal.textContent = `${fringe.value}px`;
  densityVal.textContent = `${density.value}`;
}
["input","change"].forEach(ev=>{
  pad.addEventListener(ev, updateLabels);
  fringe.addEventListener(ev, updateLabels);
  density.addEventListener(ev, updateLabels);
});
updateLabels();

fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if(!f) return;

  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    sourceImg = img;
    // Fit into offscreen canvas to get pixel data
    const maxSide = 900; // keep it fast
    const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    canvas.width = 900;
    canvas.height = 900;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // draw centered
    const ox = Math.round((canvas.width - w) / 2);
    const oy = Math.round((canvas.height - h) / 2);
    ctx.drawImage(img, ox, oy, w, h);

    // store current drawn as source data (already centered)
    sourceData = ctx.getImageData(0,0,canvas.width,canvas.height);

    btnGen.disabled = false;
    setStatus("已上传，点击生成效果图");
  };
  img.onerror = () => setStatus("图片加载失败，请换一张更干净的白底图");
  img.src = url;
});

btnGen.addEventListener("click", () => {
  if(!sourceData) return;
  setStatus("生成中…（密度高会慢一点）");

  // work on a copy
  const w = sourceData.width;
  const h = sourceData.height;
  const data = new Uint8ClampedArray(sourceData.data); // RGBA

  // 1) build mask from white background
  const mask = new Uint8Array(w*h); // 1 = subject
  const thr = 245; // threshold for "white"
  for(let i=0;i<w*h;i++){
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    // treat near-white as background
    const isBg = (r>thr && g>thr && b>thr);
    if(!isBg) mask[i] = 1;
  }

  // 2) pad (dilation) to approximate 0.5cm feel
  const padPx = parseInt(pad.value, 10);
  const padded = dilateMask(mask, w, h, padPx);

  // 3) build edge map (outer boundary) from padded mask
  const edge = findEdge(padded, w, h);

  // 4) render background
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // paper-like background
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0,0,w,h);

  // 5) draw "canvas backing" area (padded shape)
  drawBacking(padded, w, h);

  // 6) draw original embroidery pixels on top (keep original colors, remove white)
  drawEmbroidery(data, mask, w, h);

  // 7) stitch line (a dashed stroke around padded edge)
  drawStitch(edge, w, h);

  // 8) fringe (random hairlines outward from edge)
  const fringeLen = parseInt(fringe.value, 10);
  const dens = parseInt(density.value, 10);
  drawFringe(edge, padded, w, h, fringeLen, dens);

  btnDown.disabled = false;
  setStatus("完成，可下载PNG（不精确尺寸，重在外形和质感）");
});

btnDown.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `tassel-mockup-${Date.now()}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

// ---------- helpers ----------

function idx(x,y,w){ return y*w + x; }

function dilateMask(mask, w, h, radius){
  if(radius <= 0) return mask.slice();
  const out = new Uint8Array(w*h);
  // faster approximation: repeated box dilate steps
  // do N steps of 1-pixel dilation
  const steps = Math.min(radius, 60);
  let cur = mask.slice();
  for(let s=0;s<steps;s++){
    for(let y=1;y<h-1;y++){
      for(let x=1;x<w-1;x++){
        const i = idx(x,y,w);
        if(cur[i]) { out[i]=1; continue; }
        // check 8-neighborhood
        if(cur[i-1]||cur[i+1]||cur[i-w]||cur[i+w]||cur[i-w-1]||cur[i-w+1]||cur[i+w-1]||cur[i+w+1]){
          out[i]=1;
        }else{
          out[i]=0;
        }
      }
    }
    cur = out.slice();
  }
  return cur;
}

function findEdge(mask, w, h){
  const edge = new Uint8Array(w*h);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i = idx(x,y,w);
      if(!mask[i]) continue;
      // edge if any neighbor is 0
      if(!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w]) edge[i]=1;
    }
  }
  return edge;
}

function drawBacking(padded, w, h){
  // draw backing with subtle fabric-like noise
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data;
  for(let i=0;i<w*h;i++){
    if(!padded[i]) continue;
    const n = (Math.random()*16 - 8); // small noise
    const base = 235 + n; // light canvas
    d[i*4] = clamp(base);
    d[i*4+1] = clamp(base);
    d[i*4+2] = clamp(base);
    d[i*4+3] = 255;
  }
  ctx.putImageData(img,0,0);
}

function drawEmbroidery(data, mask, w, h){
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data;
  for(let i=0;i<w*h;i++){
    if(!mask[i]) continue;
    d[i*4] = data[i*4];
    d[i*4+1] = data[i*4+1];
    d[i*4+2] = data[i*4+2];
    d[i*4+3] = 255;
  }
  ctx.putImageData(img,0,0);
}

function drawStitch(edge, w, h){
  // collect edge points
  const pts = [];
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      const i = idx(x,y,w);
      if(edge[i]) pts.push([x,y]);
    }
  }
  // draw dashed dots along edge points (cheap stitch look)
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(90, 64, 40, 0.95)";
  // sample points
  const step = 6;
  for(let k=0;k<pts.length;k+=step){
    const [x,y] = pts[k];
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFringe(edge, padded, w, h, fringeLen, density){
  // gather edge points
  const pts = [];
  for(let y=2;y<h-2;y++){
    for(let x=2;x<w-2;x++){
      const i = idx(x,y,w);
      if(edge[i]) pts.push([x,y]);
    }
  }
  if(pts.length === 0) return;

  // estimate normal by gradient of mask
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "rgba(160, 140, 110, 1)";
  ctx.lineWidth = 1;

  for(let t=0;t<density;t++){
    const [x,y] = pts[(Math.random()*pts.length)|0];
    const nx = (padded[idx(x+1,y,w)]?1:0) - (padded[idx(x-1,y,w)]?1:0);
    const ny = (padded[idx(x,y+1,w)]?1:0) - (padded[idx(x,y-1,w)]?1:0);

    // outward direction is opposite gradient (rough)
    let dx = -nx, dy = -ny;
    const len = Math.hypot(dx,dy) || 1;
    dx /= len; dy /= len;

    // add randomness
    dx += (Math.random()-0.5)*0.9;
    dy += (Math.random()-0.5)*0.9;
    const len2 = Math.hypot(dx,dy) || 1;
    dx /= len2; dy /= len2;

    const L = fringeLen * (0.4 + Math.random()*0.9);
    const x2 = x + dx * L;
    const y2 = y + dy * L;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // slightly thicken the fringe edge
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(110, 90, 70, 1)";
  for(let t=0;t<Math.floor(density*0.25);t++){
    const [x,y] = pts[(Math.random()*pts.length)|0];
    const a = Math.random()*Math.PI*2;
    const L = fringeLen*(0.15 + Math.random()*0.15);
    ctx.beginPath();
    ctx.moveTo(x,y);
    ctx.lineTo(x + Math.cos(a)*L, y + Math.sin(a)*L);
    ctx.stroke();
  }

  ctx.restore();
}

function clamp(v){ return Math.max(0, Math.min(255, Math.round(v))); }
