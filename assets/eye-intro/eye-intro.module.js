/* EYE INTRO: "the watcher", in black and white. A black iris of white cybersecurity words around a pure-black pupil,
   framed by eyelids, over a cyber-news wall whose columns slide up and down. It opens like a film title (one GSAP timeline),
   then watches: alert glances, blinks, rings turning in alternate directions. Scrolling is one continuous shot: dots are
   sucked into the pupil, the camera floats through a void of white stars toward a growing black hole, the core fills the
   screen, the ring flashes, and the portfolio opens. Everything runs in reverse on scroll back.
   Crisp by design: distance-field text, MSAA, full pixel ratio, no glow. Self-contained: no globals, every listener is
   its own, and once revealed the render loop stops and the scroll lock is gone. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gsap } from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js';
import { makeEyePalette } from './palette.js?v=10';   // keep every ?v in step with VERSION in eye-intro.js
import { makeSuction, makeStarfield } from './particles.js?v=10';
import { NewsWall } from './news.js?v=10';

/* ---------- knobs ---------- */
const KNOBS = {
  rings: 10, ringsMobile: 7,          // word bands from pupil to limbus
  wordH: [0.024, 0.036],              // word height, in iris radii
  pupil: 0.30,                        // pupil radius / iris radius
  drift: 0.0055,                      // inward flow of the words (iris spans per second)
  spin: 0.42,                         // ring rotation (rad/s): one ring clockwise, the next counter-clockwise
  dots: { suction: 10000, suctionMobile: 3000, stars: 6000, starsMobile: 2000 },
  saccade: { range: 0.17, move: [110, 160], hold: [380, 1200] },   // alert: it keeps checking left and right
  blink: { gap: [2500, 6000], double: 0.15 },
  zoomPerPx: 1 / 1400,
  fov: 35, camZ: 10, dprMax: 2,
  t: { fast: 0.2, base: 0.6, slow: 1.2 },                          // timing tokens
};

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(hover: none) and (pointer: coarse)').matches;
const SHOT = new URLSearchParams(location.search).get('eyeshot');   // idle | blink | zoom | pupil | a progress (0.3): a frozen state, for screenshots
const SHOTP = SHOT !== null && SHOT !== '' && !isNaN(+SHOT) ? +SHOT : null;
const fail = () => document.dispatchEvent(new Event('eye-intro:fail'));

/* ---------- words ---------- */
const IRIS_WORDS = ['firewall', 'exploit', 'payload', 'zero-day', 'phishing', 'malware', 'ransomware', 'rootkit', 'backdoor', 'botnet', 'CVE', 'XSS', 'SQLi', 'RCE', 'CSRF', 'SSRF', 'MITM', 'DDoS', 'brute-force', 'honeypot', 'sandbox', 'SIEM', 'SOC', 'IDS', 'IPS', 'EDR', 'threat-intel', 'OSINT', 'recon', 'nmap', 'wireshark', 'burp', 'metasploit', 'kali', 'shell', 'root', 'sudo', 'hash', 'SHA-256', 'AES', 'RSA', 'TLS', 'VPN', 'encrypt', 'decrypt', 'keylogger', 'trojan', 'worm', 'spoofing', 'packet', 'port 443', 'port 22', 'CTF', 'pentest', 'red team', 'blue team', 'forensics', 'incident', 'breach', 'patch', 'vuln', 'auth', '2FA', 'token', 'cipher', 'access denied', 'ACCESS GRANTED', '0x7F', '/etc/shadow', 'chmod 777', 'triage', 'yara', 'sigma', 'IOC', 'TTP', 'MFA', 'DNS', 'ARP', 'pcap', 'syslog', 'beacon', 'C2'];
const ACCENT_WORDS = ['BREACH', 'ZERO-DAY', 'ACCESS GRANTED', 'ROOT', 'ALERT', 'CVE-2026-4471', 'THREAT DETECTED'];
const FONTS = ['500 48px "IBM Plex Mono"', '600 50px "Space Grotesk"'];

let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = a => a[Math.floor(rnd() * a.length)];
const range = (a, b) => a + (b - a) * rnd();

