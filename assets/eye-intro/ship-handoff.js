/* EYE INTRO ship shot: the portfolio's fleet (capital ship + two escorts) carries the journey from the void into the site.
   0.30-0.86  grey stand-ins of the three ships fly side by side with the dots into the black hole, shrinking to dots
   0.94       the real fleet starts its flight from the bottom-right, escorts alongside (handoff through the hook in index.html)
   Forward only: scrolling back never flies them backward, and once they have gone in they only come back after a reload.
   The stand-ins clone the real ships, so geometry and textures are shared (nothing is downloaded twice). */

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// the spread formation, in the portfolio's screen units (hd = half height at the ship's depth): escorts on either side of
// the route, perpendicular to it, far enough apart that the three never cover each other
const HANDOFF_FORMATION = [{ ox: 0, oy: 0 }, { ox: 0.1, oy: 0.46 }, { ox: -0.1, oy: -0.46 }];
const SPREAD = [0, -11, 11];   // world x in the void: >= 8% of the view between hulls at any depth

export function makeShipShot(THREE, { scene, reduced }) {
  let api = null, clones = null, maxP = 0, gone = false, handed = false;
  const mats = new Map(), base = [];
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(0.4, 0.8, 1);
  const fill = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(key, fill);

  function acquire() {
    if (!api && window.__portfolioShip) { api = window.__portfolioShip; api.hold(true); }   // keep the fleet in the hangar while the intro plays
  }
  function build() {
    if (clones || !api || !api.ready()) return;
    clones = api.fleet().map(g => {
      const c = g.clone();
      c.traverse(o => {
        if (!o.material) return;
        let m = mats.get(o.material);
        if (!m) { m = o.material.clone(); if ('envMap' in m) m.envMap = null; m.transparent = true; mats.set(o.material, m); }   // the reflection map lives in the other GPU context
        o.material = m;
      });
      c.visible = false; scene.add(c); base.push(g.scale.x);
      return c;
    });
  }

  return {
    update(p, time) {
      acquire();
      if (reduced || !api) return;
      if (p >= 0.3) build();
      maxP = Math.max(maxP, p);
      if (p >= 0.86) gone = true;
      if (clones) {
        const show = !gone && p >= 0.3 && p < 0.86 && p >= maxP - 0.01;   // never shown while scrolling back
        const v = smooth(0.3, 0.86, p), stretch = 1 + 2.5 * smooth(0.8, 0.86, p), fade = smooth(0.3, 0.36, p);
        clones.forEach((c, i) => {
          c.visible = show;
          if (!show) return;
          const z = -16 * Math.pow(150 / 16, v);                       // big and close, then away into the hole
          c.position.set(SPREAD[i] * (1 - 0.25 * v), -2.2 * (1 - v) + (i ? 0.6 : 0), z);
          c.rotation.set(0.04, Math.PI, Math.sin(time * 0.8 + i * 1.7) * 0.04);   // nose toward the hole, a gentle bank
          c.scale.set(base[i], base[i], base[i] * stretch);              // pulled long right before the horizon
        });
        mats.forEach(m => { m.opacity = fade; });
      }
      if (!handed && p >= 0.94 && api.ready()) handed = api.startFlight(0, HANDOFF_FORMATION);   // the real fleet flies us out
    },
    release() { if (api) api.hold(false); },
  };
}
