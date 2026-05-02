/**
 * AMCO — Analytics Tracker
 * ─────────────────────────
 * Registra pageviews, eventos de usuario y tiempo en sitio
 * enviando datos al backend vía /api/analytics/track
 */

'use strict';

(function () {
  /* Generar o recuperar session_id de sessionStorage */
  let sessionId = sessionStorage.getItem('amco_sid');
  if (!sessionId) {
    sessionId = 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem('amco_sid', sessionId);
  }

  /**
   * Enviar evento al backend
   * @param {string} event
   * @param {string} page
   */
  async function track(event, page) {
    try {
      await fetch('/api/analytics/track', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event, page: page || window.location.pathname, session_id: sessionId }),
        keepalive: true,
      });
    } catch (_) {
      /* Silencioso — no bloquear la navegación */
    }
  }

  /* API pública */
  window.AMCO = window.AMCO || {};
  window.AMCO.track = track;

  /* ── Pageview inicial ── */
  track('pageview', window.location.pathname);

  /* ── Tracking de secciones vistas ── */
  const sectionIds = ['servicios', 'equipo', 'resenas', 'contacto'];
  const tracked    = new Set();

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.id && !tracked.has(entry.target.id)) {
          tracked.add(entry.target.id);
          track(`section_${entry.target.id}`, window.location.pathname);
        }
      });
    },
    { threshold: 0.3 }
  );

  sectionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) sectionObserver.observe(el);
  });

  /* ── Click en CTA buttons ── */
  document.querySelectorAll('.btn--gold, .btn--cta, .nav__link--cta').forEach(btn => {
    btn.addEventListener('click', () => {
      track('cta_click', window.location.pathname);
    });
  });

  /* ── Tiempo en sitio al salir ── */
  const startTime = Date.now();
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const seconds = Math.round((Date.now() - startTime) / 1000);
      track(`time_on_site_${seconds}s`, window.location.pathname);
    }
  });

  /* ── Scroll depth ── */
  let maxScroll = 0;
  const scrollMilestones = new Set();

  window.addEventListener('scroll', () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return; // página no scrolleable
    const scrollPct = Math.round((window.scrollY / scrollable) * 100);

    if (scrollPct > maxScroll) maxScroll = scrollPct;

    [25, 50, 75, 100].forEach(milestone => {
      if (scrollPct >= milestone && !scrollMilestones.has(milestone)) {
        scrollMilestones.add(milestone);
        track(`scroll_${milestone}pct`, window.location.pathname);
      }
    });
  }, { passive: true });

})();
