/* EYE INTRO particles: GPU only. Every motion lives in the vertex shader and is driven by the scroll progress,
   so scrolling back plays it in reverse; a tiny time term keeps space from ever feeling frozen.
   - suction: white dots leave the inner rings and spiral into the pupil (r = r0 * (1 - easeIn(t)), theta = a0 + spin / max(r, 0.05))
   - starfield: the void between the pupil and the black hole; dots recycled along z, curving gently toward the centre,
     with the black hole (a black core and a 1-2 px white ring) growing at the centre of the screen */

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// a crisp white disc with a one-pixel soft edge
const DOT_FRAG = /* glsl */`
uniform vec3 uColor; varying float vA, vSize;
void main(){
  float r=length(gl_PointCoord-.5)*vSize;
  float a=(1.-smoothstep(vSize*.5-1.,vSize*.5,r))*vA;
  if(a<.01) discard;
  gl_FragColor=vec4(uColor*a,a);
}`;

export function makeSuction(THREE, { count, dpr, color }) {
  const d = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) d.set([0.04 + Math.pow(Math.random(), 0.8) * 0.72, Math.random() * Math.PI * 2, 0.03 + Math.random() * 0.08, Math.random()], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aD', new THREE.BufferAttribute(d, 4));
  const u = { uPhase: { value: 0 }, uTime: { value: 0 }, uDpr: { value: dpr }, uColor: { value: color } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: true,
    vertexShader: /* glsl */`
attribute vec4 aD; uniform float uPhase, uTime, uDpr; varying float vA, vSize;
void main(){
  float t=clamp((uPhase*1.35-aD.w*.9)/.45,0.,1.);          // each dot leaves at its own moment (a few early, most later)
  float e=t*t*t;                                            // easeIn: slow to start, falling faster as it nears the core
  float r=aD.x*(1.-e);
  float th=aD.y+aD.z/max(r,.05)*e+uTime*.04*(1.-e);         // the spiral tightens as the radius shrinks
  vec2 p=vec2(cos(th),sin(th))*r;
  p+=vec2(sin(uTime*.7+aD.w*40.),cos(uTime*.6+aD.w*31.))*.003*(1.-t);
  vA=smoothstep(0.,.04,t)*smoothstep(.012,.06,r)*(.82+.18*sin(uTime*4.+aD.w*60.));
  vSize=mix(1.4,2.8,fract(aD.w*7.31))*mix(.55,1.,smoothstep(0.,.15,r))*uDpr;
  gl_PointSize=vSize;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,.005,1.);
}`,
    fragmentShader: DOT_FRAG,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  return {
    points,
    update(p, time) { u.uPhase.value = smooth(0, 0.3, p); u.uTime.value = time; points.visible = p > 0.002 && p < 0.32; },
  };
}

export function makeStarfield(THREE, { count, dpr, color }) {
  const s = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) s.set([0.6 + Math.pow(Math.random(), 1.6) * 24, Math.random() * Math.PI * 2, Math.random(), Math.random()], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aS', new THREE.BufferAttribute(s, 4));
  const u = { uTravel: { value: 0 }, uSpin: { value: 0 }, uPull: { value: 0 }, uTime: { value: 0 }, uAmt: { value: 0 }, uDpr: { value: dpr }, uColor: { value: color } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: true,
    vertexShader: /* glsl */`
attribute vec4 aS; uniform float uTravel, uSpin, uPull, uTime, uAmt, uDpr; varying float vA, vSize;
const float DEPTH=140.;
void main(){
  float z=fract(aS.z+uTravel/DEPTH);                        // recycled along the path; z -> 1 is next to the camera
  float r=aS.x*mix(1.,.55,uPull);                           // gathered gently toward the centre
  float th=aS.y+uSpin*(1.+3./(1.+aS.x));                    // every path curves around the centre, inner ones faster
  vec4 mv=modelViewMatrix*vec4(cos(th)*r,sin(th)*r,-mix(DEPTH,.6,z),1.);
  vSize=clamp(34./-mv.z,1.,3.)*(.8+.4*fract(aS.w*9.1))*uDpr;   // near dots bigger, far ones tiny: parallax
  vA=smoothstep(0.,.18,z)*(1.-smoothstep(.93,1.,z))*(.75+.25*sin(uTime*3.+aS.w*50.))*uAmt;
  gl_PointSize=vSize;
  gl_Position=projectionMatrix*mv;
}`,
    fragmentShader: DOT_FRAG,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false; points.renderOrder = 1;

  // the black hole, drawn in screen space so it sits dead centre: a black core and a thin white ring that flashes once
  const hu = { uRad: { value: 0.04 }, uAspect: { value: 1 }, uFlash: { value: 0 }, uColor: { value: color } };
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: hu, transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: true,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: /* glsl */`
uniform float uRad, uAspect, uFlash; uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 q=(vUv-.5)*2.*vec2(uAspect,1.); float r=length(q), px=fwidth(r);
  float core=1.-smoothstep(uRad-px,uRad,r);
  float ring=1.-smoothstep(px*.5,px*(1.6+uFlash*2.),abs(r-uRad-px*.5));
  float a=max(core,ring);
  gl_FragColor=vec4(uColor*ring,a);
}`,
  }));
  hole.frustumCulled = false; hole.renderOrder = 2;

  return {
    points, hole,
    resize(aspect) { hu.uAspect.value = aspect; },
    update(p, time) {
      const v = smooth(0.22, 0.86, p), inside = smooth(0.86, 0.92, p);
      u.uTravel.value = smooth(0.22, 0.92, p) * 340 + time * 0.8;   // the camera floats forward the whole way; a slow drift when idle
      u.uSpin.value = v * 1.4 + inside * 0.6 + time * 0.012;
      u.uPull.value = v;
      u.uTime.value = time;
      // the void, the last dots falling in, then a few dots drifting past inside the hole
      u.uAmt.value = smooth(0.22, 0.28, p) * (1 - smooth(0.8, 0.86, p)) + 0.25 * smooth(0.86, 0.87, p) * (1 - smooth(0.9, 0.93, p));
      // outside: the hole grows until its core fills the screen; inside: a thin ring at the end of the tunnel opens toward us
      hu.uRad.value = p < 0.86 ? 0.035 + Math.pow(v, 3) * 2.4 : 0.02 + inside * inside * 2.4;
      hu.uFlash.value = Math.sin(Math.PI * smooth(0.84, 0.88, p));
    },
  };
}
