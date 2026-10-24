/* EYE INTRO news wall: a cyber-security newspaper behind the eye. Columns of headlines over live log lines, one column
   sliding up, the next sliding down, each at its own pace, like a press that never stops. Plain DOM text on the
   compositor (crisp at any pixel ratio, cheap), independent of the eye. Sample values only: private IPs, made-up hosts. */
const rand = (a, b) => a + (b - a) * Math.random();
const pick = a => a[Math.floor(Math.random() * a.length)];
const int = (a, b) => Math.floor(rand(a, b));
const ip = () => pick([`10.0.${int(0, 255)}.${int(1, 254)}`, `192.168.${int(0, 255)}.${int(1, 254)}`, `172.16.${int(0, 31)}.${int(1, 254)}`]);
const port = () => pick([22, 80, 443, 445, 3389, 4444, 8080, 8443, 53, 3306]);
const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 16)]).join('');
const LOG = [
  () => `[ALERT] brute-force attempt blocked ${ip()}`, () => `nmap -sV -p- target${int(1, 9)}.local`, () => '[+] payload delivered to sandbox',
  () => `SHA256: ${hex(7)}...${hex(4)}`, () => `GET /admin HTTP/1.1 ${pick([401, 403, 404])}`, () => `[SOC] incident #${int(4000, 4900)} escalated`,
  () => `firewall: DROP tcp ${ip()}:${port()}`, () => '$ sudo tcpdump -i eth0 -w capture.pcap', () => `[WARN] ${int(10, 99)} failed logins from ${ip()}`,
  () => `ssh: accepted publickey for analyst from ${ip()}`, () => `[IDS] signature match ET-${int(1e6, 9e6)} on :${port()}`,
  () => `CVE-2026-${int(1000, 9999)} patched on host-${hex(3)}`, () => `[!] beacon to ${ip()} every 60s`, () => `yara: rule Trojan_${hex(4)} matched in /tmp/${hex(6)}`,
  () => `[*] scanning ${ip()}/24 ... ${int(1, 40)} hosts up`, () => `dns: query ${hex(10)}.example.test NXDOMAIN`, () => `[EDR] process quarantined pid ${int(1000, 9999)}`,
];
const HEAD = ['Zero-day exploited in the wild', 'Breach contained at 03:14', 'Ransomware crew goes dark', 'Patch Tuesday: 74 fixes',
  'Phishing wave hits inboxes', 'SOC stops lateral movement', 'Botnet sinkholed overnight', 'CVE-2026-4471 rated critical', 'Insider threat flagged',
  'DDoS peaks at 3.1 Tbps', 'The watcher sees all', 'Rootkit found in firmware', 'Access denied', 'Honeypot catches APT', 'Credentials leaked, rotated in 9 min'];

export class NewsWall {
  constructor(parent, { reduced = false } = {}) {
    this.el = document.createElement('div'); this.el.className = 'ei-news'; this.el.setAttribute('aria-hidden', 'true');
    if (reduced) this.el.classList.add('ei-still');
    const cols = Math.max(2, Math.min(6, Math.round(innerWidth / 330)));
    for (let k = 0; k < cols; k++) {
      const col = document.createElement('div'); col.className = 'ei-col';
      const track = document.createElement('div'); track.className = 'ei-track';
      track.style.animationName = k % 2 ? 'ei-press-down' : 'ei-press-up';
      track.style.animationDuration = rand(70, 120).toFixed(1) + 's';
      track.style.animationDelay = (-rand(0, 60)).toFixed(1) + 's';
      // one story block, written twice, so the loop is seamless
      let html = '';
      for (let s = 0; s < 7; s++) {
        html += `<h4>${pick(HEAD)}</h4><hr>`;
        for (let i = 0, n = int(4, 9); i < n; i++) html += `<p>${LOG[int(0, LOG.length)]().replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
      }
      track.innerHTML = `<div class="ei-block">${html}</div><div class="ei-block">${html}</div>`;
      col.append(track); this.el.append(col);
    }
    parent.prepend(this.el);
  }
  setOpacity(v) { this.el.style.opacity = String(v); }
  pause() { this.el.classList.add('ei-paused'); }
  resume() { this.el.classList.remove('ei-paused'); }
}
