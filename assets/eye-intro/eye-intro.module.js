/* EYE INTRO: "the watcher". An iris of cybersecurity words, a black pupil, an ember rim like the Nashmi globe, eyelids made of the
   log wall around it. The wheel / a swipe / the arrow keys dolly the camera into the pupil and the portfolio opens through it;
   scrolling up at the top of the portfolio pulls back out to the eye. Self-contained: no globals, every listener is its own,
   and once the portfolio is revealed the render loop stops and the scroll lock is gone. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- knobs ---------- */
const KNOBS = {
  rings: 10, ringsMobile: 7,          // word bands from pupil to limbus (sized like the reference: readable words at 96vh)
  wordH: [0.024, 0.036],              // word height, in iris radii
  pupil: 0.30,                        // pupil radius / iris radius
  drift: 0.0055,                      // inward flow of the words (iris spans per second)
  spin: 0.035,                        // ring rotation (rad/s), alternating direction
  sparks: 220, sparksMobile: 110, streaks: 520,
  saccade: { range: 0.12, move: [120, 180], hold: [600, 2200] },
  blink: { gap: [2500, 6000], double: 0.15 },
  zoomPerPx: 1 / 1400,                // wheel pixels to progress
  bloom: { strength: 0.5, radius: 0.5, threshold: 0.6 },
  fov: 35, camZ: 10, dprMax: 1.75,
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
    text = new THREE.Color(tok('--text', '#e9ebf5')), muted = new THREE.Color(tok('--muted', '#9097b3'));
  const deep = (c, desat, dark) => { const h = {}; c.getHSL(h); return new THREE.Color().setHSL(h.h, h.s * (1 - desat), h.l * (1 - dark)); };
  return {
    bg: bg.clone().lerp(violet, 0.02),          // near-black, tinted with the site's main hue
    bgDeep: bg.clone().lerp(violet, 0.11),        // the vignette's centre lift
    ringIn: deep(cyan, 0.15, 0.30),               // inner rings
    ringOut: deep(violet, 0.15, 0.28),            // outer rings
    hot: text.clone(),                            // the few white words that flicker
    accent: pink.clone(),                         // ember: rim, pulsing words, sparks
    accentDeep: deep(pink, 0.15, 0.35),
    wallText: muted.clone(),
    css: { bg: '#' + bg.clone().lerp(violet, 0.035).getHexString(), text: tok('--text', '#e9ebf5'), accent: tok('--pink', '#ff4d8d') },
  };
}

/* ---------- words ---------- */
const IRIS_WORDS = ['firewall', 'exploit', 'payload', 'zero-day', 'phishing', 'malware', 'ransomware', 'rootkit', 'backdoor', 'botnet', 'CVE', 'XSS', 'SQLi', 'RCE', 'CSRF', 'SSRF', 'MITM', 'DDoS', 'brute-force', 'honeypot', 'sandbox', 'SIEM', 'SOC', 'IDS', 'IPS', 'EDR', 'threat-intel', 'OSINT', 'recon', 'nmap', 'wireshark', 'burp', 'metasploit', 'kali', 'shell', 'root', 'sudo', 'hash', 'SHA-256', 'AES', 'RSA', 'TLS', 'VPN', 'encrypt', 'decrypt', 'keylogger', 'trojan', 'worm', 'spoofing', 'packet', 'port 443', 'port 22', 'CTF', 'pentest', 'red team', 'blue team', 'forensics', 'incident', 'breach', 'patch', 'vuln', 'auth', '2FA', 'token', 'cipher', 'access denied', 'ACCESS GRANTED', '0x7F', '/etc/shadow', 'chmod 777', 'triage', 'yara', 'sigma', 'IOC', 'TTP', 'MFA', 'DNS', 'ARP', 'pcap', 'syslog', 'beacon', 'C2'];
const ACCENT_WORDS = ['BREACH', 'ZERO-DAY', 'ACCESS GRANTED', 'ROOT', 'ALERT', 'CVE-2026-4471', 'THREAT DETECTED'];
const FONTS = ['500 44px "IBM Plex Mono"', '400 44px "IBM Plex Mono"', '600 46px "Space Grotesk"'];

let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = a => a[Math.floor(rnd() * a.length)];
const range = (a, b) => a + (b - a) * rnd();

