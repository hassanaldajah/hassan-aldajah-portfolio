/* EYE INTRO: "the watcher". A real 3D eye (eyeball, fibrous iris, cornea glint, skin and blinking lids) drawn entirely in
   mono characters, in the site's colours. Scrolling dilates the pupil and the camera flies through it into a small universe
   and falls into a black hole: the iris twists, gravity pulls the picture in, the horizon swallows the view and the
   portfolio opens out of the dark. Scrolling up at the top of the portfolio pulls back out to the eye.
   Self-contained: no globals, every listener is its own, and once revealed the render loop stops and the scroll lock is gone. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- knobs ---------- */
const KNOBS = {
  cell: 6, cellMobile: 5, cellDive: 4,           // character cell in CSS px: dense, like a terminal printing the eye
  glyphs: " .`',:;~-_=+<>*rcvxznusoaeyjtfLJCQ0OZwmqpdbkhgXYUMW8&%#@$",   // code characters, light to dense (no tall strokes in the dark tones: they print as stripes)
  eyeWidth: 0.92,                                 // almond width / screen width (landscape); 0.92 in portrait
  pupil: [0.12, 0.46],                            // pupil radius at rest and fully dilated (iris = 0.5)
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
    skin: new THREE.Color('#6a4632'), skinLight: new THREE.Color('#93664a'), skinDark: new THREE.Color('#140b07'), caruncle: new THREE.Color('#b8675e'),
    sclera: new THREE.Color('#ebe6e0'), scleraShade: new THREE.Color('#a39388'), vein: new THREE.Color('#a33a36'),
    irisIn: new THREE.Color('#d39a3f'), irisMid: new THREE.Color('#8c5424'), irisOut: new THREE.Color('#3e2414'), limbus: new THREE.Color('#0e0805'),
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
uniform vec3 uSclera, uShade, uVein, uIrisIn, uIrisMid, uIrisOut, uLimbus, uLight; uniform float uRe, uIris, uPupil, uTime, uOpen;
varying vec3 vO; varying vec3 vN; varying vec3 vW;
${NOISE}
void main(){
  float r=length(vO.xy); float front=step(0.,vO.z);
  if(front>.5 && r<uPupil){ if(uOpen<.5){ gl_FragColor=vec4(0.,0.,0.,1.); return; } discard; }   // black at rest; once you lean in it opens onto another scene
  float ang=atan(vO.y,vO.x);
  vec3 N=normalize(vN), L=normalize(uLight), V=normalize(cameraPosition-vW);
  float dif=.45+.55*max(dot(N,L),0.);
  // sclera: white, greying toward the corners, fine red veins
  float side=smoothstep(.55,1.15,r/uRe);
  vec3 col=mix(uSclera,uShade,side*.7);                              // soft: a steep gradient prints as rings of characters
  float v1=smoothstep(.72,.95,fbm(vec2(ang*5.,r*7.)+3.)), v2=smoothstep(.8,.97,fbm(vec2(ang*14.,r*20.)));
  col=mix(col,uVein,(v1*.35+v2*.25)*side);
  // iris: radial fibres, crypts, a golden collarette, a dark limbal ring
  float edge=smoothstep(uIris+.006,uIris-.012,r)*front;
  if(edge>0.){
    float t=clamp((r-uPupil)/(uIris-uPupil),0.,1.);
    float fib=fbm(vec2(ang*40.,t*2.5))*.6+fbm(vec2(ang*110.,t*8.))*.5;
    vec3 ic=mix(uIrisIn,uIrisMid,smoothstep(.05,.42,t)); ic=mix(ic,uIrisOut,smoothstep(.45,.92,t));
    ic*=.55+.8*fib;
    float crypt=smoothstep(.62,.8,fbm(vec2(ang*9.,t*6.)+7.))*smoothstep(.2,.35,t)*(1.-smoothstep(.6,.78,t));
    ic*=1.-.55*crypt;
    ic+=uIrisIn*.4*exp(-pow((t-.3)/.05,2.))*fib;
    ic=mix(ic,uLimbus,smoothstep(.8,1.,t));
    ic*=mix(.3,1.,smoothstep(0.,.07,t));
    col=mix(col,ic,edge);
  }
  col*=dif;
  col*=1.-.55*smoothstep(.05,.45,vW.y)-.18*smoothstep(-.15,-.45,vW.y);  // the lids shade the eyeball
  // cornea: a window-like glint and a wet sheen
  vec3 H=normalize(L+V); float spec=pow(max(dot(N,H),0.),140.);
  col+=vec3(1.)*spec*2.4*front+uSclera*pow(1.-max(dot(N,V),0.),4.)*.08;
  gl_FragColor=vec4(col,1.);
}`;

// the face around the eye: skin with pores, an almond opening, lid crease, lashes; blinking closes the almond
const faceVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const faceFrag = /* glsl */`
uniform vec3 uSkin, uLight2, uDark, uCar; uniform float uW, uH, uBlink, uMeet;
varying vec2 vP;
${NOISE}
void main(){
  float x=vP.x/uW, xx=clamp(1.-x*x,0.,1.), tilt=.07*x;                  // x<0: inner corner (lower, rounder); x>0: outer corner (lifted)
  float upper=uH*pow(xx,.55)*(1.-.1*x)+tilt, lower=-uH*.7*pow(xx,.9)+tilt*.5-.02;
  float yu=mix(upper,uMeet,uBlink), yl=mix(lower,uMeet,uBlink);
  float inside=step(yl,vP.y)*step(vP.y,yu)*step(abs(x),1.);
  float car=inside*smoothstep(-.8,-.95,x);                              // the pink caruncle in the inner corner
  if(inside>.5 && car<.5 && uBlink<.995) discard;
  float du=vP.y-yu, dl=yl-vP.y;
  float d=inside>.5?0.:(abs(x)<1.?(du>0.?du:dl):length(vec2(abs(vP.x)-uW,vP.y-tilt)));
  vec3 col=uSkin*(.8+.4*fbm(vP*14.))*(.9+.2*fbm(vP*3.+5.));
  float up=step(0.,du)*step(abs(x),1.12), lo=step(0.,dl)*step(abs(x),1.12);
  float fold=.2*xx+.05;
  col=mix(col,uLight2*(.85+.3*fbm(vP*20.)),up*exp(-pow((du/fold-.45)/.35,2.))*.75);   // the lit, rounded upper lid
  col*=1.-.6*exp(-pow((du-fold)/.03,2.))*up;                                          // the crease
  col*=1.-.8*exp(-d*26.);                                                              // shadow where skin meets the eye
  float lashes=up*(1.-smoothstep(0.,.11*xx+.01,du))*step(.62,h21(vec2(floor((vP.x+du*(.6+.9*x))*130.),3.)));
  col=mix(col,uDark,max(lashes,up*(1.-smoothstep(0.,.012,du))));
  col+=uLight2*.25*exp(-pow((dl-.03)/.03,2.))*lo;                                     // the moist lower rim catches light
  col*=1.-.3*exp(-pow((dl-.17*xx)/.07,2.))*lo;                                        // under-eye shadow
  if(car>.5) col=uCar*(.7+.4*fbm(vP*40.));
  col*=1.-.85*smoothstep(1.25,3.1,length(vP/vec2(uW,uW*.62)));                        // the face falls into darkness
  gl_FragColor=vec4(col,1.);
}`;

const ringVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const diskFrag = /* glsl */`
uniform vec3 uHot, uMid, uCold; uniform float uIn, uOut, uTime, uHeat; varying vec2 vP;
${NOISE}
void main(){
  float r=length(vP), t=(r-uIn)/(uOut-uIn); if(t<0.||t>1.) discard;
  float a=atan(vP.y,vP.x), sw=a+uTime*(.9/(.25+t));                       // the inner disk races, the outer drifts
  float n=fbm(vec2(sw*3.,t*14.-uTime*.4))*.7+fbm(vec2(sw*9.,t*30.))*.4;
  float heat=pow(1.-t,2.2);
  vec3 c=mix(uCold,uMid,smoothstep(0.,.6,heat)); c=mix(c,uHot,smoothstep(.55,1.,heat));
  float dop=.5+.5*cos(a-.6);                                               // the side rushing toward us burns brighter
  float I=(heat*2.2+.06)*(.35+.9*n)*(.25+.75*dop)*uHeat;
  float edge=smoothstep(0.,.04,t)*(1.-smoothstep(.75,1.,t));
  gl_FragColor=vec4(c*I*edge,1.);
}`;

// gravity: the picture twists and is pulled toward the centre, colours split at the edges, and a darkness grows in the middle
const lensShader = {
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 }, uSwirl: { value: 0 }, uPull: { value: 0 }, uShadow: { value: 0 }, uShake: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uAspect, uSwirl, uPull, uShadow; uniform vec2 uShake; varying vec2 vUv;
void main(){
  vec2 d=vUv-.5+uShake; d.x*=uAspect; float r=length(d);
  float tw=uSwirl*exp(-r*2.2); float c=cos(tw), s=sin(tw); d=mat2(c,-s,s,c)*d;
  d*=1.+uPull*.6*exp(-r*3.);
  vec2 uv=d; uv.x/=uAspect; uv+=.5;
  vec2 dir=normalize(d+1e-5); dir.x/=uAspect; float ca=uPull*.006/(r+.2);
  vec3 col=vec3(texture2D(tDiffuse,uv+dir*ca).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-dir*ca).b);
  col*=smoothstep(uShadow*.85,uShadow*1.15+.001,r);
  gl_FragColor=vec4(col,1.);
}`,
};

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
  const n = chars.length, S = 48, c = document.createElement('canvas'); c.width = S * n; c.height = S;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, S);
  g.fillStyle = '#fff'; g.font = '500 40px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
  const Re = 1.8, IRIS = 0.5, W = 1.15, H = 0.44, FACE_Z = 1.72, PUPIL_Z = Re;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.001, 100);
  const eyeU = {
    uSclera: { value: pal.sclera }, uShade: { value: pal.scleraShade }, uVein: { value: pal.vein },
    uIrisIn: { value: pal.irisIn }, uIrisMid: { value: pal.irisMid }, uIrisOut: { value: pal.irisOut }, uLimbus: { value: pal.limbus },
    uLight: { value: new THREE.Vector3(-0.55, 0.65, 1) }, uRe: { value: Re }, uIris: { value: IRIS }, uPupil: { value: KNOBS.pupil[0] }, uTime: { value: 0 }, uOpen: { value: 0 },
  };
  const eyeball = new THREE.Mesh(new THREE.SphereGeometry(Re, 128, 96), new THREE.ShaderMaterial({ uniforms: eyeU, vertexShader: eyeVert, fragmentShader: eyeFrag, depthTest: false, depthWrite: false }));
  eyeball.renderOrder = 1; scene.add(eyeball);
  const faceU = { uSkin: { value: pal.skin }, uLight2: { value: pal.skinLight }, uDark: { value: pal.skinDark }, uCar: { value: pal.caruncle }, uW: { value: W }, uH: { value: H }, uBlink: { value: 0 }, uMeet: { value: -0.1 } };
  const face = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({ uniforms: faceU, vertexShader: faceVert, fragmentShader: faceFrag, depthTest: false, depthWrite: false }));
  face.position.z = FACE_Z; face.renderOrder = 2; scene.add(face);

  /* ---------- the inside: a small universe behind the pupil ---------- */
  const inner = new THREE.Scene();
  const innerCam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.1, 2000);
  const NS = mobile ? KNOBS.starsMobile : KNOBS.stars, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
  const starCols = [pal.text, pal.cyan, pal.violet, pal.accent];
  for (let i = 0; i < NS; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = range(120, 700), s = Math.sqrt(1 - u * u);
    sp.set([Math.cos(th) * s * rr, Math.sin(th) * s * rr, u * rr], i * 3);
    const c = starCols[Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3)]; sc.set([c.r, c.g, c.b], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  inner.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));
  // behind the pupil: a black hole with a burning accretion disk (the site's own finale, seen from inside the eye)
  const HOLE = new THREE.Vector3(0, 0, -60);
  const horizon = new THREE.Mesh(new THREE.SphereGeometry(4, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  horizon.position.copy(HOLE); inner.add(horizon);
  const diskU = { uHot: { value: pal.text.clone().lerp(pal.accent, 0.35) }, uMid: { value: pal.accent.clone() }, uCold: { value: pal.violet.clone().multiplyScalar(0.55) }, uIn: { value: 4.6 }, uOut: { value: 24 }, uTime: { value: 0 }, uHeat: { value: 1 } };
  const diskMat = u => new THREE.ShaderMaterial({ uniforms: u, vertexShader: ringVert, fragmentShader: diskFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const disk = new THREE.Mesh(new THREE.RingGeometry(4.6, 24, 256, 8), diskMat(diskU));
  disk.position.copy(HOLE); disk.rotation.x = -Math.PI / 2 + 0.2; inner.add(disk);
  // the far side of the disk, bent by gravity into a halo around the hole; it always faces the camera
  const halo = new THREE.Mesh(new THREE.RingGeometry(4.15, 8, 256, 4), diskMat({ ...diskU, uIn: { value: 4.15 }, uOut: { value: 8 } }));
  halo.position.copy(HOLE); inner.add(halo);

  /* ---------- post: two scenes into one image, then characters, then a soft glow ---------- */
  const composer = new EffectComposer(renderer);
  const innerPass = new RenderPass(inner, innerCam, null, new THREE.Color(0x000000), 1);   // space behind the pupil is truly black
  const outerPass = new RenderPass(scene, cam); outerPass.clear = false; outerPass.clearDepth = true;
  composer.addPass(innerPass); composer.addPass(outerPass);
  const lens = new ShaderPass(lensShader); composer.addPass(lens);
  const ascii = new ShaderPass(asciiShader);
  ascii.uniforms.uGlyphs.value = glyphAtlas(KNOBS.glyphs); ascii.uniforms.uCount.value = KNOBS.glyphs.length;
  ascii.uniforms.uFloor.value.copy(pal.bg).multiplyScalar(0.12);
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
    ascii.uniforms.uRes.value.set(w * dpr, h * dpr); lens.uniforms.uAspect.value = aspect;
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
    faceU.uBlink.value = blink.v; faceU.uMeet.value = -0.1 + gy * 0.05;
    eyeU.uTime.value = time; eyeU.uOpen.value = p > 0.03 ? 1 : 0;

    // the fall: through the pupil a tiny burning ring waits; the camera spirals down onto it until the horizon swallows the view
    const q = easeIO(smooth(0.3, 0.93, p)), fall = smooth(0.5, 0.9, p);
    const dist = 70 * Math.pow(5.4 / 70, q), az = q * 1.7, elev = lerp(0.06, 0.3, q);
    innerCam.position.set(HOLE.x + Math.sin(az) * Math.cos(elev) * dist, HOLE.y + Math.sin(elev) * dist, HOLE.z + Math.cos(az) * Math.cos(elev) * dist);
    const roll = q * 0.9 + (reduced ? 0 : Math.sin(time * 1.3) * 0.05 * fall);
    innerCam.up.set(Math.sin(roll), Math.cos(roll), 0); innerCam.lookAt(HOLE);
    halo.quaternion.copy(innerCam.quaternion);
    diskU.uTime.value = time; diskU.uHeat.value = smooth(0.04, 0.3, p) * (1 + 0.8 * fall);   // a real, black pupil at rest; the fire wakes as you lean in
    // gravity on the picture: the iris starts to twist into the pupil, then everything is pulled in and goes dark
    lens.uniforms.uShake.value.set(0, 0);
    lens.uniforms.uSwirl.value = reduced ? 0 : fall * 1.2;   // only gravity near the hole bends the picture
    lens.uniforms.uPull.value = reduced ? 0 : fall * 0.6;
    lens.uniforms.uShadow.value = smooth(0.8, 0.95, p) * 1.1;

    // characters: finer as we fall in, then they resolve into the picture
    ascii.uniforms.uCell.value = Math.max(3, Math.round(lerp(cellBase, KNOBS.cellDive, smooth(0.15, 0.75, p)) * dpr));   // whole pixels: no moire bands
    ascii.uniforms.uMix.value = 0;   // it stays in characters to the end: the dark takes it, not a fade
    bloom.strength = KNOBS.bloom.strength * (1 + 0.5 * smooth(0.3, 0.8, p));
    fin.uniforms.uTime.value = time;

    // DOM: hint, skip, the hole that opens on the portfolio
    hintText.textContent = p < -0.01 ? (touchFirst ? 'Swipe to enter' : 'Scroll to enter') : (touchFirst ? 'Swipe up to zoom in' : 'Scroll to zoom in');
    hint.style.opacity = String(progress < 0 ? 1 : 1 - smooth(0.004, 0.04, progress));   // gone with the first scroll in; back for 'scroll to enter'
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