/* ---------- a signed-distance-field atlas: words stay razor sharp at any size, in one texture ---------- */
// Felzenszwalb & Huttenlocher's exact distance transform, the same approach as Mapbox's tiny-sdf (BSD-2)
function edt1d(grid, off, stride, len, f, v, z) {
  v[0] = 0; z[0] = -1e20; z[1] = 1e20; f[0] = grid[off];
  for (let q = 1, k = 0, s = 0; q < len; q++) {
    f[q] = grid[off + q * stride];
    const q2 = q * q;
    do { const r = v[k]; s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  for (let q = 0, k = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k], qr = q - r; grid[off + q * stride] = f[r] + qr * qr; }
}
function edt(grid, w, h, f, v, z) {
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}
function toSDF(alpha, w, h, radius) {
  const n = w * h, outer = new Float32Array(n), inner = new Float32Array(n), m = Math.max(w, h);
  for (let i = 0; i < n; i++) {
    const a = alpha[i * 4 + 3] / 255;
    if (a >= 1) { outer[i] = 0; inner[i] = 1e20; }
    else if (a <= 0) { outer[i] = 1e20; inner[i] = 0; }
    else { const d = 0.5 - a; outer[i] = d > 0 ? d * d : 0; inner[i] = d < 0 ? d * d : 0; }
  }
  const f = new Float32Array(m), v = new Uint16Array(m), z = new Float32Array(m + 1);
  edt(outer, w, h, f, v, z); edt(inner, w, h, f, v, z);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]); out[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + 0.25)))); }
  return out;   // the glyph edge sits at 0.75
}
function buildAtlas(maxAniso) {
  const W = 2048, PAD = 10, ROW = 66, c = document.createElement('canvas'); c.width = W; c.height = 2048;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const entries = []; let x = PAD, y = PAD;
  const put = (word, font, kind) => {
    g.font = font; const w = Math.ceil(g.measureText(word).width);
    if (x + w + PAD > W) { x = PAD; y += ROW; }
    if (y + ROW > c.height) return;
    g.fillText(word, x, y + ROW / 2);
    entries.push({ x0: x - 4, y0: y, x1: x + w + 4, y1: y + ROW, aspect: (w + 8) / ROW, kind });
    x += w + PAD * 2;
  };
  for (const f of FONTS) for (const w of IRIS_WORDS) put(w, f, 0);
  for (const w of ACCENT_WORDS) put(w, FONTS[0], 1);
  const SYM = '#$%&@!*?/<>[]{}01=+';   // the scrambled strings the words decode from
  for (let i = 0; i < 28; i++) put(Array.from({ length: 3 + Math.floor(rnd() * 8) }, () => SYM[Math.floor(rnd() * SYM.length)]).join(''), FONTS[0], 2);
  const H = Math.min(2048, y + ROW + PAD);
  const sdf = toSDF(g.getImageData(0, 0, W, H).data, W, H, 8);
  const tex = new THREE.DataTexture(sdf, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  for (const e of entries) { e.u0 = e.x0 / W; e.u1 = e.x1 / W; e.v0 = e.y0 / H; e.v1 = e.y1 / H; }   // rows top-down (flipY off)
  return { tex, normal: entries.filter(e => e.kind === 0), accent: entries.filter(e => e.kind === 1), scramble: entries.filter(e => e.kind === 2) };
}

/* ---------- shaders ---------- */
const NOISE = /* glsl */`
float h11(float n){return fract(sin(n)*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float n=i.x+i.y*57.;
  return mix(mix(h11(n),h11(n+1.),f.x),mix(h11(n+57.),h11(n+58.),f.x),f.y);}`;

const irisVert = /* glsl */`
attribute vec4 aUV; attribute vec4 aUV2; attribute vec4 aP; attribute vec4 aQ;
uniform float uSpin, uDrift, uSquash, uR0, uTime, uIgnite, uDecode, uDissolve;
varying vec2 vUv; varying float vRn, vRing, vRand, vAcc, vR, vVis;
void main(){
  float span=1.-uR0, rn=fract(aP.x-uDrift);
  float r=uR0+rn*span;
  float ang=aP.y+aQ.w*uSpin*(.75+.5*fract(aQ.x*7.13));      // the whole ring turns as one, alternating direction
  // gravitational lensing: close to the pupil, words are pulled in and smeared around it
  float lens=exp(-(r-uR0)/.07);
  r-=lens*.028;
  float len=aP.z*(1.-lens*.35), h=aP.w*(1.+lens*2.4);
  vec2 dR=vec2(cos(ang),sin(ang)), dT=vec2(-dR.y,dR.x);
  vec2 p=dR*(r+position.x*len)+dT*(position.y*h);
  p.y*=uSquash;
  // the entrance: rings ignite from the pupil outward; each word decodes from scrambled symbols into itself
  float settle=aQ.x*.68+aQ.y*.22;
  vVis=smoothstep(settle,settle+.14,uIgnite);
  float decoded=step(settle*.85+.12,uDecode);
  float flick=step(.5,fract(sin(floor(uTime*18.)+aQ.y*91.)*437.5));
  vec4 uvr=mix(aUV2,aUV,decoded);
  vVis*=mix(flick*.8,1.,decoded);
  vVis*=1.-smoothstep(rn,rn+.08,uDissolve);                // the inner words dissolve into the suction, pupil outward
  vUv=mix(uvr.xy,uvr.zw,vec2(position.x+.5,.5-position.y));
  vRn=rn; vRing=aQ.x; vRand=aQ.y; vAcc=aQ.z; vR=r;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,0.,1.);
}`;
const irisFrag = /* glsl */`
uniform sampler2D uAtlas; uniform vec3 uIn, uMid, uOut, uHot, uHi, uRim; uniform float uTime, uGlow;
varying vec2 vUv; varying float vRn, vRing, vRand, vAcc, vR, vVis;
${NOISE}
void main(){
  float d=texture2D(uAtlas,vUv).r, w=max(fwidth(d)*.7,1e-4);
  float a=smoothstep(.75-w,.75+w,d);                                    // a crisp edge at any size
  a*=smoothstep(0.,.04,vRn)*(1.-smoothstep(.86,1.,vRn))*vVis;
  if(a<.01) discard;
  vec3 col=mix(uIn,uMid,smoothstep(0.,.45,vRn)); col=mix(col,uOut,smoothstep(.45,1.,vRn));
  float hot=step(.975,fract(vRand*13.7+uTime*.1));                       // a few white words flicker
  col=mix(col,uHot,hot*(.6+.4*sin(uTime*23.+vRand*50.)));
  float pulse=.55+.45*sin(uTime*2.1+vRand*6.283);
  col=mix(col,uHi,vAcc*(.7+.3*pulse));                                    // the key words: full white
  gl_FragColor=vec4(col*uGlow,a);
}`;

const quadVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// the pupil: a true black core with a sharp edge
const pupilFrag = /* glsl */`
uniform float uR0; varying vec2 vP;
void main(){float r=length(vP), px=fwidth(r); float a=1.-smoothstep(uR0-px,uR0,r); gl_FragColor=vec4(0.,0.,0.,a);}`;
// the hero: a 1-2 px event-horizon ring, the accretion glow swirling warm to cool, and the limbus rim
const rimFrag = /* glsl */`
uniform vec3 uRim, uHorizon; uniform float uR0, uFlash, uIgnite; varying vec2 vP;
void main(){
  float r=length(vP), px=fwidth(r);
  float ring=1.-smoothstep(px*.5,px*(1.6+uFlash*1.5),abs(r-uR0-px*.4));
  float lim=1.-smoothstep(px*.4,px*1.4,abs(r-1.));
  vec3 col=uHorizon*ring*smoothstep(0.,.35,uIgnite)+uRim*lim*uIgnite;
  gl_FragColor=vec4(col,max(col.r,max(col.g,col.b)));   // alpha only where there is light: the rest stays see-through
}`;

// the eyelids: their own layer over the eye only (inside the socket), solid and rounded, with a crisp ember edge
const lidFrag = /* glsl */`
uniform vec3 uLid, uSheen, uRim; uniform float uYu, uYl, uMeet, uOpen; varying vec2 vP;
void main(){
  float c=.36, x2=vP.x*vP.x;
  float eu=mix(uMeet,uYu,uOpen)-c*x2, el=mix(uMeet,uYl,uOpen)+c*x2;
  float socket=1.-smoothstep(.82,1.,length(vec2(vP.x/1.6,vP.y/1.2)));   // lids live around the eye, then dissolve into the wall
  float up=step(eu,vP.y), lo=step(vP.y,el), m=max(up,lo)*socket;
  float d=up>.5?vP.y-eu:el-vP.y;
  m*=max(1.-smoothstep(1.,1.1,length(vP)),1.-smoothstep(0.,.16,d));   // solid only over the iris; elsewhere the lid fades into the news behind it
  vec3 col=uLid+uSheen*smoothstep(0.,.18,d)*(1.-smoothstep(.2,.55,d));  // rounded: dark at the edge, a soft sheen across
  float px=fwidth(vP.y), open=step(el-px,eu);
  float edgeU=1.-smoothstep(px*.5,px*1.6,abs(vP.y-eu)), edgeL=1.-smoothstep(px*.5,px*1.6,abs(vP.y-el));
  float crease=(1.-smoothstep(px*.5,px*1.6,abs(vP.y-(eu+.17-.05*x2))))*up*socket*(1.-smoothstep(1.,1.4,abs(vP.x)));
  vec3 rc=uRim*(edgeU+edgeL)*open*socket+uRim*crease*.6;
  gl_FragColor=vec4(col*m+rc,clamp(m+(edgeU+edgeL)*open*socket+crease*.6,0.,1.));
}`;

// finishing: a vignette, a barely-there chromatic fringe at the edges, and fine film grain
const finalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNoise: { value: 0.01 }, uBlack: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uTime, uNoise, uBlack; varying vec2 vUv;
void main(){
  vec4 t=texture2D(tDiffuse,vUv); vec3 c=t.rgb;
  float d=distance(vUv,vec2(.5)); c*=mix(.6,1.,smoothstep(.9,.35,d));
  float n=fract(sin(dot(gl_FragCoord.xy+fract(uTime)*97.,vec2(12.9898,78.233)))*43758.5453);
  c+=(n-.5)*uNoise*t.a;
  c*=1.-uBlack;
  gl_FragColor=vec4(c,max(t.a,uBlack));
}`,
};

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const lerp = (a, b, t) => a + (b - a) * t;

function instanced(count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
  for (const k in attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k], 4));
  g.instanceCount = count;
  return g;
}

/* ---------- build ---------- */
async function start() {
  await Promise.race([Promise.all(FONTS.concat('400 18px "IBM Plex Mono"', '700 30px "Space Grotesk"').map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1500))]).catch(() => {});

  const P = makeEyePalette(root), C = k => new THREE.Color(P[k].hex);
  const mobile = innerWidth < 760 || touchFirst;

  /* DOM */
  const el = document.createElement('div');
  el.id = 'eye-intro'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Intro');
  el.style.setProperty('--ei-bg', P.bg.hex); el.style.setProperty('--ei-text', P.hot.hex); el.style.setProperty('--ei-accent', P.mid.hex);
  el.style.setProperty('--ei-wall', P.wallText.hex); el.style.setProperty('--ei-line', P.rim.hex); el.style.setProperty('--ei-wall-active', P.wallActive.hex);
  el.innerHTML = '<div class="ei-stage"><div class="ei-ring"></div></div><div class="ei-hint" aria-hidden="true"><span class="ei-line"></span><span class="ei-text"></span></div><button type="button" class="ei-skip">Skip intro</button>';
  const stage = el.querySelector('.ei-stage'), hint = el.querySelector('.ei-hint'), hintText = el.querySelector('.ei-hint .ei-text'), skip = el.querySelector('.ei-skip');
  hint.style.opacity = '0';
  const toast = document.createElement('div');
  toast.id = 'eye-intro-toast'; toast.setAttribute('aria-hidden', 'true');
  toast.style.setProperty('--ei-text', P.hot.hex); toast.style.setProperty('--ei-accent', P.mid.hex);
  toast.innerHTML = '<span class="ei-line"></span><span class="ei-text">Scroll up to zoom out</span>';

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { return fail(); }
  const dpr = Math.min(devicePixelRatio, KNOBS.dprMax);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);   // transparent: the typing wall shows through around the eye
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // white stays #FFFFFF
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  stage.prepend(renderer.domElement);
  const wallDom = new NewsWall(stage, { reduced }); wallDom.setOpacity(0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  document.body.append(el, toast);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.005, 400);
  const eye = new THREE.Group(), lids = new THREE.Group();
  scene.add(eye, lids);

  const atlas = buildAtlas(maxAniso);
  const R0 = KNOBS.pupil;

  /* iris: every word in one instanced draw */
  const bands = mobile ? KNOBS.ringsMobile : KNOBS.rings, span = 1 - R0, recs = [];
  for (let b = 0; b < bands; b++) {
    const inner = b / bands, w = span / bands, dir = b % 2 ? 1 : -1;
    for (let a = rnd() * 0.2; a < Math.PI * 2;) {
      const isAcc = rnd() < 0.012, maxLen = w * range(0.62, 0.97);
      let h = range(KNOBS.wordH[0], KNOBS.wordH[1]) * (b < 2 ? 0.8 : 1), e;
      for (let k = 0; k < 6; k++) { e = isAcc ? pick(atlas.accent) : pick(atlas.normal); if (h * e.aspect <= maxLen) break; }
      let len = h * e.aspect;
      if (len > maxLen) { len = maxLen; h = len / e.aspect; }
      const sc = pick(atlas.scramble);
      const rc = R0 + inner * span + len / 2 + rnd() * Math.max(0, w - len);
      const da = (h * 1.32) / rc;
      recs.push([e.u0, e.v0, e.u1, e.v1, sc.u0, sc.v0, sc.u1, sc.v1, (rc - R0) / span, a + da / 2, len, h, b / (bands - 1), rnd(), isAcc ? 1 : 0, dir]);
      a += da;
    }
  }
  const N = recs.length, aUV = new Float32Array(N * 4), aUV2 = new Float32Array(N * 4), aP = new Float32Array(N * 4), aQ = new Float32Array(N * 4);
  recs.forEach((r, i) => { aUV.set(r.slice(0, 4), i * 4); aUV2.set(r.slice(4, 8), i * 4); aP.set(r.slice(8, 12), i * 4); aQ.set(r.slice(12, 16), i * 4); });
  const irisU = {
    uAtlas: { value: atlas.tex }, uIn: { value: C('irisInner') }, uMid: { value: C('irisMid') }, uOut: { value: C('irisOuter') }, uHot: { value: C('hot') }, uHi: { value: C('highlight') }, uRim: { value: C('rim') },
    uTime: { value: 0 }, uSpin: { value: 0 }, uDrift: { value: 0 }, uSquash: { value: 1 }, uGlow: { value: 1 }, uR0: { value: R0 }, uIgnite: { value: 0 }, uDecode: { value: 0 }, uDissolve: { value: 0 },
  };
  const iris = new THREE.Mesh(instanced(N, { aUV, aUV2, aP, aQ }), new THREE.ShaderMaterial({ uniforms: irisU, vertexShader: irisVert, fragmentShader: irisFrag, transparent: true, depthWrite: false, depthTest: false }));
  iris.frustumCulled = false; iris.renderOrder = 1; eye.add(iris);

  // a dark stroma behind the words: the iris reads as one deep disc and the newspaper stays outside it
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), new THREE.ShaderMaterial({ uniforms: { uBg: { value: C('bg') }, uIgnite: irisU.uIgnite }, vertexShader: quadVert,
    fragmentShader: `uniform vec3 uBg; uniform float uIgnite; varying vec2 vP; void main(){float r=length(vP), px=fwidth(r); float a=(1.-smoothstep(1.-px*2.,1.,r))*smoothstep(0.,.4,uIgnite); gl_FragColor=vec4(0.,0.,0.,a);}`,
    transparent: true, depthWrite: false, depthTest: false }));
  backing.position.z = -0.001; backing.renderOrder = 0.5; eye.add(backing);
  const pupil = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.ShaderMaterial({ uniforms: { uR0: { value: R0 } }, vertexShader: quadVert, fragmentShader: pupilFrag, transparent: true, depthWrite: false, depthTest: false }));
  pupil.position.z = 0.002; pupil.renderOrder = 2; eye.add(pupil);

  const rimU = { uRim: { value: C('rim') }, uHorizon: { value: C('horizon') }, uR0: { value: R0 }, uFlash: { value: 0 }, uIgnite: { value: 0 } };
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.ShaderMaterial({ uniforms: rimU, vertexShader: quadVert, fragmentShader: rimFrag, transparent: true, premultipliedAlpha: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  rim.position.z = 0.003; rim.renderOrder = 3; eye.add(rim);

  const lidU = { uLid: { value: C('lid') }, uSheen: { value: C('lidSheen') }, uRim: { value: C('rim') }, uYu: { value: 0.8 }, uYl: { value: -0.74 }, uMeet: { value: -0.32 }, uOpen: { value: 0 } };
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.ShaderMaterial({ uniforms: lidU, vertexShader: quadVert, fragmentShader: lidFrag, transparent: true, depthWrite: false, depthTest: false }));
  lid.position.z = 0.02; lid.renderOrder = 5; lids.add(lid);

  /* the journey: dots sucked into the pupil, then a void of white stars and a black hole that grows */
  const D = KNOBS.dots, few = reduced ? 0.3 : 1;
  const suction = makeSuction(THREE, { count: Math.round((mobile ? D.suctionMobile : D.suction) * few), dpr, color: C('hot') });
  suction.points.renderOrder = 2.5; eye.add(suction.points);
  const voidScene = new THREE.Scene();
  const voidCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
  const starfield = makeStarfield(THREE, { count: Math.round((mobile ? D.starsMobile : D.stars) * few), dpr, color: C('hot') });
  voidScene.add(starfield.points, starfield.hole);

  /* post: MSAA at full pixel ratio, then a restrained glow, gravity, finishing */
  const rt = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const outerPass = new RenderPass(scene, cam), voidPass = new RenderPass(voidScene, voidCam, null, new THREE.Color(0x000000), 1);
  composer.addPass(outerPass); composer.addPass(voidPass); voidPass.enabled = false;
  const fin = new ShaderPass(finalShader); composer.addPass(fin);
  composer.addPass(new OutputPass());

  /* fit: iris diameter = 96% of the height (92% of the width in portrait), computed in world units */
  let R = 1, aspect = 1, Z0 = KNOBS.camZ, zEnd = 0.2;
  function fit() {
    const w = innerWidth, h = innerHeight; aspect = w / h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    cam.aspect = aspect; voidCam.aspect = aspect; voidCam.updateProjectionMatrix(); starfield.resize(aspect);
    const t = Math.tan(THREE.MathUtils.degToRad(KNOBS.fov / 2)), visH = 2 * Z0 * t, visW = visH * aspect;
    R = aspect < 1 ? 0.46 * visW : 0.48 * visH;
    eye.scale.setScalar(R); lids.scale.setScalar(R);
    zEnd = (0.82 * R0 * R) / (Math.tan(THREE.MathUtils.degToRad(30 / 2)) * Math.hypot(1, aspect));
  }
  fit();
  let fitQueued = false;
  const onResize = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };
  addEventListener('resize', onResize);

  /* ---------- the entrance: one master timeline ---------- */
  const E = { black: 1, wallIn: 0, open: 0, ignite: 0, decode: 0, flash: 0, push: 0, hint: 0, glow: 0 };
  let ready = false;
  const T = KNOBS.t;
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' }, onComplete: () => { ready = true; } });
  tl.to(E, { black: 0, duration: T.base, ease: 'power2.out' }, 0)
    .to(E, { wallIn: 1.4, duration: 1.4, ease: 'none' }, 0.3)                                     // lines arrive, 15 ms apart
    .to(E, { open: 1, duration: 0.9, ease: 'power3.out' }, 0.9)                                    // a slit of light, then the lids part
    .to(E, { ignite: 1, duration: T.slow, ease: 'power2.out' }, 1.2)                               // rings light from the pupil outward
    .to(E, { decode: 1, duration: T.slow, ease: 'power2.inOut' }, 1.3)                             // scrambled symbols resolve into words
    .to(E, { flash: 1, duration: T.fast, ease: 'expo.out' }, 1.8)                                  // the horizon flashes once
    .to(E, { flash: 0, duration: T.base, ease: 'power3.in' }, 1.8 + T.fast)
    .to(E, { push: 1, duration: T.slow, ease: 'power3.inOut' }, 2.2)                               // a slow 2.5% push-in that settles
    .to(E, { hint: 1, duration: T.base }, 2.8);
  const finishEntrance = () => { tl.progress(1); ready = true; };
  if (reduced || SHOT) { finishEntrance(); if (reduced) gsap.fromTo(stage, { opacity: 0 }, { opacity: 1, duration: T.base, ease: 'power2.out' }); }
  else tl.play();

  /* ---------- state ---------- */
  let active = true, progress = 0, target = 0, lastInput = 0, lastDir = 1, skipping = false, running = false, raf = 0, last = performance.now(), time = 0;
  let spinPhase = 0, driftPhase = 0;
  const mouse = new THREE.Vector2();
  const sac = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 150, holdUntil: 0, side: 1 };
  const blink = { v: 0, phase: 'open', t0: 0, close: 80, hold: 40, open: 150, next: 0, double: false };
  if (SHOT === 'zoom') progress = target = 0.1;
  if (SHOT === 'pupil') progress = target = 0.3;
  if (SHOTP !== null) progress = target = SHOTP;

  function planSaccade(now) {
    const rg = KNOBS.saccade.range;
    sac.fx = sac.x; sac.fy = sac.y;
    if (!touchFirst && rnd() < 0.3 && (mouse.x || mouse.y)) { sac.tx = mouse.x * rg * 0.9; sac.ty = mouse.y * rg * 0.5; }   // a glance toward the cursor
    else if (rnd() < 0.18) { sac.tx = range(-0.15, 0.15) * rg; sac.ty = 0; }                                                // back to the centre now and then
    else { sac.side = -sac.side; sac.tx = sac.side * range(0.6, 1) * rg; sac.ty = range(-1, 1) * rg * 0.18; }               // left, right, left
    sac.t0 = now; sac.dur = range(...KNOBS.saccade.move);
    sac.holdUntil = now + sac.dur + range(...KNOBS.saccade.hold);
    if (Math.abs(sac.tx - sac.fx) > rg * 1.1 && rnd() < 0.35) blink.next = Math.min(blink.next, now + sac.dur + 40);
  }
  function updateBlink(now, allowed) {
    if (blink.phase === 'open') {
      blink.v = 0;
      if (allowed && blink.next && now >= blink.next) { blink.phase = 'closing'; blink.t0 = now; blink.close = range(70, 90); blink.hold = range(30, 50); blink.open = range(120, 180); }
      return;
    }
    const e = now - blink.t0;
    if (blink.phase === 'closing') { blink.v = easeIn(clamp(e / blink.close, 0, 1)); if (e >= blink.close) { blink.phase = 'closed'; blink.t0 = now; } }
    else if (blink.phase === 'closed') { blink.v = 1; if (e >= blink.hold) { blink.phase = 'opening'; blink.t0 = now; } }
    else {
      blink.v = 1 - easeOut(clamp(e / blink.open, 0, 1));
      if (e >= blink.open) {
        blink.phase = 'open'; blink.v = 0;
        if (!blink.double && rnd() < KNOBS.blink.double) { blink.double = true; blink.next = now + range(90, 160); }
        else { blink.double = false; blink.next = now + range(...KNOBS.blink.gap); }
      }
    }
  }

  /* ---------- frame ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;
    if (ready && !blink.next) blink.next = now + range(1500, 3000);

    const idle = now - lastInput;
    if (target < 0 && idle > 160) target += (0 - target) * (1 - Math.exp(-dt * 5));
    if (!SHOT && lastDir > 0 && target > 0.86 && target < 1 && idle > 320) target = 1;
    if (skipping) progress = Math.min(1, Math.max(progress, 0.88) + dt * 0.3);
    else progress += (target - progress) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - progress) < 0.0004) progress = target;
    const p = progress;

    // camera: 0..0.55 dolly to the pupil, 0.55..0.6 into the black, then the fall inside
    let camZ = Z0, fov = KNOBS.fov, zoomE = 0;
    if (reduced) camZ = p < 0 ? Z0 / (1 + p) : Z0;
    else if (p < 0) camZ = Z0 / (1 + p);
    else if (p <= 0.45) { zoomE = easeIO(p / 0.45); camZ = Z0 * Math.pow(zEnd * 0.6 / Z0, zoomE); fov = lerp(KNOBS.fov, 30, zoomE); }   // into the pupil by 0.45
    else { zoomE = 1; camZ = zEnd * 0.6; fov = 30; }
    camZ *= 1 - 0.025 * E.push * (1 - zoomE);
    cam.fov = fov; cam.position.set(0, 0, camZ); cam.updateProjectionMatrix();

    // gaze: alert glances, off once the dive starts so the pupil stays centred
    const gazeOn = ready && !reduced && !SHOT && p <= 0.15 && p >= -0.15;
    if (gazeOn) {
      if (now >= sac.holdUntil) planSaccade(now);
      const k = easeOut(clamp((now - sac.t0) / sac.dur, 0, 1));
      sac.x = lerp(sac.fx, sac.tx, k); sac.y = lerp(sac.fy, sac.ty, k);
    } else { sac.x *= 0.85; sac.y *= 0.85; }
    const fade = gazeOn ? 1 - smooth(0.05, 0.15, p) : 0;
    const jit = gazeOn && now > sac.t0 + sac.dur ? 0.0035 : 0;
    eye.position.set((sac.x + Math.sin(time * 37.1) * Math.sin(time * 13.3) * jit + mouse.x * 0.03) * fade * R, (sac.y + Math.sin(time * 29.7) * Math.sin(time * 17.9) * jit + mouse.y * 0.03) * fade * R, 0);

    // blinks: the lids only; the wall never knows
    updateBlink(now, ready && !SHOT && p <= 0.0001 && p >= -0.15);
    if (p > 0.1) { blink.phase = 'open'; blink.v = 0; }
    const bv = SHOT === 'blink' ? 0.55 : blink.v;
    lidU.uOpen.value = E.open * (1 - bv);

    // iris
    spinPhase += dt * KNOBS.spin * (reduced ? 0.25 : 1 + 2 * zoomE);
    driftPhase += dt * KNOBS.drift * (reduced ? 0.3 : 1 + 2 * zoomE);
    irisU.uSpin.value = spinPhase; irisU.uDrift.value = driftPhase; irisU.uTime.value = time;
    irisU.uSquash.value = lerp(1, 0.97, bv); irisU.uGlow.value = 1 - 0.25 * bv;
    irisU.uIgnite.value = E.ignite; irisU.uDecode.value = E.decode;
    rimU.uFlash.value = E.flash; rimU.uIgnite.value = E.ignite;
    irisU.uDissolve.value = reduced ? 0 : smooth(0.12, 0.45, p) * 0.8;
    wallDom.setOpacity(Math.min(1, E.wallIn) * (1 - smooth(0.1, 0.28, p)));
    // the journey: suction in the pupil (0..0.45), then the void and the black hole (0.45..0.9)
    const deep = !reduced && p >= 0.45;
    outerPass.enabled = !deep; voidPass.enabled = deep;
    suction.update(reduced ? 0 : p, time);
    if (deep) starfield.update(p, time);
    fin.uniforms.uTime.value = time; fin.uniforms.uBlack.value = E.black;

    // DOM: hint, skip, the hole that opens on the portfolio
    hintText.textContent = p < -0.01 ? (touchFirst ? 'Swipe to enter' : 'Scroll to enter') : (touchFirst ? 'Swipe up to zoom in' : 'Scroll to zoom in');
    hint.style.opacity = String(E.hint * (progress < 0 ? 1 : 1 - smooth(0.004, 0.04, progress)));
    skip.style.opacity = String(1 - smooth(0.8, 0.92, progress));
    root.classList.toggle('eye-intro-hide', progress < 0.86);
    if (reduced) {
      if (progress > 0) stage.style.opacity = String(1 - smooth(0.15, 1, progress));
    } else {
      const open = smooth(0.9, 1, p);
      el.classList.toggle('ei-open', p > 0.9);
      el.style.setProperty('--ei-hole', (easeOut(open) * Math.hypot(innerWidth, innerHeight) * 0.56 - 30).toFixed(1) + 'px');
      el.style.setProperty('--ei-ring', String(open > 0 ? Math.sin(Math.PI * open) * 0.9 : 0));
      stage.style.opacity = String(1 - smooth(0.96, 1, p));
    }

    composer.render(dt);
    if (target >= 1 && progress >= 0.997) reveal();
  }

  function play() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); }

  /* ---------- input while the intro is on screen (the zoom waits for the entrance to finish) ---------- */
  const norm = e => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  const bump = dd => { if (!ready || SHOT) return; target = clamp(target + dd, -0.15, 1); lastInput = performance.now(); if (dd) lastDir = Math.sign(dd); };
  const onWheel = e => { if (e.ctrlKey) return; e.preventDefault(); e.stopImmediatePropagation(); bump(clamp(norm(e), -240, 240) * KNOBS.zoomPerPx); };
  let ty = 0;
  const onTouchStart = e => { ty = e.touches[0].clientY; };
  const onTouchMove = e => {
    if (e.target.closest && e.target.closest('.ei-skip')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const y = e.touches[0].clientY; bump((ty - y) / (innerHeight * 1.3)); ty = y;
  };
  const KEYS = { ArrowDown: 0.14, PageDown: 0.25, ' ': 0.25, Spacebar: 0.25, ArrowUp: -0.14, PageUp: -0.25, Home: -1, End: 1 };
  const onKey = e => {
    if (!(e.key in KEYS) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('button,input,textarea,select')) return;
    e.preventDefault(); e.stopImmediatePropagation(); bump(KEYS[e.key]);
  };
  const onMouse = e => { mouse.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)); };
  function lock(on) {
    const m = on ? addEventListener : removeEventListener, o = { capture: true, passive: false };
    m('wheel', onWheel, o); m('touchstart', onTouchStart, { capture: true, passive: true }); m('touchmove', onTouchMove, o); m('keydown', onKey, o);
    m('pointermove', onMouse, { passive: true });
    root.classList.toggle('eye-intro-lock', on);
  }

  /* ---------- reveal / re-enter ---------- */
  let toastShown = false, topSince = performance.now(), toastTimer = 0;
  function reveal() {
    active = false; progress = target = 1; skipping = false;
    pause(); lock(false); wallDom.pause();
    root.classList.remove('eye-intro-hide');
    el.hidden = true; el.classList.remove('ei-open');
    topSince = performance.now();
    if (!toastShown) { toastShown = true; toast.classList.add('ei-show'); toastTimer = setTimeout(() => toast.classList.remove('ei-show'), 2600); }
  }
  function reenter() {
    if (active) return;
    active = true; progress = target = 1; lastInput = performance.now(); lastDir = -1;
    clearTimeout(toastTimer); toast.classList.remove('ei-show');
    el.hidden = false; lock(true); play(); wallDom.resume();
  }
  const onScroll = () => { if (scrollY > 0) topSince = Infinity; else if (topSince === Infinity) topSince = performance.now(); };
  const atTop = () => scrollY <= 0 && performance.now() - topSince > 380;
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('wheel', e => { if (!active && !e.ctrlKey && e.deltaY < 0 && atTop()) { reenter(); bump(clamp(norm(e), -240, 240) * KNOBS.zoomPerPx); } }, { passive: true });
  let tty = 0;
  addEventListener('touchstart', e => { tty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', e => { if (!active && atTop() && e.touches[0].clientY - tty > 28) { reenter(); ty = e.touches[0].clientY; } }, { passive: true });
  addEventListener('keydown', e => { if (!active && (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') && atTop() && !(e.target.closest && e.target.closest('input,textarea,select'))) { reenter(); bump(KEYS[e.key]); } });

  skip.addEventListener('click', () => { finishEntrance(); target = 1; lastDir = 1; skipping = true; setTimeout(() => { if (active && skipping) reveal(); }, 700); });   // a slow GPU never holds the visitor

  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); lock(false); root.classList.remove('eye-intro-hide'); el.hidden = true; active = false; }, { once: true });

  lock(true);
  play(); wallDom.resume();
  document.dispatchEvent(new Event('eye-intro:ready'));
}

start().catch(err => { console.error('[eye-intro]', err); fail(); });
