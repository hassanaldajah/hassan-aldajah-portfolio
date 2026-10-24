/* EYE INTRO ship shot: the portfolio's fleet (capital ship + two escorts) carries the journey from the void into the site.
   0.26-0.86  grey stand-ins of the three ships form out of the dots, fly with them and shrink into the black hole's core
   0.86       the real fleet starts its flight from the bottom-right, escorts alongside (handoff through the hook in index.html)
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
    if (!api && window.__portfolioShip) { api = window.__portfolioShip; api.hold(true); dispatchEvent(new CustomEvent('duck', { detail: true })); }   // keep the fleet in the hangar and the site's sound quiet while the intro plays
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
      c.traverse(o => { o.renderOrder = 3; });   // drawn after the black hole: it never covers them, they shrink into it
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
        const show = !gone && p >= 0.26 && p < 0.86 && p >= maxP - 0.01;   // never shown while scrolling back
        const v = smooth(0.26, 0.86, p);
        const born = 0.02 + 0.98 * (1 - Math.pow(1 - smooth(0.26, 0.38, p), 3));   // specks among the dots that become ships
        const pull = smooth(0.58, 0.86, p), shrink = 1 - 0.98 * pull * pull;      // power2.in: the hole squeezes them to dots
        const stretch = 1 + 2 * smooth(0.8, 0.86, p);
        const fade = smooth(0.26, 0.34, p) * (1 - smooth(0.82, 0.86, p));         // gone exactly as they reach the core
        clones.forEach((c, i) => {
          c.visible = show;
          if (!show) return;
          const z = -22 * Math.pow(90 / 22, v);                                   // away from us, into the hole
          const spread = 0.3 + 0.7 * Math.sqrt(shrink);                           // they converge on the centre, but never faster than they shrink
          c.position.set(SPREAD[i] * spread, (-2.2 + (i ? 0.6 : 0)) * (1 - pull), z);
          c.rotation.set(0.04, Math.PI, Math.sin(time * 0.8 + i * 1.7) * 0.04);
          const s = base[i] * born * shrink;
          c.scale.set(s, s, s * stretch);
        });
        mats.forEach(m => { m.opacity = fade; });
      }
      if (!handed && p >= 0.86 && api.ready()) {   // the fleet goes into the hole: its engines are heard as the real ships fly us out
        dispatchEvent(new CustomEvent('duck', { detail: false }));
        handed = api.startFlight(0, HANDOFF_FORMATION);
      }
    },
    release() { if (api) { api.hold(false); dispatchEvent(new CustomEvent('duck', { detail: false })); } },
  };
}
