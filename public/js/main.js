/**
 * AMCO — Main JavaScript
 * ─────────────────────
 * Header scroll · Mobile menu · Turno form · Scroll reveal
 */

'use strict';

/* ══════════════════════════════════════
   HEADER — scroll state
══════════════════════════════════════ */
(function initHeader() {
  const header    = document.getElementById('mainHeader');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const menuClose = document.getElementById('menuClose');

  if (!header) return;

  function handleScroll() {
    header.classList.toggle('scrolled', window.scrollY > 60);
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  /* Mobile menu */
  function openMenu() {
    mobileMenu.classList.add('open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    hamburger.classList.add('active');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    hamburger.classList.remove('active');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function toggleMenu(e) { e.preventDefault(); e.stopPropagation(); mobileMenu.classList.contains('open') ? closeMenu() : openMenu(); }
  hamburger?.addEventListener('click', toggleMenu);
  hamburger?.addEventListener('touchend', (e) => {
    toggleMenu(e);
  });

  menuClose?.addEventListener('click', closeMenu);

  /* Close on any link click */
  mobileMenu?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  /* Close on ESC */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMenu();
  });
})();

/* ══════════════════════════════════════
   SMOOTH SCROLL — for in-page links
══════════════════════════════════════ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const targetId = this.getAttribute('href').slice(1);
    const target   = document.getElementById(targetId);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ══════════════════════════════════════
   SCROLL REVEAL — IntersectionObserver
══════════════════════════════════════ */
(function initReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

  /* Slide-in from right for Magdalena card */
  const slideObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('is-visible');
          }, 300);
          slideObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
  );
  document.querySelectorAll('.reveal-slide-right').forEach(el => slideObserver.observe(el));
})();

/* ══════════════════════════════════════
   TURNO FORM — submit handler
══════════════════════════════════════ */
(function initTurnoForm() {
  const form      = document.getElementById('turnoForm');
  const submitBtn = document.getElementById('submitBtn');
  const formMsg   = document.getElementById('formMsg');

  if (!form) return;

  /* Set min date to today */
  const fechaInput = document.getElementById('fecha');
  if (fechaInput) {
    const today = new Date().toISOString().split('T')[0];
    fechaInput.setAttribute('min', today);
  }

  function showMsg(type, text) {
    formMsg.innerHTML  = text;
    formMsg.className  = `form-msg ${type}`;
    formMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('loading', loading);
    const textNode = Array.from(submitBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = loading ? ' Enviando consulta...' : 'Confirmar consulta';
  }

  function markError(fieldId, msg) {
    const el = document.getElementById(fieldId);
    if (el) el.classList.add('error');
    showMsg('error', msg);
  }

  function clearErrors() {
    form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    formMsg.className = 'form-msg';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    const nombre   = document.getElementById('nombre')?.value.trim();
    const email    = document.getElementById('email')?.value.trim();
    const telefono = document.getElementById('telefono')?.value.trim();
    const fecha    = document.getElementById('fecha')?.value;
    const hora     = document.getElementById('hora')?.value;
    const servicio = document.getElementById('servicio')?.value;

    /* Validación */
    if (!nombre)  { markError('nombre', '⚠️ Por favor ingresá tu nombre completo.'); return; }
    if (!fecha)   { markError('fecha',  '⚠️ Por favor seleccioná una fecha preferida.'); return; }
    if (!hora)    { markError('hora',   '⚠️ Por favor seleccioná un horario preferido.'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      markError('email', '⚠️ El email ingresado no parece válido.'); return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/turnos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nombre, email, telefono, fecha, hora, servicio }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error del servidor.');

      showMsg('success',
        `✅ <strong>¡Consulta recibida con éxito!</strong><br>` +
        `Gracias, <strong>${nombre.split(' ')[0]}</strong>. En breve te contactamos para confirmar tu turno.<br>` +
        `<span style="font-size:12px;opacity:.8;display:block;margin-top:6px">📲 Abrimos WhatsApp para que puedas coordinar los detalles directamente con nuestro equipo.</span>`
      );
      form.reset();

      if (data.whatsappUrl) {
        setTimeout(() => { window.open(data.whatsappUrl, '_blank'); }, 900);
      }

      if (window.AMCO?.track) window.AMCO.track('turno_form_exito', window.location.pathname);

    } catch (err) {
      showMsg('error', `⚠️ ${err.message || 'Hubo un problema al enviar tu consulta. Intentá de nuevo o llamanos al (0341) 555-0200.'}`);
      if (window.AMCO?.track) window.AMCO.track('turno_form_error', window.location.pathname);
    } finally {
      setLoading(false);
    }
  });

  /* Limpiar error visual al editar un campo */
  form.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', () => el.classList.remove('error'));
    el.addEventListener('change', () => el.classList.remove('error'));
  });
})();

/* ══════════════════════════════════════
   SCROLL HELPER — legacy compat
══════════════════════════════════════ */
window.scrollToSection = function (id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
};