// one atlas for every word: white glyphs, coloured in the shader
function buildAtlas() {
  const W = 2048, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const rowH = 60, pad = 10, entries = [];
  let x = pad, y = pad;
  const put = (word, font, accent) => {
    g.font = font; const w = Math.ceil(g.measureText(word).width);
    if (x + w + pad > W) { x = pad; y += rowH; }
    if (y + rowH > H) return;
    g.fillText(word, x, y + rowH / 2);
    entries.push({ u0: (x - 2) / W, v0: 1 - (y + rowH) / H, u1: (x + w + 2) / W, v1: 1 - y / H, aspect: (w + 4) / rowH, accent });
    x += w + pad * 2;
  };
  for (const f of FONTS) for (const w of IRIS_WORDS) put(w, f, 0);
  for (const w of ACCENT_WORDS) put(w, FONTS[0], 1);
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace;
  return { tex, normal: entries.filter(e => !e.accent), accent: entries.filter(e => e.accent) };
}

// the live threat feed behind the eye. Sample values only: private IP ranges, made-up hosts.
function buildWall() {
  const S = 2048, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'); g.textBaseline = 'middle';
  const ip = () => pick([`192.168.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 254) + 1}`, `10.0.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 254) + 1}`, `172.16.${Math.floor(rnd() * 31)}.${Math.floor(rnd() * 254) + 1}`]);
  const port = () => pick([22, 80, 443, 445, 3389, 4444, 8080, 8443, 53, 3306]);
  const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const T = [
    () => ['[ALERT]', ` brute-force attempt blocked ${ip()}`],
    () => ['', `nmap -sV -p- target${Math.floor(rnd() * 9)}.local`],
    () => ['[+]', ' payload delivered to sandbox'],
    () => ['', `SHA256: ${hex(7)}...${hex(4)}`],
    () => ['', `GET /admin HTTP/1.1 ${pick([403, 401, 404])}`],
    () => ['[SOC]', ` incident #${4000 + Math.floor(rnd() * 900)} escalated`],
    () => ['', `firewall: DROP tcp ${ip()}:${port()}`],
    () => ['', '$ sudo tcpdump -i eth0 -w capture.pcap'],
    () => ['[WARN]', ` ${Math.floor(rnd() * 90) + 10} failed logins from ${ip()}`],
    () => ['', `ssh: accepted publickey for analyst from ${ip()}`],
    () => ['[IDS]', ` signature match ET-${Math.floor(rnd() * 9e6)} on :${port()}`],
    () => ['', `CVE-2026-${1000 + Math.floor(rnd() * 8999)} patched on host-${hex(3)}`],
    () => ['THREAT DETECTED', ` beacon to ${ip()} every 60s`],
    () => ['', `yara: rule Trojan_${hex(4)} matched in /tmp/${hex(6)}`],
    () => ['', `[*] scanning ${ip()}/24 ... ${Math.floor(rnd() * 40)} hosts up`],
    () => ['', `dns: query ${hex(10)}.example.test NXDOMAIN`],
    () => ['[EDR]', ` process quarantined pid ${1000 + Math.floor(rnd() * 9000)}`],
    () => ['', `TLS1.3 handshake ok ${ip()}:${port()}`],
  ];
  const rows = 64, lh = S / rows;
  g.font = '400 21px "IBM Plex Mono"';
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 300;
    while (x < S) {
      const [pre, rest] = pick(T)();
      if (pre) { g.fillStyle = '#ff0000'; g.fillText(pre, x, (r + 0.5) * lh); x += g.measureText(pre).width; }   // red channel only: the accent
      g.fillStyle = '#ffffff'; g.fillText(rest, x, (r + 0.5) * lh); x += g.measureText(rest).width + 46;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/* ---------- shaders ---------- */
const NOISE = /* glsl */`
float h11(float n){return fract(sin(n)*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float n=i.x+i.y*57.;
  return mix(mix(h11(n),h11(n+1.),f.x),mix(h11(n+57.),h11(n+58.),f.x),f.y);}`;

const irisVert = /* glsl */`
attribute vec4 aUV; attribute vec4 aP; attribute vec4 aQ;
uniform float uSpin, uDrift, uStreak, uSquash, uR0, uTime;
varying vec2 vUv; varying float vRn, vRing, vRand, vAcc, vR;
void main(){
  float span=1.-uR0, rn=fract(aP.x-uDrift);
  float r=uR0+rn*span;
  float ang=aP.y+aQ.w*uSpin*(.55+.9*aQ.y);
  vec2 dR=vec2(cos(ang),sin(ang)), dT=vec2(-dR.y,dR.x);
  float len=aP.z*(1.+uStreak*(5.+aQ.y*9.));
  vec2 p=dR*(r+uStreak*aQ.y*.8+position.x*len)+dT*(position.y*aP.w);
  p.y*=uSquash;
  vUv=mix(aUV.xy,aUV.zw,position.xy+.5);
  vRn=rn; vRing=aQ.x; vRand=aQ.y; vAcc=aQ.z; vR=r;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,0.,1.);
}`;
const irisFrag = /* glsl */`
uniform sampler2D uAtlas; uniform vec3 uIn, uOut, uHot, uAcc; uniform float uTime, uGlow, uR0;
varying vec2 vUv; varying float vRn, vRing, vRand, vAcc, vR;
${NOISE}
void main(){
  float a=texture2D(uAtlas,vUv).a;
  float fade=smoothstep(0.,.07,vRn)*(1.-smoothstep(.84,1.,vRn));
  a*=fade; if(a<.01) discard;
  float t=clamp(vRing+(vnoise(vec2(vRand*40.,uTime*.15))-.5)*.35,0.,1.);
  vec3 col=mix(uIn,uOut,t)*mix(1.35,.62,vRn);
  float nz=sqrt(max(0.,1.-vR*vR*.92));                 // the iris as a shallow dome: fresnel at the limbus
  col+=uAcc*pow(1.-nz,3.)*.35;
  float hot=step(.97,fract(vRand*13.7+uTime*.1));       // ~3% hot white words that flicker
  col=mix(col,uHot*1.5,hot*(.7+.3*sin(uTime*23.+vRand*50.)));
  float pulse=.55+.45*sin(uTime*2.1+vRand*6.283);
  col=mix(col,uAcc*(.8+.75*pulse),vAcc);               // the accent words burn like the globe's red words
  col*=uGlow;
  gl_FragColor=vec4(col,a);
}`;

const quadVert = /* glsl */`varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const pupilFrag = /* glsl */`
uniform vec3 uBg; uniform float uR0; varying vec2 vP;
void main(){float r=length(vP); float a=1.-smoothstep(uR0*.84,uR0*1.12,r); gl_FragColor=vec4(vec3(0.),a);}`;
const rimFrag = /* glsl */`
uniform vec3 uAcc, uDeep; uniform float uTime, uR0, uGlow; varying vec2 vP;
void main(){
  float r=length(vP), ang=atan(vP.y,vP.x);
  float burn=.7+.3*sin(ang*7.+uTime*1.3)*sin(ang*3.-uTime*.7);
  float d=r-1.;
  float lim=exp(-d*d/(d<0.?.0011:.00018))*.48+exp(-d*d/(d<0.?.02:.002))*.1;   // strongest at the rim, fading inward
  float dp=r-uR0;
  float pr=exp(-dp*dp/.00006)*.42+exp(-dp*dp/.0012)*.07;
  vec3 col=(uAcc*lim*burn+uAcc*pr*(.8+.2*burn))*uGlow;
  col+=uDeep*exp(-d*d/.05)*.035;
  gl_FragColor=vec4(col,1.);
}`;

const sparkVert = /* glsl */`
attribute vec4 aS; attribute vec4 aUV;
uniform float uTime; varying float vA; varying vec2 vUv, vQ; varying float vWord;
void main(){
  float life=fract(uTime/aS.z+aS.w*7.31);
  float ang=aS.x+life*.25;
  vec2 dR=vec2(cos(ang),sin(ang));
  vec2 vel=dR*aS.y+vec2(.35,.04);                       // a soft wind to the right, like the sparks off the globe
  vec2 p=dR*(1.+.015*sin(aS.w*40.))+vel*life*1.1;
  vec2 dir=normalize(vel), nrm=vec2(-dir.y,dir.x);
  float word=step(.8,fract(aS.w*91.7));
  float L=word>.5?.05:.012+.09*aS.y, Wd=word>.5?.012:.0035;
  p+=dir*position.x*L+nrm*position.y*Wd;
  vA=sin(3.1416*life)*(1.-life*.6); vUv=mix(aUV.xy,aUV.zw,position.xy+.5); vQ=position.xy; vWord=word;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,.004,1.);
}`;
const sparkFrag = /* glsl */`
uniform sampler2D uAtlas; uniform vec3 uAcc; uniform float uGlow; varying float vA, vWord; varying vec2 vUv, vQ;
void main(){
  float m=vWord>.5?texture2D(uAtlas,vUv).a:(1.-smoothstep(.0,.5,abs(vQ.y)*2.))*smoothstep(.5,-.3,vQ.x);
  gl_FragColor=vec4(uAcc*1.25*uGlow*m*vA*vA,1.);
}`;

const wallVert = /* glsl */`varying vec2 vW; void main(){vec4 w=modelMatrix*vec4(position,1.); vW=w.xy; gl_Position=projectionMatrix*viewMatrix*w;}`;
const wallFrag = /* glsl */`
uniform sampler2D uWall; uniform vec3 uText, uAcc, uBg; uniform float uScale, uTime, uOpacity; varying vec2 vW;
void main(){
  vec2 uv=vW/uScale+vec2(0.,uTime*.006);
  vec3 t=texture2D(uWall,uv).rgb;
  float acc=clamp(t.r-t.g,0.,1.), txt=t.g;
  float flick=.85+.15*sin(uTime*1.7+floor(uv.y*64.)*3.1);
  vec3 col=uBg+(uText*txt+uAcc*acc*.55)*uOpacity*flick;
  gl_FragColor=vec4(col,1.);
}`;

const lidFrag = /* glsl */`
uniform sampler2D uWall; uniform vec3 uText, uAcc, uBg; uniform float uBlink, uScale, uTime, uOpacity, uYu, uYl; varying vec2 vP;
void main(){
  float c=.36, x2=vP.x*vP.x;
  float eu=uYu-c*x2, el=uYl+c*x2;                       // almond lid edges: the upper arches, the lower cups
  float up=step(eu,vP.y), lo=step(vP.y,el);
  float m=max(up,lo); float vis=smoothstep(0.,.05,uBlink);
  vec2 uv=vP*1.6/uScale+vec2(0.,(up>.5?uYu:uYl)*.12+uTime*.006);   // the lid's text slides with the lid
  vec3 t=texture2D(uWall,uv).rgb;
  vec3 col=uBg+uText*t.g*uOpacity;
  float rim=exp(-pow((vP.y-eu)/.012,2.))+exp(-pow((vP.y-el)/.012,2.));
  vec3 rc=uAcc*rim*1.1*vis;
  gl_FragColor=vec4(col*m+rc*(1.-m*.6),max(m,clamp(rim,0.,1.))*vis);
}`;

const streakVert = /* glsl */`
attribute vec4 aS; attribute vec4 aUV; uniform float uTime, uAspect, uAmt;
varying vec2 vUv; varying float vA, vC;
void main(){
  float t=fract(uTime*aS.z+aS.w);
  float rho=mix(aS.y,1.9,t*t);
  vec2 d=vec2(cos(aS.x),sin(aS.x)), n=vec2(-d.y,d.x);
  float L=(.03+.75*t*t)*(.4+uAmt), Wd=.004+.018*t;
  vec2 p=d*(rho+position.x*L)+n*position.y*Wd;
  p.x/=uAspect;
  vUv=mix(aUV.xy,aUV.zw,position.xy+.5); vA=uAmt*t*(1.-t)*4.; vC=fract(aS.w*17.);
  gl_Position=vec4(p,0.,1.);
}`;
const streakFrag = /* glsl */`
uniform sampler2D uAtlas; uniform vec3 uIn, uOut, uAcc; varying vec2 vUv; varying float vA, vC;
void main(){float a=texture2D(uAtlas,vUv).a*vA; vec3 c=vC>.92?uAcc*1.4:mix(uIn,uOut,vC)*1.6; gl_FragColor=vec4(c*a,1.);}`;

const finalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNoise: { value: 0.03 }, uLift: { value: new THREE.Color() }, uLiftAmt: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uTime, uNoise, uLiftAmt; uniform vec3 uLift; varying vec2 vUv;
void main(){
  vec4 c=texture2D(tDiffuse,vUv);
  float d=distance(vUv,vec2(.5));
  c.rgb+=uLift*smoothstep(.75,.45,d)*smoothstep(.2,.45,d)*.3*uLiftAmt;   // a navy halo around the eye, never over the pupil
  c.rgb*=mix(.5,1.,smoothstep(.9,.3,d));
  float n=fract(sin(dot(vUv*vec2(1920.,1080.)+fract(uTime)*97.,vec2(12.9898,78.233)))*43758.5453);
  c.rgb+=(n-.5)*uNoise;
  gl_FragColor=c;
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
  // the atlas needs the site's fonts; never wait more than 1.5 s for them
  await Promise.race([Promise.all(FONTS.concat('400 21px "IBM Plex Mono"').map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1500))]).catch(() => {});

  const pal = makePalette();
  const mobile = innerWidth < 760 || touchFirst;

  /* DOM */
  const el = document.createElement('div');
  el.id = 'eye-intro';
  el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Intro');
  el.style.setProperty('--ei-bg', pal.css.bg); el.style.setProperty('--ei-text', pal.css.text); el.style.setProperty('--ei-accent', pal.css.accent);
  el.innerHTML = '<div class="ei-stage"><div class="ei-ring"></div></div><div class="ei-hint" aria-hidden="true"><span class="ei-line"></span><span class="ei-text"></span></div><button type="button" class="ei-skip">Skip intro</button>';
  const stage = el.querySelector('.ei-stage'), hint = el.querySelector('.ei-hint'), hintText = el.querySelector('.ei-hint .ei-text'), skip = el.querySelector('.ei-skip');
  const toast = document.createElement('div');
  toast.id = 'eye-intro-toast'; toast.setAttribute('aria-hidden', 'true');
  toast.style.setProperty('--ei-text', pal.css.text); toast.style.setProperty('--ei-accent', pal.css.accent);
  toast.innerHTML = '<span class="ei-line"></span><span class="ei-text">Scroll up to zoom out</span>';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { return fail(); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, KNOBS.dprMax));
  renderer.setClearColor(pal.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  document.body.append(el, toast);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(KNOBS.fov, innerWidth / innerHeight, 0.005, 400);
  const eye = new THREE.Group(), lids = new THREE.Group();
  scene.add(eye, lids);

  const atlas = buildAtlas(), wallTex = buildWall();
  const R0 = KNOBS.pupil;

  /* iris: every word in one instanced draw */
  const bands = mobile ? KNOBS.ringsMobile : KNOBS.rings, span = 1 - R0, recs = [];
  for (let b = 0; b < bands; b++) {
    const inner = b / bands, w = span / bands, dir = b % 2 ? 1 : -1;
    for (let a = rnd() * 0.2; a < Math.PI * 2;) {
      const isAcc = rnd() < 0.012, maxLen = w * range(0.62, 0.97);
      let h = range(KNOBS.wordH[0], KNOBS.wordH[1]) * (b < 2 ? 0.8 : 1), e;
      // a word that is too long for its band is swapped for a shorter one, so no word shrinks into an unreadable sliver
      for (let k = 0; k < 6; k++) { e = isAcc ? pick(atlas.accent) : pick(atlas.normal); if (h * e.aspect <= maxLen) break; }
      let len = h * e.aspect;
      if (len > maxLen) { len = maxLen; h = len / e.aspect; }
      const rc = R0 + (inner * span) + (len / 2) + rnd() * Math.max(0, w - len);
      const rn = (rc - R0) / span;
      const da = (h * 1.32) / rc;
      recs.push([e.u0, e.v0, e.u1, e.v1, rn, a + da / 2, len, h, b / (bands - 1), rnd(), isAcc ? 1 : 0, dir]);
      a += da;
    }
  }
  const N = recs.length, aUV = new Float32Array(N * 4), aP = new Float32Array(N * 4), aQ = new Float32Array(N * 4);
  recs.forEach((r, i) => { aUV.set(r.slice(0, 4), i * 4); aP.set(r.slice(4, 8), i * 4); aQ.set(r.slice(8, 12), i * 4); });
  const irisU = {
    uAtlas: { value: atlas.tex }, uIn: { value: pal.ringIn }, uOut: { value: pal.ringOut }, uHot: { value: pal.hot }, uAcc: { value: pal.accent },
    uTime: { value: 0 }, uSpin: { value: 0 }, uDrift: { value: 0 }, uStreak: { value: 0 }, uSquash: { value: 1 }, uGlow: { value: 1 }, uR0: { value: R0 },
  };
  const iris = new THREE.Mesh(instanced(N, { aUV, aP, aQ }), new THREE.ShaderMaterial({ uniforms: irisU, vertexShader: irisVert, fragmentShader: irisFrag, transparent: true, depthWrite: false, depthTest: false }));
  iris.frustumCulled = false; iris.renderOrder = 1; eye.add(iris);

  const pupil = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.ShaderMaterial({ uniforms: { uBg: { value: pal.bg }, uR0: { value: R0 } }, vertexShader: quadVert, fragmentShader: pupilFrag, transparent: true, depthWrite: false, depthTest: false }));
  pupil.position.z = 0.002; pupil.renderOrder = 2; eye.add(pupil);

  const rimU = { uAcc: { value: pal.accent }, uDeep: { value: pal.accentDeep }, uTime: { value: 0 }, uR0: { value: R0 }, uGlow: { value: 1 } };
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.ShaderMaterial({ uniforms: rimU, vertexShader: quadVert, fragmentShader: rimFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  rim.position.z = 0.003; rim.renderOrder = 3; eye.add(rim);

  /* sparks: dust and word fragments shed off the limbus (stateless: all motion is in the shader) */
  const NS = mobile ? KNOBS.sparksMobile : KNOBS.sparks, sS = new Float32Array(NS * 4), sUV = new Float32Array(NS * 4);
  for (let i = 0; i < NS; i++) {
    // biased toward the right side, like the trail off the globe
    const a = rnd() < 0.6 ? range(-1.1, 1.1) : rnd() * Math.PI * 2;
    sS.set([a, range(0.08, 0.5), range(1.6, 3.4), rnd()], i * 4);
    const e = pick(atlas.normal), cut = range(0.25, 0.55);
    sUV.set([e.u0, e.v0, lerp(e.u0, e.u1, cut), e.v1], i * 4);
  }
  const sparkU = { uAtlas: { value: atlas.tex }, uAcc: { value: pal.accent }, uTime: { value: 0 }, uGlow: { value: 1 } };
  const sparks = new THREE.Mesh(instanced(NS, { aS: sS, aUV: sUV }), new THREE.ShaderMaterial({ uniforms: sparkU, vertexShader: sparkVert, fragmentShader: sparkFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  sparks.frustumCulled = false; sparks.renderOrder = 4; eye.add(sparks);

  /* the log wall: tilted like a screen, always covering the whole view */
  const wallU = { uWall: { value: wallTex }, uText: { value: pal.wallText }, uAcc: { value: pal.accent }, uBg: { value: pal.bg }, uScale: { value: 1 }, uTime: { value: 0 }, uOpacity: { value: 0.16 } };
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: wallU, vertexShader: wallVert, fragmentShader: wallFrag, depthWrite: false, depthTest: false }));
  wall.rotation.set(-0.16, 0.2, 0.02); wall.renderOrder = 0; scene.add(wall);

  /* eyelids, made of the same wall text, with an ember edge */
  const lidU = { uWall: { value: wallTex }, uText: { value: pal.wallText }, uAcc: { value: pal.accent }, uBg: { value: pal.bg }, uBlink: { value: 0 }, uScale: { value: 2.7 }, uTime: { value: 0 }, uOpacity: { value: 0.2 }, uYu: { value: 1.45 }, uYl: { value: -1.08 } };
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), new THREE.ShaderMaterial({ uniforms: lidU, vertexShader: quadVert, fragmentShader: lidFrag, transparent: true, depthWrite: false, depthTest: false }));
  lid.position.z = 0.02; lid.renderOrder = 5; lids.add(lid);

  /* the dive: words streaking radially past the camera (screen space) */
  const NK = mobile ? KNOBS.streaks / 2 : KNOBS.streaks, kS = new Float32Array(NK * 4), kUV = new Float32Array(NK * 4);
  for (let i = 0; i < NK; i++) { kS.set([rnd() * Math.PI * 2, range(0.02, 0.5), range(0.5, 1.3), rnd()], i * 4); const e = pick(atlas.normal); kUV.set([e.u0, e.v0, e.u1, e.v1], i * 4); }
  const streakU = { uAtlas: { value: atlas.tex }, uIn: { value: pal.ringIn }, uOut: { value: pal.ringOut }, uAcc: { value: pal.accent }, uTime: { value: 0 }, uAspect: { value: 1 }, uAmt: { value: 0 } };
  const streaks = new THREE.Mesh(instanced(NK, { aS: kS, aUV: kUV }), new THREE.ShaderMaterial({ uniforms: streakU, vertexShader: streakVert, fragmentShader: streakFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  streaks.frustumCulled = false; streaks.renderOrder = 6; streaks.visible = false; scene.add(streaks);

  /* post: bloom only catches what is bright (rim, accent words, sparks); text stays crisp */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), KNOBS.bloom.strength, KNOBS.bloom.radius, KNOBS.bloom.threshold);
  composer.addPass(bloom);
  const fin = new ShaderPass(finalShader); fin.uniforms.uLift.value.copy(pal.bgDeep).sub(pal.bg);
  composer.addPass(fin);
  composer.addPass(new OutputPass());

  /* fit: iris diameter = 96% of the height (92% of the width in portrait), computed in world units */
  let R = 1, aspect = 1, Z0 = KNOBS.camZ, zEnd = 0.2;
  const tanH = () => Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  function fit() {
    const w = innerWidth, h = innerHeight; aspect = w / h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    cam.aspect = aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(KNOBS.fov / 2)), visH = 2 * Z0 * t, visW = visH * aspect;
    R = aspect < 1 ? 0.46 * visW : 0.48 * visH;
    eye.scale.setScalar(R); lids.scale.setScalar(R);
    // the closest point of the dolly: the pupil covers the corners of the screen
    zEnd = (0.82 * R0 * R) / (Math.tan(THREE.MathUtils.degToRad(30 / 2)) * Math.hypot(1, aspect));
    // the wall covers the widest framing (progress -0.15 plus saccades and tilt), scaled with max(w, h)
    const wz = 0.55 * R, dist = Z0 / 0.85 + wz, wh = 2 * dist * t * 1.35;
    wall.position.z = -wz; wall.scale.set(wh * Math.max(aspect, 1), wh * Math.max(1 / aspect, 1), 1);
    wallU.uScale.value = 2.7 * R; lidU.uScale.value = 2.7;
    streakU.uAspect.value = aspect;
  }
  fit();
  let fitQueued = false;
  const onResize = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };
  addEventListener('resize', onResize);

  /* ---------- state ---------- */
  let active = true, progress = 0, target = 0, lastInput = 0, lastDir = 1, skipping = false, running = false, raf = 0, last = performance.now(), time = 0;
  let spinPhase = 0, driftPhase = 0;
  const mouse = new THREE.Vector2();
  // saccades
  const sac = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 150, holdUntil: 0 };
  // blinks
  const blink = { v: 0, phase: 'open', t0: 0, close: 80, hold: 40, open: 150, next: performance.now() + range(1500, 3500), double: false };

  function planSaccade(now) {
    const rg = KNOBS.saccade.range;
    sac.fx = sac.x; sac.fy = sac.y;
    if (!touchFirst && rnd() < 0.3 && (mouse.x || mouse.y)) { sac.tx = mouse.x * rg * 0.9; sac.ty = mouse.y * rg * 0.5; }   // a glance toward the cursor
    else { sac.tx = range(-rg, rg); sac.ty = range(-rg, rg) * 0.35; }
    sac.t0 = now; sac.dur = range(...KNOBS.saccade.move);
    sac.holdUntil = now + sac.dur + range(...KNOBS.saccade.hold);
    if (Math.hypot(sac.tx - sac.fx, sac.ty - sac.fy) > rg * 1.1 && rnd() < 0.35) blink.next = Math.min(blink.next, now + sac.dur + 40);   // big saccades often bring a blink
  }
  function startBlink(now) {
    blink.phase = 'closing'; blink.t0 = now;
    blink.close = reduced ? 320 : range(70, 90); blink.hold = reduced ? 80 : range(30, 50); blink.open = reduced ? 520 : range(120, 180);
  }
  function updateBlink(now, allowed) {
    if (blink.phase === 'open') {
      blink.v = 0;
      if (allowed && now >= blink.next) startBlink(now);
      return;
    }
    const e = now - blink.t0;
    if (blink.phase === 'closing') { blink.v = easeIn(clamp(e / blink.close, 0, 1)); if (e >= blink.close) { blink.phase = 'closed'; blink.t0 = now; } }
    else if (blink.phase === 'closed') { blink.v = 1; if (e >= blink.hold) { blink.phase = 'opening'; blink.t0 = now; } }
    else if (blink.phase === 'opening') {
      blink.v = 1 - easeOut(clamp(e / blink.open, 0, 1));
      if (e >= blink.open) {
        blink.phase = 'open'; blink.v = 0;
        if (!blink.double && rnd() < KNOBS.blink.double && !reduced) { blink.double = true; blink.next = now + range(90, 160); }
        else { blink.double = false; blink.next = now + (reduced ? range(6000, 9000) : range(...KNOBS.blink.gap)); }
      }
    }
  }

  /* ---------- frame ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;

    // the lens springs back from a pull-out; a stop inside the black always finishes the dive
    const idle = now - lastInput;
    if (target < 0 && idle > 160) target += (0 - target) * (1 - Math.exp(-dt * 5));
    if (lastDir > 0 && target > 0.86 && target < 1 && idle > 320) target = 1;   // only when heading in, never while pulling out
    if (skipping) progress = Math.min(1, Math.max(progress, 0.88) + dt * 0.3);   // skip: a short, steady exit
    else progress += (target - progress) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - progress) < 0.0004) progress = target;
    const p = progress;

    // camera
    let camZ = Z0, fov = KNOBS.fov, streak = 0, zoomE = 0;
    if (reduced) camZ = p < 0 ? Z0 / (1 + p) : Z0;
    else if (p < 0) camZ = Z0 / (1 + p);
    else if (p <= 0.7) { zoomE = easeIO(p / 0.7); camZ = Z0 * Math.pow(zEnd / Z0, zoomE); fov = lerp(KNOBS.fov, 30, zoomE); }
    else { zoomE = 1; camZ = zEnd * Math.pow(0.35, smooth(0.7, 0.9, p)); fov = 30; }
    if (!reduced) streak = smooth(0.66, 0.76, p) * (1 - smooth(0.87, 0.94, p));
    if (cam.fov !== fov) { cam.fov = fov; }
    cam.position.set(0, 0, camZ); cam.updateProjectionMatrix();

    // saccades + parallax (off once the dive starts: the pupil stays centred)
    const sacOn = !reduced && p <= 0.15 && p >= -0.15;
    if (sacOn) {
      if (now >= sac.holdUntil) planSaccade(now);
      const k = easeOut(clamp((now - sac.t0) / sac.dur, 0, 1));
      sac.x = lerp(sac.fx, sac.tx, k); sac.y = lerp(sac.fy, sac.ty, k);
    } else { sac.x *= 0.85; sac.y *= 0.85; }
    const fade = sacOn ? 1 - smooth(0.05, 0.15, p) : 0;
    const jit = sacOn && now > sac.t0 + sac.dur ? 0.0035 : 0;
    const ox = (sac.x + (Math.sin(time * 37.1) * Math.sin(time * 13.3)) * jit + mouse.x * 0.03) * fade;
    const oy = (sac.y + (Math.sin(time * 29.7) * Math.sin(time * 17.9)) * jit + mouse.y * 0.03) * fade;
    eye.position.set(ox * R, oy * R, 0);

    // blinks: never during the dive
    updateBlink(now, p <= 0.0001 && p >= -0.15);
    if (p > 0.1) { blink.phase = 'open'; blink.v = 0; }
    const bv = blink.v;
    const meet = -0.32;
    lidU.uBlink.value = bv;
    lidU.uYu.value = lerp(1.45, meet, bv); lidU.uYl.value = lerp(-1.08, meet, bv);

    // iris
    spinPhase += dt * KNOBS.spin * (reduced ? 0.4 : 1 + 7 * zoomE);
    driftPhase += dt * KNOBS.drift * (reduced ? 0.3 : 1 + 2 * zoomE);
    irisU.uSpin.value = spinPhase; irisU.uDrift.value = driftPhase; irisU.uTime.value = time;
    irisU.uStreak.value = streak; irisU.uSquash.value = lerp(1, 0.97, bv);
    const glow = (1 - 0.35 * bv) * (1 + 0.5 * zoomE);
    irisU.uGlow.value = 1 - 0.35 * bv; rimU.uGlow.value = glow; sparkU.uGlow.value = glow;
    rimU.uTime.value = time; sparkU.uTime.value = time; wallU.uTime.value = time; lidU.uTime.value = time;
    streakU.uTime.value = time; streakU.uAmt.value = streak; streaks.visible = streak > 0.002;
    sparks.visible = !reduced;
    bloom.strength = KNOBS.bloom.strength * (1 + 0.6 * zoomE);
    fin.uniforms.uTime.value = time; fin.uniforms.uLiftAmt.value = 1 - zoomE;

    // DOM: hint, skip, the hole that opens on the portfolio
    hintText.textContent = p < -0.01 ? (touchFirst ? 'Swipe to enter' : 'Scroll to enter') : (touchFirst ? 'Swipe up to zoom in' : 'Scroll to zoom in');
    hint.style.opacity = String(1 - smooth(0.05, 0.2, p));
    skip.style.opacity = String(1 - smooth(0.8, 0.92, p));
    root.classList.toggle('eye-intro-hide', p < 0.86);
    if (reduced) {
      stage.style.opacity = String(1 - smooth(0.15, 1, p));
    } else {
      const open = smooth(0.9, 1, p);
      el.classList.toggle('ei-open', p > 0.9);
      el.style.setProperty('--ei-hole', (easeOut(open) * Math.hypot(innerWidth, innerHeight) * 0.56 - 30).toFixed(1) + 'px');
      el.style.setProperty('--ei-ring', String(open > 0 ? Math.sin(Math.PI * open) * 0.9 : 0));
      stage.style.opacity = String(1 - smooth(0.96, 1, p));
    }

    composer.render(dt);

    if (target >= 1 && p >= 0.997) reveal();
  }

  function play() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); }

  /* ---------- input while the intro is on screen ---------- */
  const norm = e => e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  const bump = d => { target = clamp(target + d, -0.15, 1); lastInput = performance.now(); if (d) lastDir = Math.sign(d); };
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
    active = true; progress = target = 1; lastInput = performance.now();
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

  // the GPU context can be lost on phones: fall back to the site
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); lock(false); root.classList.remove('eye-intro-hide'); el.hidden = true; active = false; }, { once: true });

  lock(true);
  play();
  document.dispatchEvent(new Event('eye-intro:ready'));
}

start().catch(err => { console.error('[eye-intro]', err); fail(); });
