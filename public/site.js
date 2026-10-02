/* OpenNum — shared chrome: theme, nav search, on-chain status bar.
   Loaded with `defer` on every page. The theme itself is applied by a tiny
   inline script in <head> so the page never paints the wrong colours first. */
(function () {
  'use strict';

  /* ── theme ──────────────────────────────────────────────────────────────── */
  var STORE_KEY = 'opennum-theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORE_KEY, theme); } catch (e) { /* private mode */ }
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    });
  }

  function wireThemeToggles() {
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    });
    applyTheme(currentTheme());
  }

  /* ── nav search ─────────────────────────────────────────────────────────── */
  function normalizeNumber(value) {
    var q = String(value == null ? '' : value).trim().replace(/^#/, '');
    if (!/^\d+$/.test(q)) return null;
    var num = Number(q);
    return Number.isSafeInteger(num) && num >= 0 ? num : null;
  }

  function wireNavSearch() {
    document.querySelectorAll('.nav-search').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = form.querySelector('input');
        var num = normalizeNumber(input && input.value);
        if (num === null) {
          if (input) input.focus();
          return;
        }
        window.location.href = '/n/' + num;
      });
    });
  }

  /* ── chain bar ──────────────────────────────────────────────────────────── */
  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  function setStat(id, value, opts) {
    var el = document.getElementById(id);
    if (!el) return;
    var wrap = el.closest('.chain-stat');
    if (value === null || value === undefined) {
      if (wrap) wrap.style.display = 'none';
      return;
    }
    if (wrap) wrap.style.display = '';
    el.textContent = value;
    if (opts && opts.href && wrap && wrap.tagName === 'A') wrap.href = opts.href;
  }

  function loadChainStats() {
    if (!document.querySelector('.chainbar')) return;

    fetch('https://mempool.space/api/blocks/tip/height')
      .then(function (r) { if (!r.ok) throw new Error('height'); return r.text(); })
      .then(function (t) {
        var h = parseInt(t, 10);
        if (!Number.isFinite(h)) throw new Error('height');
        setStat('chainBlock', fmt(h));
      })
      .catch(function () {
        setStat('chainBlock', null);
        var dot = document.querySelector('.chain-dot');
        if (dot) dot.classList.add('is-stale');
      });

    fetch('https://mempool.space/api/v1/fees/recommended')
      .then(function (r) { if (!r.ok) throw new Error('fees'); return r.json(); })
      .then(function (d) {
        if (!d || !Number.isFinite(d.halfHourFee)) throw new Error('fees');
        setStat('chainFee', d.halfHourFee + ' sat/vB');
      })
      .catch(function () { setStat('chainFee', null); });

    // LATEST only shows while registrations are fresh; a number that has not
    // moved for weeks says "nobody is here" louder than showing nothing.
    var LATEST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    fetch('/api/list?sort=registered_at&order=desc&limit=1')
      .then(function (r) { if (!r.ok) throw new Error('registry'); return r.json(); })
      .then(function (d) {
        var newest = d && d.registrations && d.registrations[0];
        var at = newest && Date.parse(newest.registered_at);
        var fresh = Number.isFinite(at) && Date.now() - at <= LATEST_MAX_AGE_MS;
        setStat('chainLatest', fresh ? '#' + newest.inscription_num : null);
      })
      .catch(function () {
        setStat('chainLatest', null);
      });
  }

  function init() {
    wireThemeToggles();
    wireNavSearch();
    loadChainStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
