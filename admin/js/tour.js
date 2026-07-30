'use strict';

/* ═══════════════════════════════════════════════════════
   AMCO — Tour guiado del panel
   Se muestra automáticamente la primera vez que un usuario
   entra (marca en localStorage, por usuario). Después queda
   disponible desde el botón "?" de la barra superior.
   Sin dependencias: overlay + tarjeta posicionada.
═══════════════════════════════════════════════════════ */

(function () {

  const PASOS = [
    {
      titulo: '¡Bienvenido al panel de AMCO! 👋',
      texto: 'Este es el sistema de gestión de la clínica: turnos, pacientes, historias clínicas y más. Te mostramos lo básico en un minuto. Podés salir cuando quieras con la ✕ o la tecla Esc.',
      target: null,
    },
    {
      titulo: 'La vista «Hoy»',
      texto: 'Lo primero al entrar: la agenda del día lista para trabajar. Confirmá turnos, marcá quién fue atendido, cancelá, abrí la ficha del paciente y mandá recordatorios por WhatsApp con un clic. A la derecha, los turnos de mañana para avisarles con tiempo.',
      target: '.sidebar__link[data-section="hoy"]',
      seccion: 'hoy',
    },
    {
      titulo: 'Dashboard',
      texto: 'El resumen general: cuántos turnos activos hay, cuántos son hoy, los pendientes de confirmar y los últimos pedidos que entraron desde la web.',
      target: '.sidebar__link[data-section="dashboard"]',
      seccion: 'dashboard',
      soloAdmin: true,
    },
    {
      titulo: 'Turnos y calendario',
      texto: 'El corazón del día a día. El calendario muestra los turnos por color según su estado: naranja pendiente, verde confirmado, azul completado y rojo cancelado. Con «+ Nuevo turno» agendás manualmente, y al hacer clic en cualquier turno podés cambiarle el estado o eliminarlo. Los turnos confirmados pasan a «completado» solos cuando ya pasó su horario.',
      target: '.sidebar__link[data-section="turnos"]',
      seccion: 'turnos',
    },
    {
      titulo: 'Recordatorios automáticos',
      texto: 'Los pacientes con email cargado reciben un recordatorio automático el día anterior al turno y otro el mismo día — sin que nadie haga nada. Por eso conviene cargar siempre el email al crear un turno.',
      target: '.sidebar__link[data-section="turnos"]',
    },
    {
      titulo: 'Historial del día',
      texto: 'Los turnos de hoy con la ficha clínica de cada paciente a mano, para tener todo listo antes de que entren al consultorio.',
      target: '.sidebar__link[data-section="historial-hoy"]',
      seccion: 'historial-hoy',
    },
    {
      titulo: 'Pacientes y ficha clínica',
      texto: 'La historia clínica completa de todos los pacientes de la clínica: datos personales, anamnesis, odontograma y plan de tratamiento. Buscá por nombre, DNI o teléfono y abrí la ficha para consultarla o completarla.',
      target: '.sidebar__link[data-section="pacientes"]',
      seccion: 'pacientes',
    },
    {
      titulo: 'El odontograma',
      texto: 'Dentro de la ficha de cada paciente: elegí una prestación (caries, corona, implante…), marcá si está «a realizar» (rojo) o «realizada» (azul), y hacé clic en el diente — o en la cara exacta del diente. Hay odontograma de adultos y de niños.',
      target: '.sidebar__link[data-section="pacientes"]',
    },
    {
      titulo: 'Cuenta corriente y deudores',
      texto: 'La columna «Saldo» muestra de un vistazo quién debe plata, el filtro «Solo con saldo pendiente» lista los deudores, y dentro de cada ficha la pestaña «Trabajos» lleva la cuenta corriente con totales automáticos.',
      target: '.sidebar__link[data-section="pacientes"]',
    },
    {
      titulo: 'Presupuestos automáticos',
      texto: 'En la pestaña «Plan» de la ficha, el botón «🧾 Generar presupuesto» arma un documento con todo lo marcado «a realizar» en el odontograma, con los precios del catálogo y el total. Listo para imprimir o guardar en el plan.',
      target: '.sidebar__link[data-section="pacientes"]',
    },
    {
      titulo: 'Prestaciones y precios',
      texto: 'El catálogo de tratamientos con sus precios. Cargá acá los valores y los presupuestos salen calculados solos. Podés agregar tratamientos propios con el código que quieras.',
      target: '.sidebar__link[data-section="prestaciones"]',
      seccion: 'prestaciones',
      soloAdmin: true,
    },
    {
      titulo: 'Usuarios y seguridad',
      texto: 'Alta de usuarios para cada profesional (los doctores solo ven sus propios turnos), cambio de contraseñas, y el botón para descargar una copia de seguridad de todos los datos. Conviene bajar una por semana.',
      target: '.sidebar__link[data-section="usuarios"]',
      seccion: 'usuarios',
      soloAdmin: true,
    },
    {
      titulo: 'Analítica',
      texto: 'Cuánta gente visita la página de la clínica, qué días entran más y cuántos turnos se piden por semana.',
      target: '.sidebar__link[data-section="analytics"]',
      seccion: 'analytics',
      soloAdmin: true,
    },
    {
      titulo: '¡Eso es todo! ✅',
      texto: 'Si querés volver a ver esta guía, tocá el botón «?» arriba a la derecha. Cualquier duda, empezá por el Dashboard y explorá — no se rompe nada por mirar.',
      target: null,
    },
  ];

  let idx = 0;
  let visibles = [];

  const $ = (s) => document.querySelector(s);

  function claveVisto() {
    const u = localStorage.getItem('amco_username') || 'anon';
    return 'amco_tour_visto_v1_' + u;
  }

  function pasosParaEsteUsuario() {
    const esDoctor = (localStorage.getItem('amco_role') || 'admin') === 'doctor';
    return PASOS.filter(p => !(esDoctor && p.soloAdmin));
  }

  /* ── Construcción del overlay (una sola vez) ── */
  function asegurarDOM() {
    if ($('#tourOverlay')) return;
    const div = document.createElement('div');
    div.id = 'tourOverlay';
    div.innerHTML = `
      <div class="tour-backdrop"></div>
      <div class="tour-ring" id="tourRing"></div>
      <div class="tour-card" id="tourCard" role="dialog" aria-label="Guía del panel">
        <button class="tour-cerrar" id="tourCerrar" aria-label="Cerrar guía">✕</button>
        <div class="tour-titulo" id="tourTitulo"></div>
        <div class="tour-texto" id="tourTexto"></div>
        <div class="tour-pie">
          <div class="tour-dots" id="tourDots"></div>
          <div class="tour-btns">
            <button class="tour-btn" id="tourPrev">← Anterior</button>
            <button class="tour-btn tour-btn--next" id="tourNext">Siguiente →</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    $('#tourCerrar').addEventListener('click', terminarTour);
    $('#tourPrev').addEventListener('click', () => irA(idx - 1));
    $('#tourNext').addEventListener('click', () => {
      if (idx >= visibles.length - 1) terminarTour();
      else irA(idx + 1);
    });
    document.addEventListener('keydown', (e) => {
      if ($('#tourOverlay')?.style.display !== 'block') return;
      if (e.key === 'Escape')      terminarTour();
      if (e.key === 'ArrowRight')  { if (idx < visibles.length - 1) irA(idx + 1); }
      if (e.key === 'ArrowLeft')   irA(idx - 1);
    });
    window.addEventListener('resize', () => {
      if ($('#tourOverlay')?.style.display === 'block') posicionar();
    });
  }

  function irA(n) {
    if (n < 0 || n >= visibles.length) return;
    idx = n;
    const paso = visibles[idx];
    // Navegar a la sección para que el usuario vea de qué se habla
    if (paso.seccion && typeof window.navigateTo === 'function') {
      try { window.navigateTo(paso.seccion); } catch (_) {}
    }
    $('#tourTitulo').textContent = paso.titulo;
    $('#tourTexto').textContent  = paso.texto;
    $('#tourPrev').style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('#tourNext').textContent = idx >= visibles.length - 1 ? 'Terminar ✓' : 'Siguiente →';
    $('#tourDots').innerHTML = visibles.map((_, i) =>
      `<span class="tour-dot${i === idx ? ' tour-dot--on' : ''}"></span>`).join('');
    // Pequeña espera para que la sección termine de mostrarse
    requestAnimationFrame(posicionar);
  }

  function posicionar() {
    const paso  = visibles[idx];
    const ring  = $('#tourRing');
    const card  = $('#tourCard');
    const el    = paso.target ? document.querySelector(paso.target) : null;

    if (el && el.offsetParent !== null) {
      const r = el.getBoundingClientRect();
      ring.style.display = 'block';
      ring.style.top    = (r.top - 6) + 'px';
      ring.style.left   = (r.left - 6) + 'px';
      ring.style.width  = (r.width + 12) + 'px';
      ring.style.height = (r.height + 12) + 'px';
      // La tarjeta al costado del elemento (o abajo si no entra)
      const cw = Math.min(400, window.innerWidth - 24);
      card.style.maxWidth = cw + 'px';
      let top  = r.top;
      let left = r.right + 18;
      if (left + cw > window.innerWidth - 12) { left = Math.max(12, (window.innerWidth - cw) / 2); top = r.bottom + 14; }
      const ch = card.offsetHeight || 200;
      if (top + ch > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ch - 12);
      card.style.top  = top + 'px';
      card.style.left = left + 'px';
      card.style.transform = 'none';
    } else {
      // Paso sin objetivo: tarjeta centrada
      ring.style.display = 'none';
      card.style.maxWidth = Math.min(440, window.innerWidth - 24) + 'px';
      card.style.top  = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%,-50%)';
    }
  }

  function empezarTour() {
    asegurarDOM();
    visibles = pasosParaEsteUsuario();
    idx = 0;
    $('#tourOverlay').style.display = 'block';
    irA(0);
  }

  function terminarTour() {
    const ov = $('#tourOverlay');
    if (ov) ov.style.display = 'none';
    try { localStorage.setItem(claveVisto(), '1'); } catch (_) {}
  }

  /* ── Botón "?" en la barra superior ── */
  function asegurarBotonAyuda() {
    if ($('#tourHelpBtn')) return;
    const acciones = document.querySelector('.topbar__actions');
    if (!acciones) return;
    const b = document.createElement('button');
    b.id = 'tourHelpBtn';
    b.className = 'topbar__refresh';
    b.title = 'Ver la guía del panel';
    b.setAttribute('aria-label', 'Ver la guía del panel');
    b.textContent = '?';
    b.style.fontWeight = '700';
    b.style.fontSize = '15px';
    b.addEventListener('click', empezarTour);
    acciones.insertBefore(b, acciones.firstChild);
  }

  /* ── Arranque: lo llama initPanel() al entrar ── */
  window.initTour = function () {
    asegurarBotonAyuda();
    let visto = false;
    try { visto = !!localStorage.getItem(claveVisto()); } catch (_) {}
    if (!visto) setTimeout(empezarTour, 600); // pequeña pausa para que cargue el panel
  };

})();
