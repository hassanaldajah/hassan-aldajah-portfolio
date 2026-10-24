/* EYE INTRO loader: a full-screen eye made of words; scrolling dives through its pupil into the portfolio.
   Set EYE_INTRO_ENABLED to false (or delete the one <script> line in index.html) and the site is exactly as before.
   Runs in <head> so the eye covers the page from the first paint; the WebGL module loads once the page is parsed. */
(function () {
  var EYE_INTRO_ENABLED = true;
  var VERSION = '7';   // bump on every change so browsers fetch the new files instead of a cached copy
  if (!EYE_INTRO_ENABLED) return;
  // a deep link (#projects) or a restored scroll position goes straight to the content
  if (location.hash.length > 1) return;
  var root = document.documentElement, base = document.currentScript.src.replace(/[^/]*$/, '');
  var css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = base + 'eye-intro.css?v=' + VERSION;
  document.head.appendChild(css);
  root.classList.add('eye-intro-lock', 'eye-intro-hide');
  var done = false, bail = function () {   // WebGL missing, a CDN blocked or a script error: show the site as usual
    if (done) return; done = true;
    root.classList.remove('eye-intro-lock', 'eye-intro-hide');
    var el = document.getElementById('eye-intro'); if (el) el.remove();
  };
  document.addEventListener('eye-intro:ready', function () { done = true; }, { once: true });
  document.addEventListener('eye-intro:fail', bail, { once: true });
  setTimeout(bail, 12000);
  document.addEventListener('DOMContentLoaded', function () {
    if (scrollY > 0) return bail();
    var s = document.createElement('script');
    s.type = 'module'; s.src = base + 'eye-intro.module.js?v=' + VERSION;
    s.onerror = bail;
    document.body.appendChild(s);
  }, { once: true });
})();
