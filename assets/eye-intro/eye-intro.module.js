/* EYE INTRO: "the watcher". A real 3D eye (eyeball, fibrous iris, cornea glint, skin and blinking lids) drawn entirely in
   mono characters, in the site's colours. Scrolling dilates the pupil and the camera flies through it into a small universe
   (stars, a ringed planet, the Earth and the Moon, from the site's own planet maps); the characters resolve into the real
   image and the portfolio opens out of it. Scrolling up at the top of the portfolio pulls back out to the eye.
   Self-contained: no globals, every listener is its own, and once revealed the render loop stops and the scroll lock is gone. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- knobs ---------- */
const KNOBS = {
  cell: 10, cellMobile: 7, cellDive: 4.5,        // character cell in CSS px: at rest, and deep in the dive
  glyphs: ' .,:;-=+*cxoO0#@',                     // light to dense
  eyeWidth: 0.86,                                 // almond width / screen width (landscape); 0.92 in portrait
  pupil: [0.14, 0.44],                            // pupil radius at rest and fully dilated (iris = 0.48)
  gaze: 0.38,                                     // how far the eyeball turns (rad)
  saccade: { move: [120, 180], hold: [700, 2400] },
  blink: { gap: [2500, 6000], double: 0.15 },
  stars: 2600, starsMobile: 1400,
  zoomPerPx: 1 / 1400,
  bloom: { strength: 0.42, radius: 0.5, threshold: 0.72 },
  fov: 35, dprMax: 1.75,
};

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(hover: none) and (pointer: coarse)').matches;
const fail = () => document.dispatchEvent(new Event('eye-intro:fail'));

/* ---------- palette: derived from the site's own tokens ---------- */
function makePalette() {
  const cs = getComputedStyle(root), tok = (n, f) => cs.getPropertyValue(n).trim() || f;
  const bg = new THREE.Color(tok('--bg', '#06070d')), violet = new THREE.Color(tok('--violet', '#7c5cff')),
    cyan = new THREE.Color(tok('--cyan', '#22d3ee')), pink = new THREE.Color(tok('--pink', '#ff4d8d')),
    text = new THREE.Color(tok('--text', '#e9ebf5'));
  const deep = (c, desat, dark) => { const h = {}; c.getHSL(h); return new THREE.Color().setHSL(h.h, h.s * (1 - desat), h.l * (1 - dark)); };
  return {
    bg: bg.clone().lerp(violet, 0.02),
    skin: deep(violet, 0.55, 0.62).lerp(pink, 0.08),      // dusky, violet-tinted skin so the characters around the eye stay visible
    skinDark: deep(violet, 0.5, 0.86),
    sclera: text.clone().multiplyScalar(0.82),
    irisIn: deep(cyan, 0.15, 0.12),
    irisOut: deep(violet, 0.15, 0.2),
    accent: pink.clone(),
    accentDeep: deep(pink, 0.15, 0.35),
    text: text.clone(), violet: violet.clone(), cyan: cyan.clone(),
    css: { bg: '#' + bg.clone().lerp(violet, 0.02).getHexString(), text: tok('--text', '#e9ebf5'), accent: tok('--pink', '#ff4d8d') },
  };
}

/* ---------- shaders ---------- */
const NOISE = /* glsl */`
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p*=2.03;a*=.5;}return s;}`;

