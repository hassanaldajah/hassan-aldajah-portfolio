/* EYE INTRO typing wall: cyber log lines type themselves in, character by character (18-35 ms per char, short pauses
   between words), a blinking block cursor on each active line; several lines type at once, old ones glide up and fade.
   Plain DOM text, so it is razor sharp at any pixel ratio, and it is independent of the eye (the blink never touches it).
   Sample values only: private IPs, made-up hosts. */
const rand = (a, b) => a + (b - a) * Math.random();
const pick = a => a[Math.floor(Math.random() * a.length)];
const int = (a, b) => Math.floor(rand(a, b));
const ip = () => pick([`10.0.${int(0, 255)}.${int(1, 254)}`, `192.168.${int(0, 255)}.${int(1, 254)}`, `172.16.${int(0, 31)}.${int(1, 254)}`]);
const port = () => pick([22, 80, 443, 445, 3389, 4444, 8080, 8443, 53, 3306]);
const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 16)]).join('');
const LINES = [
  () => `[ALERT] brute-force attempt blocked ${ip()}`, () => `nmap -sV -p- target${int(1, 9)}.local`, () => '[+] payload delivered to sandbox',
  () => `SHA256: ${hex(7)}...${hex(4)}`, () => `GET /admin HTTP/1.1 ${pick([401, 403, 404])}`, () => `[SOC] incident #${int(4000, 4900)} escalated`,
  () => `firewall: DROP tcp ${ip()}:${port()}`, () => '$ sudo tcpdump -i eth0 -w capture.pcap', () => `[WARN] ${int(10, 99)} failed logins from ${ip()}`,
  () => `ssh: accepted publickey for analyst from ${ip()}`, () => `[IDS] signature match ET-${int(1e6, 9e6)} on :${port()}`,
  () => `CVE-2026-${int(1000, 9999)} patched on host-${hex(3)}`, () => `[!] beacon to ${ip()} every 60s`, () => `yara: rule Trojan_${hex(4)} matched in /tmp/${hex(6)}`,
  () => `[*] scanning ${ip()}/24 ... ${int(1, 40)} hosts up`, () => `dns: query ${hex(10)}.example.test NXDOMAIN`, () => `[EDR] process quarantined pid ${int(1000, 9999)}`,
  () => `TLS1.3 handshake ok ${ip()}:${port()}`, () => `[+] hash cracked in ${int(2, 90)}s: ${hex(8)}`, () => `auth.log: sudo session opened for root by analyst`,
];
const LINE_H = 20;   // px, matches .ei-line in eye-intro.css

export class TypingWall {
  constructor(parent, { reduced = false } = {}) {
    this.reduced = reduced; this.running = false; this.raf = 0;
    this.el = document.createElement('div'); this.el.className = 'ei-wall'; this.el.setAttribute('aria-hidden', 'true');
    const cols = innerWidth > 1100 ? 3 : innerWidth > 640 ? 2 : 1;
    this.rows = Math.ceil(innerHeight / LINE_H) + 2;
    this.logs = [];
    for (let i = 0; i < cols; i++) {
      const log = document.createElement('div'); log.className = 'ei-log'; this.el.append(log);
      const L = { el: log, typers: [] };
      this.logs.push(L);
      for (let k = 0; k < this.rows - 4; k++) this.add(L, pick(LINES)(), true);   // never starts empty
      if (!reduced) for (let k = 0, n = 1 + int(0, 2); k < n; k++) L.typers.push({ text: null, i: 0, at: performance.now() + k * rand(250, 800), speed: rand(18, 35) });
    }
    parent.prepend(this.el);
    this.tick = this.tick.bind(this);
  }
  add(L, text, done) {
    const d = document.createElement('div'); d.className = done ? 'ei-row' : 'ei-row ei-active';
    const t = document.createElement('span'); t.textContent = done ? text : ''; d.append(t);
    if (!done) { const c = document.createElement('span'); c.className = 'ei-cursor'; c.textContent = '█'; d.append(c); }
    L.el.append(d);
    while (L.el.children.length > this.rows) L.el.firstChild.remove();
    return { d, t };
  }
  glide(L) {   // the column moves up one row, smoothly
    L.el.style.transition = 'none'; L.el.style.transform = `translateY(${LINE_H}px)`;
    void L.el.offsetHeight;
    L.el.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)'; L.el.style.transform = 'translateY(0)';
  }
  tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    for (const L of this.logs) for (const ty of L.typers) {
      if (now < ty.at) continue;
      if (!ty.text) { ty.text = pick(LINES)(); ty.node = this.add(L, ty.text, false); ty.i = 0; this.glide(L); }
      const before = ty.i;
      while (now >= ty.at && ty.i < ty.text.length) { const ch = ty.text[ty.i++]; ty.at += ty.speed + (ch === ' ' && Math.random() < 0.35 ? rand(60, 220) : 0); }
      if (ty.i !== before) ty.node.t.textContent = ty.text.slice(0, ty.i);
      if (ty.i >= ty.text.length) { ty.node.d.classList.remove('ei-active'); ty.node.d.lastChild.remove(); ty.text = null; ty.at = now + rand(150, 600); ty.speed = rand(18, 35); }
    }
  }
  setOpacity(v) { this.el.style.opacity = String(v); }
  resume() {
    if (this.reduced || this.running) return;
    this.running = true;
    const now = performance.now();
    for (const L of this.logs) for (const ty of L.typers) ty.at = Math.max(ty.at, now);
    this.raf = requestAnimationFrame(this.tick);
  }
  pause() { this.running = false; cancelAnimationFrame(this.raf); }
}