// the eyeball: sclera, iris fibres, limbus, a pupil that is a real hole (the way into the universe), cornea glint
const eyeVert = /* glsl */`
varying vec3 vO; varying vec3 vN; varying vec3 vW;
void main(){vO=position; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`;
const eyeFrag = /* glsl */`
uniform vec3 uSclera, uIn, uOut, uAcc, uDeep, uLight; uniform float uRe, uIris, uPupil, uTime, uGlow;
varying vec3 vO; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  float r=length(vO.xy); float front=step(0.,vO.z);
  if(front>.5 && r<uPupil) discard;                                  // the pupil is open: what is behind it is another scene
  float ang=atan(vO.y,vO.x);
  vec3 N=normalize(vN), L=normalize(uLight), V=normalize(cameraPosition-vW);
  float dif=.32+.68*max(dot(N,L),0.);
  // sclera with faint veins toward the corners
  float side=smoothstep(.35,1.05,r/uRe);
  vec3 col=uSclera*(1.-.38*side);
  float vein=smoothstep(.78,.98,fbm(vec2(ang*6.,r*9.)))*side;
  col=mix(col,uDeep*1.2,vein*.55);
  // iris
  float ir=front*(1.-smoothstep(uIris-.012,uIris+.006,r));
  if(ir>0.){
    float t=clamp((r-uPupil)/(uIris-uPupil),0.,1.);
    float fib=fbm(vec2(ang*28.,r*3.)+vec2(0.,uTime*.03))*.65+fbm(vec2(ang*70.,r*14.))*.45;
    vec3 ic=mix(uIn*1.25,uOut,smoothstep(.15,.95,t))*(.45+.95*fib);
    ic+=uAcc*.55*smoothstep(.7,.95,fbm(vec2(ang*12.,r*6.)))*(1.-t);  // ember flecks near the pupil
    ic+=uIn*.5*exp(-pow((t-.22)/.06,2.));                                // the collarette ring
    ic*=1.-.75*smoothstep(.82,1.,t);                                     // dark limbus
    ic*=1.-.6*(1.-smoothstep(0.,.08,t));                                 // pupil edge falloff
    col=mix(col,ic,ir);
  }
  col*=dif;
  col*=1.-.5*smoothstep(.12,.52,vW.y)-.2*smoothstep(-.2,-.5,vW.y);   // the lids shade the eyeball, mostly from above
  // ember rim on the limbus, like the Nashmi globe
  float lim=exp(-pow((r-uIris)/.018,2.))*front;
  col+=uAcc*lim*.55*uGlow;
  // cornea: a soft wet sheen and one glint
  vec3 H=normalize(L+V); float spec=pow(max(dot(N,H),0.),90.);
  col+=vec3(1.)*spec*1.6*front+uSclera*pow(1.-max(dot(N,V),0.),3.)*.12;
  gl_FragColor=vec4(col,1.);
}`;

// the face around the eye: skin with pores, an almond opening, lid crease, lashes; blinking closes the almond
const faceVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const faceFrag = /* glsl */`
uniform vec3 uSkin, uDark, uAcc; uniform float uW, uH, uBlink, uMeet, uTime;
varying vec2 vP;
${NOISE}
void main(){
  float x=vP.x/uW, xx=clamp(1.-x*x,0.,1.);
  float yu=mix(uH*pow(xx,.62)+uH*.12*x*xx, uMeet+.004, uBlink);         // the upper lid arches, slightly lifted at the inner corner
  float yl=mix(-uH*.78*pow(xx,.8), uMeet, uBlink);
  float inside=step(yl,vP.y)*step(vP.y,yu)*step(abs(x),1.);
  if(inside>.5 && uBlink<.995) discard;
  float du=vP.y-yu, dl=yl-vP.y;
  float d=abs(x)<1.?max(min(du,dl),0.):length(vec2(abs(vP.x)-uW,vP.y));
  if(abs(x)<1.) d=du>0.?du:(dl>0.?dl:0.);
  vec3 col=uSkin*(.72+.55*fbm(vP*11.))*(.9+.2*fbm(vP*2.3+7.));
  col*=1.-.78*exp(-d*7.);                                                // shadow where the skin turns into the eye
  float crease=exp(-pow((vP.y-(yu+.2*xx+.05))/.035,2.))*xx*step(0.,du);
  col*=1.-.5*crease;
  col+=uSkin*.35*exp(-pow((vP.y-(yu+.12*xx+.02))/.06,2.))*xx*step(0.,du); // the lid's soft highlight
  float lash=step(0.,du)*(1.-smoothstep(0.,.07*xx+.005,du))*smoothstep(.35,.75,vn(vec2(vP.x*55.,0.)));
  col=mix(col,uDark*.4,lash*.9);
  col+=uAcc*.5*exp(-pow(du/.008,2.))*xx*step(abs(x),1.)*.35;            // a thin ember line along the lid edges
  col+=uAcc*.3*exp(-pow(dl/.008,2.))*xx*step(abs(x),1.)*.25;
  float far=smoothstep(1.4,3.6,length(vP/vec2(uW,uW*.6)));
  col*=1.-.75*far;                                                       // the face fades into the dark
  gl_FragColor=vec4(col,1.);
}`;

const ringVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const ringFrag = /* glsl */`
uniform vec3 uA, uB; uniform float uIn, uOut; varying vec2 vP;
${NOISE}
void main(){float r=length(vP), t=(r-uIn)/(uOut-uIn); if(t<0.||t>1.) discard;
  float bands=.55+.45*sin(t*70.+vn(vec2(t*40.,1.))*4.); float gap=smoothstep(.56,.6,t)*(1.-smoothstep(.62,.66,t));
  float a=bands*(1.-gap*.9)*smoothstep(0.,.06,t)*(1.-smoothstep(.9,1.,t))*.5;
  gl_FragColor=vec4(mix(uA,uB,t)*bands,a);}`;

// characters: every cell takes the colour of what is under it and the glyph of its brightness
const asciiShader = {
  uniforms: { tDiffuse: { value: null }, uGlyphs: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uCell: { value: 10 }, uCount: { value: 16 }, uMix: { value: 0 }, uFloor: { value: new THREE.Color() } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse, uGlyphs; uniform vec2 uRes; uniform float uCell, uCount, uMix; uniform vec3 uFloor; varying vec2 vUv;
void main(){
  vec2 px=vUv*uRes, cell=floor(px/uCell), c0=cell*uCell;
  vec3 col=vec3(0.);
  col+=texture2D(tDiffuse,(c0+uCell*vec2(.3,.3))/uRes).rgb; col+=texture2D(tDiffuse,(c0+uCell*vec2(.7,.3))/uRes).rgb;
  col+=texture2D(tDiffuse,(c0+uCell*vec2(.3,.7))/uRes).rgb; col+=texture2D(tDiffuse,(c0+uCell*vec2(.7,.7))/uRes).rgb;
  col*=.25;
  float lum=pow(clamp(dot(col,vec3(.2126,.7152,.0722)),0.,1.),1./2.2);
  float gi=floor(clamp((lum-.035)*1.25,0.,.999)*uCount);            // near-black stays empty: no dot grid on the background
  vec2 f=fract(px/uCell);
  float g=texture2D(uGlyphs,vec2((gi+f.x)/uCount,f.y)).r;
  float mx=max(max(col.r,col.g),max(col.b,1e-4));
  vec3 hue=col/mx;
  vec3 ascii=hue*mix(.4,1.35,lum)*g*(1.25+lum*.8)+uFloor;
  vec3 real=texture2D(tDiffuse,vUv).rgb;
  gl_FragColor=vec4(mix(ascii,real,uMix),1.);
}`,
};

const finalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNoise: { value: 0.03 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uTime, uNoise; varying vec2 vUv;
void main(){vec4 c=texture2D(tDiffuse,vUv); float d=distance(vUv,vec2(.5)); c.rgb*=mix(.55,1.,smoothstep(.85,.3,d));
  float n=fract(sin(dot(vUv*vec2(1920.,1080.)+fract(uTime)*97.,vec2(12.9898,78.233)))*43758.5453); c.rgb+=(n-.5)*uNoise; gl_FragColor=c;}`,
};

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const lerp = (a, b, t) => a + (b - a) * t;
const range = (a, b) => a + (b - a) * Math.random();

function glyphAtlas(chars) {
  const n = chars.length, S = 64, c = document.createElement('canvas'); c.width = S * n; c.height = S;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, S);
  g.fillStyle = '#fff'; g.font = '500 52px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...chars].forEach((ch, i) => g.fillText(ch, i * S + S / 2, S / 2 + 2));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

/* ---------- build ---------- */
async function start() {
  await Promise.race([document.fonts.load('500 52px "IBM Plex Mono"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  const pal = makePalette();
  const mobile = innerWidth < 760 || touchFirst;

  /* DOM */
  const el = document.createElement('div');
  el.id = 'eye-intro'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Intro');
  el.style.setProperty('--ei-bg', pal.css.bg); el.style.setProperty('--ei-text', pal.css.text); el.style.setProperty('--ei-accent', pal.css.accent);
  el.innerHTML = '<div class="ei-stage"><div class="ei-ring"></div></div><div class="ei-hint" aria-hidden="true"><span class="ei-line"></span><span class="ei-text"></span></div><button type="button" class="ei-skip">Skip intro</button>';
  const stage = el.querySelector('.ei-stage'), hint = el.querySelector('.ei-hint'), hintText = el.querySelector('.ei-hint .ei-text'), skip = el.querySelector('.ei-skip');
  const toast = document.createElement('div');
  toast.id = 'eye-intro-toast'; toast.setAttribute('aria-hidden', 'true');
  toast.style.setProperty('--ei-text', pal.css.text); toast.style.setProperty('--ei-accent', pal.css.accent);
  toast.innerHTML = '<span class="ei-line"></span><span class="ei-text">Scroll up to zoom out</span>';

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return fail(); }
  const dpr = Math.min(devicePixelRatio, KNOBS.dprMax);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(pal.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  document.body.append(el, toast);

  /* ---------- the outside: the eye ---------- */
  const Re = 1.3, IRIS = 0.48, W = 1.06, H = 0.5, FACE_Z = 1.22, PUPIL_Z = Re;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.001, 100);
  const eyeU = {
    uSclera: { value: pal.sclera }, uIn: { value: pal.irisIn }, uOut: { value: pal.irisOut }, uAcc: { value: pal.accent }, uDeep: { value: pal.accentDeep },
    uLight: { value: new THREE.Vector3(-0.55, 0.65, 1) }, uRe: { value: Re }, uIris: { value: IRIS }, uPupil: { value: KNOBS.pupil[0] }, uTime: { value: 0 }, uGlow: { value: 1 },
  };
  const eyeball = new THREE.Mesh(new THREE.SphereGeometry(Re, 128, 96), new THREE.ShaderMaterial({ uniforms: eyeU, vertexShader: eyeVert, fragmentShader: eyeFrag, depthTest: false, depthWrite: false }));
  eyeball.renderOrder = 1; scene.add(eyeball);
  const faceU = { uSkin: { value: pal.skin }, uDark: { value: pal.skinDark }, uAcc: { value: pal.accent }, uW: { value: W }, uH: { value: H }, uBlink: { value: 0 }, uMeet: { value: -0.12 }, uTime: { value: 0 } };
  const face = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({ uniforms: faceU, vertexShader: faceVert, fragmentShader: faceFrag, depthTest: false, depthWrite: false }));
  face.position.z = FACE_Z; face.renderOrder = 2; scene.add(face);

  /* ---------- the inside: a small universe behind the pupil ---------- */
  const inner = new THREE.Scene();
  const innerCam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.1, 2000);
  inner.add(new THREE.AmbientLight(0xffffff, 0.12));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2); sun.position.set(30, 12, 20); inner.add(sun);
  const NS = mobile ? KNOBS.starsMobile : KNOBS.stars, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
  const starCols = [pal.text, pal.cyan, pal.violet, pal.accent];
  for (let i = 0; i < NS; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = range(120, 700), s = Math.sqrt(1 - u * u);
    sp.set([Math.cos(th) * s * rr, Math.sin(th) * s * rr, u * rr], i * 3);
    const c = starCols[Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3)]; sc.set([c.r, c.g, c.b], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  inner.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));
  const loader = new THREE.TextureLoader();
  const map = name => { const t = loader.load('assets/planets/' + name); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const giant = new THREE.Mesh(new THREE.SphereGeometry(6, 96, 64), new THREE.MeshStandardMaterial({ map: map('jupiter-sd.jpg'), roughness: 1, metalness: 0 }));
  giant.position.set(0, 0, -60); giant.rotation.set(0.12, 0, 0.42); inner.add(giant);
  const ringU = { uA: { value: pal.text.clone().multiplyScalar(0.55) }, uB: { value: pal.violet.clone().multiplyScalar(0.5) }, uIn: { value: 8 }, uOut: { value: 15 } };
  const ring = new THREE.Mesh(new THREE.RingGeometry(8, 15, 160, 1), new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2 + 0.22; giant.add(ring);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(2.2, 64, 48), new THREE.MeshStandardMaterial({ map: map('earth-day-sd.jpg'), roughness: 0.9 }));
  earth.position.set(-11, 4, -22); earth.rotation.z = 0.41; inner.add(earth);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 48, 32), new THREE.MeshStandardMaterial({ map: map('moon-sd.jpg'), roughness: 1 }));
  moon.position.set(-7.5, 5.6, -18); inner.add(moon);

  /* ---------- post: two scenes into one image, then characters, then a soft glow ---------- */
  const composer = new EffectComposer(renderer);
  const innerPass = new RenderPass(inner, innerCam);
  const outerPass = new RenderPass(scene, cam); outerPass.clear = false; outerPass.clearDepth = true;
  composer.addPass(innerPass); composer.addPass(outerPass);
  const ascii = new ShaderPass(asciiShader);
  ascii.uniforms.uGlyphs.value = glyphAtlas(KNOBS.glyphs); ascii.uniforms.uCount.value = KNOBS.glyphs.length;
  ascii.uniforms.uFloor.value.copy(pal.bg).multiplyScalar(0.35);
  composer.addPass(ascii);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), KNOBS.bloom.strength, KNOBS.bloom.radius, KNOBS.bloom.threshold);
  composer.addPass(bloom);
  const fin = new ShaderPass(finalShader); composer.addPass(fin);
  composer.addPass(new OutputPass());

  /* fit: the almond fills 86% of the width (92% in portrait), in world units at the pupil's depth */
  let camZ0 = 4, aspect = 1;
  const tanH = deg => Math.tan(THREE.MathUtils.degToRad(deg / 2));
  function fit() {
    const w = innerWidth, h = innerHeight; aspect = w / h;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2);
    cam.aspect = innerCam.aspect = aspect; innerCam.updateProjectionMatrix();
    const share = aspect < 1 ? 0.92 : KNOBS.eyeWidth;
    const visW = (2 * W) / share;
    let visH = visW / aspect;
    if (aspect >= 1 && visH < 2 * H * 2.1) visH = 2 * H * 2.1;   // short, wide screens keep some skin above and below
    camZ0 = PUPIL_Z + visH / (2 * tanH(KNOBS.fov));
    ascii.uniforms.uRes.value.set(w * dpr, h * dpr);
  }
  fit();
  let fitQueued = false;
  const onResize = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };
  addEventListener('resize', onResize);

  /* ---------- state ---------- */
  let active = true, progress = 0, target = 0, lastInput = 0, lastDir = 1, skipping = false, running = false, raf = 0, last = performance.now(), time = 0;
  const mouse = new THREE.Vector2();
  const sac = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 150, holdUntil: 0 };
  const blink = { v: 0, phase: 'open', t0: 0, close: 80, hold: 40, open: 150, next: performance.now() + range(4500, 6500), double: false };   // the first look is with open eyes

  function planSaccade(now) {
    sac.fx = sac.x; sac.fy = sac.y;
    if (!touchFirst && Math.random() < 0.45 && (mouse.x || mouse.y)) { sac.tx = mouse.x; sac.ty = mouse.y; }   // it watches the cursor
    else { sac.tx = range(-0.8, 0.8); sac.ty = range(-0.5, 0.5); }
    sac.t0 = now; sac.dur = range(...KNOBS.saccade.move);
    sac.holdUntil = now + sac.dur + range(...KNOBS.saccade.hold);
    if (Math.hypot(sac.tx - sac.fx, sac.ty - sac.fy) > 0.9 && Math.random() < 0.35) blink.next = Math.min(blink.next, now + sac.dur + 40);
  }
  function updateBlink(now, allowed) {
    if (blink.phase === 'open') {
      blink.v = 0;
      if (allowed && now >= blink.next) { blink.phase = 'closing'; blink.t0 = now; blink.close = reduced ? 320 : range(70, 90); blink.hold = reduced ? 80 : range(30, 50); blink.open = reduced ? 520 : range(120, 180); }
      return;
    }
    const e = now - blink.t0;
    if (blink.phase === 'closing') { blink.v = easeIn(clamp(e / blink.close, 0, 1)); if (e >= blink.close) { blink.phase = 'closed'; blink.t0 = now; } }
    else if (blink.phase === 'closed') { blink.v = 1; if (e >= blink.hold) { blink.phase = 'opening'; blink.t0 = now; } }
    else {
      blink.v = 1 - easeOut(clamp(e / blink.open, 0, 1));
      if (e >= blink.open) {
        blink.phase = 'open'; blink.v = 0;
        if (!blink.double && Math.random() < KNOBS.blink.double && !reduced) { blink.double = true; blink.next = now + range(90, 160); }
        else { blink.double = false; blink.next = now + (reduced ? range(6000, 9000) : range(...KNOBS.blink.gap)); }
      }
    }
  }

  /* ---------- frame ---------- */
  const cellBase = mobile ? KNOBS.cellMobile : KNOBS.cell;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;

    const idle = now - lastInput;
    if (target < 0 && idle > 160) target += (0 - target) * (1 - Math.exp(-dt * 5));
    if (lastDir > 0 && target > 0.86 && target < 1 && idle > 320) target = 1;   // only when heading in, never while pulling out
    if (skipping) progress = Math.min(1, Math.max(progress, 0.88) + dt * 0.3);
    else progress += (target - progress) * (1 - Math.exp(-dt * 5));
    if (Math.abs(target - progress) < 0.0004) progress = target;
    const p = reduced ? Math.min(progress, 0) : progress;

    // outer camera: a pull-back below 0, then a dolly into the pupil that reaches it at 0.5
    const d0 = camZ0 - PUPIL_Z, dEnd = 0.004;
    let d;
    if (p < 0) d = d0 / (1 + p);
    else { const e = easeIO(clamp(p / 0.5, 0, 1)); d = d0 * Math.pow(dEnd / d0, e); }
    const fov = KNOBS.fov - 5 * smooth(0.1, 0.5, p);
    cam.fov = innerCam.fov = fov; cam.position.set(0, 0, PUPIL_Z + d); cam.lookAt(0, 0, PUPIL_Z); cam.updateProjectionMatrix(); innerCam.updateProjectionMatrix();
    outerPass.enabled = p < 0.5 && d > dEnd * 1.5;

    // the pupil dilates as you lean in (and makes room to pass)
    eyeU.uPupil.value = lerp(KNOBS.pupil[0], KNOBS.pupil[1], smooth(0.04, 0.42, p)) * (1 + 0.04 * Math.sin(time * 0.9));

    // gaze: saccades toward the cursor or around the room; centred before the dive
    const gazeOn = !reduced && p <= 0.12;
    if (gazeOn) {
      if (now >= sac.holdUntil) planSaccade(now);
      const k = easeOut(clamp((now - sac.t0) / sac.dur, 0, 1));
      sac.x = lerp(sac.fx, sac.tx, k); sac.y = lerp(sac.fy, sac.ty, k);
    }
    const gfade = gazeOn ? 1 - smooth(0.02, 0.12, p) : 0;
    const jit = gazeOn && now > sac.t0 + sac.dur ? 0.012 : 0;
    const gx = (sac.x + Math.sin(time * 37.1) * Math.sin(time * 13.3) * jit) * gfade, gy = (sac.y + Math.sin(time * 29.7) * Math.sin(time * 17.9) * jit) * gfade;
    const gk = gazeOn ? 1 : 1 - Math.exp(-dt * 6);
    eyeball.rotation.y += (gx * KNOBS.gaze - eyeball.rotation.y) * gk;
    eyeball.rotation.x += (-gy * KNOBS.gaze * 0.7 - eyeball.rotation.x) * gk;

    // blinks: never during the dive
    updateBlink(now, p <= 0.0001 && p >= -0.15);
    if (p > 0.05) { blink.phase = 'open'; blink.v = 0; }
    faceU.uBlink.value = blink.v; faceU.uMeet.value = -0.12 + gy * 0.06;
    eyeU.uTime.value = time; eyeU.uGlow.value = (1 - 0.35 * blink.v) * (1 + smooth(0.1, 0.45, p));

    // inner camera: waits far away (stars and a tiny planet seen through the pupil), then flies past the Earth to the giant
    const q = easeIO(smooth(0.3, 0.95, p));
    innerCam.position.set(lerp(0, 5.5, q) - Math.sin(q * Math.PI) * 6, lerp(0, 1.6, q), lerp(40, -40, q));
    innerCam.lookAt(lerp(0, -1, q), 0, -60);
    giant.rotation.y += dt * 0.05; earth.rotation.y += dt * 0.08;

    // characters: finer as we fall in, then they resolve into the picture
    ascii.uniforms.uCell.value = Math.max(3, Math.round(lerp(cellBase, KNOBS.cellDive, smooth(0.15, 0.75, p)) * dpr));   // whole pixels: no moire bands
    ascii.uniforms.uMix.value = reduced ? 0 : smooth(0.72, 0.93, p);
    bloom.strength = KNOBS.bloom.strength * (1 + 0.5 * smooth(0.3, 0.8, p));
    fin.uniforms.uTime.value = time;

    // DOM: hint, skip, the hole that opens on the portfolio
    hintText.textContent = p < -0.01 ? (touchFirst ? 'Swipe to enter' : 'Scroll to enter') : (touchFirst ? 'Swipe up to zoom in' : 'Scroll to zoom in');
    hint.style.opacity = String(1 - smooth(0.05, 0.2, progress));
    skip.style.opacity = String(1 - smooth(0.8, 0.92, progress));
    root.classList.toggle('eye-intro-hide', progress < 0.86);
    if (reduced) {
      stage.style.opacity = String(1 - smooth(0.15, 1, progress));
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

  /* ---------- input while the intro is on screen ---------- */
  const norm = e => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  const bump = dd => { target = clamp(target + dd, -0.15, 1); lastInput = performance.now(); if (dd) lastDir = Math.sign(dd); };
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
    pause(); lock(false);
    root.classList.remove('eye-intro-hide');
    el.hidden = true; el.classList.remove('ei-open');
    topSince = performance.now();
    if (!toastShown) { toastShown = true; toast.classList.add('ei-show'); toastTimer = setTimeout(() => toast.classList.remove('ei-show'), 2600); }
  }
  function reenter() {
    if (active) return;
    active = true; progress = target = 1; lastInput = performance.now(); lastDir = -1;
    clearTimeout(toastTimer); toast.classList.remove('ei-show');
    el.hidden = false; lock(true); play();
  }
  // at the very top of the portfolio, scrolling up pulls back out to the eye (passive: the site's own scrolling is untouched)
  const onScroll = () => { if (scrollY > 0) topSince = Infinity; else if (topSince === Infinity) topSince = performance.now(); };
  const atTop = () => scrollY <= 0 && performance.now() - topSince > 380;
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('wheel', e => { if (!active && !e.ctrlKey && e.deltaY < 0 && atTop()) { reenter(); bump(clamp(norm(e), -240, 240) * KNOBS.zoomPerPx); } }, { passive: true });
  let tty = 0;
  addEventListener('touchstart', e => { tty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', e => { if (!active && atTop() && e.touches[0].clientY - tty > 28) { reenter(); ty = e.touches[0].clientY; } }, { passive: true });
  addEventListener('keydown', e => { if (!active && (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') && atTop() && !(e.target.closest && e.target.closest('input,textarea,select'))) { reenter(); bump(KEYS[e.key]); } });

  skip.addEventListener('click', () => { target = 1; lastDir = 1; skipping = true; setTimeout(() => { if (active && skipping) reveal(); }, 700); });   // a slow GPU never holds the visitor

  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); lock(false); root.classList.remove('eye-intro-hide'); el.hidden = true; active = false; }, { once: true });

  lock(true);
  play();
  document.dispatchEvent(new Event('eye-intro:ready'));
}

start().catch(err => { console.error('[eye-intro]', err); fail(); });
