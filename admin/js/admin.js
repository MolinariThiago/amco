'use strict';

const SECTION_TITLES = {
  dashboard:'Dashboard', turnos:'Turnos', eliminados:'Turnos eliminados',
  analytics:'Analítica', usuarios:'Usuarios', pacientes:'Pacientes',
  'historial-hoy':'Historial del día'
};

const BASE_URL = (typeof window !== 'undefined' && window.location.hostname !== 'localhost')
  ? ''
  : 'http://localhost:3001';

const State = {
  token:null, username:null, role:null, medico:null, nombre:null,
  section:'dashboard', turnos:[], eliminados:[], analytics:null,
  currentTurno:null, calYear:new Date().getFullYear(), calMonth:new Date().getMonth(),
  pacientes:[], _pacienteEditId:null, _odontograma:{},
};

const API = {
  async req(method, path, body) {
    const opts = { method, headers:{'Content-Type':'application/json'} };
    if (State.token) opts.headers['Authorization'] = `Bearer ${State.token}`;
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(BASE_URL + path, opts);
    const data = await res.json().catch(()=>({}));
    if (!res.ok) { if (res.status===401) handleLogout(); throw new Error(data.error||'Error del servidor'); }
    return data;
  },
  login:      (u,p)  => API.req('POST',   '/api/admin/login', {username:u,password:p}),
  turnos:     (p)    => API.req('GET',    `/api/turnos?${new URLSearchParams(p)}`),
  patch:      (id,b) => API.req('PATCH',  `/api/turnos/${id}`, b),
  del:        (id)   => API.req('DELETE', `/api/turnos/${id}`),
  analytics:  ()     => API.req('GET',    '/api/analytics'),
  getUsers:   ()     => API.req('GET',    '/api/users'),
  addUser:    (b)    => API.req('POST',   '/api/users', b),
  delUser:    (u)    => API.req('DELETE', `/api/users/${u}`),
  patchUser:  (u,b)  => API.req('PATCH',  `/api/users/${u}`, b),
  getPacientes:    ()      => API.req('GET',    '/api/pacientes'),
  addPaciente:     (b)     => API.req('POST',   '/api/pacientes', b),
  patchPaciente:   (id, b) => API.req('PATCH',  `/api/pacientes/${id}`, b),
  delPaciente:     (id)    => API.req('DELETE', `/api/pacientes/${id}`),
  getPacientesHoy: ()      => API.req('GET',    '/api/pacientes/hoy'),
};

/* ── Toast ── */
let toastTimer;
function showToast(msg, type='default') {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.className   = `toast ${type} visible`;
  toastTimer = setTimeout(()=>t.classList.remove('visible'), 3400);
}

/* ── Login ── */
document.getElementById('loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn   = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  const user  = document.getElementById('loginUser').value.trim();
  const pass  = document.getElementById('loginPass').value;
  errEl.classList.remove('visible');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const data = await API.login(user, pass);
    if (!data.token) throw new Error('Login inválido');
    applySession(data); initPanel();
  } catch(err) { errEl.textContent=err.message; errEl.classList.add('visible'); }
  finally { btn.disabled=false; btn.classList.remove('loading'); }
});

function applySession(d) {
  State.token=d.token; State.username=d.username; State.role=d.role;
  State.medico=d.medico; State.nombre=d.nombre;
  localStorage.setItem('amco_token', d.token);
  localStorage.setItem('amco_username', d.username);
  localStorage.setItem('amco_role', d.role);
  localStorage.setItem('amco_medico', d.medico||'');
  localStorage.setItem('amco_nombre', d.nombre||'');
}

function handleLogout() {
  ['amco_token','amco_username','amco_role','amco_medico','amco_nombre'].forEach(k=>localStorage.removeItem(k));
  State.token=State.username=State.role=State.medico=State.nombre=null;
  document.getElementById('adminPanel').style.display  = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}
document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

(function restoreSession() {
  const token = localStorage.getItem('amco_token');
  if (!token) return;
  State.token    = token;
  State.username = localStorage.getItem('amco_username')||'';
  State.role     = localStorage.getItem('amco_role')||'admin';
  State.medico   = localStorage.getItem('amco_medico')||null;
  State.nombre   = localStorage.getItem('amco_nombre')||'';
  initPanel();
})();

/* ── Init panel ── */
function initPanel() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display  = 'flex';
  const nameEl   = document.getElementById('adminName');
  const roleEl   = document.getElementById('adminRole');
  const avatar   = document.getElementById('adminAvatar');
  const displayName = State.nombre || State.username;
  if (nameEl)  nameEl.textContent  = displayName;
  if (roleEl)  roleEl.textContent  = State.role === 'admin' ? 'Administrador' : 'Doctor';
  if (avatar)  avatar.textContent  = (displayName||'A')[0].toUpperCase();
  const isDoctor = State.role === 'doctor';
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.style.display = isDoctor ? 'none' : ''; });
  initSidebar(); initSidebarMobile();
  navigateTo(isDoctor ? 'turnos' : 'dashboard');
  document.getElementById('refreshBtn')?.addEventListener('click', ()=>{
    const btn=document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    loadCurrentSection().finally(()=>btn.classList.remove('spinning'));
  });
}

/* ── Sidebar ── */
function initSidebar() {
  document.querySelectorAll('.sidebar__link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      if (!section) return;
      if (State.role==='doctor' && ['dashboard','analytics','usuarios','pacientes'].includes(section)) {
        showToast('Acceso restringido', 'error'); return;
      }
      navigateTo(section); closeSidebarMobile();
    });
  });
}



function navigateTo(section) {
  State.section = section;
  document.querySelectorAll('.sidebar__link').forEach(l=>l.classList.toggle('active', l.dataset.section===section));
  document.querySelectorAll('.admin-section').forEach(s=>{ s.style.display = s.id===`section-${section}` ? 'block' : 'none'; });
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = SECTION_TITLES[section] || section;
  loadCurrentSection();
}

async function loadCurrentSection() {
  switch(State.section) {
    case 'dashboard':     return loadDashboard();
    case 'turnos':        return loadTurnos();
    case 'eliminados':    return loadEliminados();
    case 'analytics':     return loadAnalytics();
    case 'usuarios':      return loadUsuarios();
    case 'pacientes':     return loadPacientes();
    case 'historial-hoy': return loadHistorialHoy();
  }
}

function initSidebarMobile() {
  const toggle=document.getElementById('sidebarToggle');
  const sidebar=document.getElementById('sidebar');
  const overlay=document.getElementById('sidebarOverlay');
  toggle?.addEventListener('click',()=>{ sidebar.classList.toggle('open'); overlay.classList.toggle('visible'); });
  overlay?.addEventListener('click', closeSidebarMobile);
}
function closeSidebarMobile() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('visible');
}

/* ── Dashboard ── */
async function loadDashboard() {
  try {
    const [td, ad] = await Promise.all([API.turnos({vista:'activos'}), API.analytics()]);
    State.turnos=td.data; State.analytics=ad.data;
    const a=State.analytics;
    setText('kpiTurnos', a.turnosTotal);
    setText('kpiHoy',    a.turnosHoy);
    setText('kpiVisitas',a.pageviews.toLocaleString('es-AR'));
    setText('kpiPend',   a.turnosPend);
    const tbody=document.querySelector('#dashUltimosTurnos tbody');
    if (tbody) tbody.innerHTML = a.ultimosTurnos.length
      ? a.ultimosTurnos.map(t=>`<tr>
          <td>${escHtml(t.nombre)}</td><td>${fmtFecha(t.fecha)}</td>
          <td>${escHtml(t.servicio||'—')}</td><td>${badgeHtml(t.estado)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="table-loading">Sin turnos</td></tr>';
    renderBarChart('serviciosChart', a.servicios.map(s=>({label:s.servicio,val:s.total})));
    renderActivityChart('activityChart', a.visitasPorDia, 'navy');
  } catch(err) { showToast('Error dashboard: '+err.message,'error'); }
}

/* ── Turnos + Calendario ── */
async function loadTurnos() {
  const search=document.getElementById('searchInput')?.value.trim()||'';
  const from=document.getElementById('filterFrom')?.value||'';
  const to=document.getElementById('filterTo')?.value||'';
  const tbody=document.getElementById('turnosBody');
  if (tbody) tbody.innerHTML='<tr><td colspan="9" class="table-loading">Cargando...</td></tr>';
  try {
    const data=await API.turnos({vista:'activos',search,from,to});
    State.turnos=data.data;
    renderCalendar();
    renderTurnosTable(State.turnos);
    const countEl=document.getElementById('totalCount');
    if (countEl) countEl.textContent=`${State.turnos.length} turno${State.turnos.length!==1?'s':''}`;
  } catch(err) { showToast('Error turnos: '+err.message,'error'); }
}

/* ── Calendario ── */
function renderCalendar() {
  const container = document.getElementById('calendarGrid');
  if (!container) return;

  const year  = State.calYear;
  const month = State.calMonth;
  const today = new Date();
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const titleEl = document.getElementById('calTitle');
  if (titleEl) titleEl.textContent = `${MESES[month]} ${year}`;

  const tPorFecha = {};
  State.turnos.forEach(t => {
    if (!t.fecha) return;
    const [y, m] = t.fecha.split('-').map(Number);
    if (y === year && m - 1 === month) {
      if (!tPorFecha[t.fecha]) tPorFecha[t.fecha] = [];
      tPorFecha[t.fecha].push(t);
    }
  });
  Object.values(tPorFecha).forEach(arr => arr.sort((a, b) => (a.hora||'').localeCompare(b.hora||'')));

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const MAX_VISIBLE = 3;
  let html = '';

  for (let i = 0; i < startOffset; i++) html += '<div class="cal-day cal-day--empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayT     = tPorFecha[dateStr] || [];
    const isToday  = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
    const dayOfWeek = new Date(year, month, d).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const classes = ['cal-day', isToday?'cal-day--today':'', isWeekend?'cal-day--weekend':''].filter(Boolean).join(' ');

    const numHtml = `<div class="cal-day__num"><span>${d}</span></div>`;

    const visible = dayT.slice(0, MAX_VISIBLE);
    const hidden  = dayT.length - visible.length;

    const chipsHtml = visible.map(t => {
      const nombre  = escHtml(t.nombre || '—');
      const hora    = t.hora || '';
      const estado  = t.estado || 'pendiente';
      const medicoS = t.medico ? ` · ${medicoShort(t.medico)}` : '';
      const tooltip = `${hora}hs — ${t.nombre}${medicoS} (${estado})`;
      return `<div class="cal-turno cal-turno--${estado}" title="${escHtml(tooltip)}" onclick="event.stopPropagation();openModal(${t.id})">
        <span class="cal-turno__hora">${hora}</span>
        <span class="cal-turno__nombre">${nombre}</span>
      </div>`;
    }).join('');

    const masHtml = hidden > 0
      ? `<div class="cal-turno cal-turno--mas" onclick="event.stopPropagation();calDayClick('${dateStr}')">+${hidden} más</div>`
      : '';

    html += `<div class="${classes}" data-date="${dateStr}" onclick="calDayClick('${dateStr}')">
      ${numHtml}${chipsHtml}${masHtml}
    </div>`;
  }

  container.innerHTML = html;
}

function medicoShort(m) {
  return { 'dra-baccon':'Baccon', 'dra-cappello':'Cappello', 'dr-molinari':'Molinari', 'dra-magdalena':'Magdalena' }[m] || '';
}

window.calDayClick = function(dateStr) {
  document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('cal-day--selected'));
  document.querySelector(`.cal-day[data-date="${dateStr}"]`)?.classList.add('cal-day--selected');
  const filtered = State.turnos.filter(t => t.fecha === dateStr);
  renderTurnosTable(filtered.length ? filtered : State.turnos);
  const countEl = document.getElementById('totalCount');
  if (countEl) {
    countEl.textContent = filtered.length
      ? `${filtered.length} turno${filtered.length!==1?'s':''} — ${fmtFecha(dateStr)}`
      : `${State.turnos.length} turnos`;
  }
};

document.getElementById('calPrev')?.addEventListener('click', () => {
  State.calMonth--;
  if (State.calMonth < 0) { State.calMonth = 11; State.calYear--; }
  renderCalendar();
});
document.getElementById('calNext')?.addEventListener('click', () => {
  State.calMonth++;
  if (State.calMonth > 11) { State.calMonth = 0; State.calYear++; }
  renderCalendar();
});
document.getElementById('calToday')?.addEventListener('click', () => {
  State.calYear  = new Date().getFullYear();
  State.calMonth = new Date().getMonth();
  renderCalendar();
  renderTurnosTable(State.turnos);
});

/* Tabla turnos */
function renderTurnosTable(turnos) {
  const tbody=document.getElementById('turnosBody');
  if (!tbody) return;
  if (!turnos?.length) { tbody.innerHTML='<tr><td colspan="9" class="table-loading">No hay turnos.</td></tr>'; return; }
  tbody.innerHTML=turnos.map(t=>`
    <tr>
      <td><strong style="color:var(--adm-gold)">#${String(t.id).slice(-5)}</strong></td>
      <td>
        <div style="font-weight:500">${escHtml(t.nombre)}</div>
        <div style="font-size:11px;color:var(--adm-muted)">${escHtml(t.email||'')}</div>
      </td>
      <td>
        <div style="font-weight:500">${fmtFecha(t.fecha)}</div>
        <div style="font-size:12px;color:var(--adm-muted)">${t.hora} hs</div>
      </td>
      <td>${escHtml(t.servicio||'—')}</td>
      <td>${escHtml(t.telefono||'—')}</td>
      <td>${medicoLabel(t.medico)}</td>
      <td>${badgeHtml(t.estado)}</td>
      <td style="font-size:12px;color:var(--adm-muted)">${fmtDatetime(t.createdAt)}</td>
      <td>
        <button class="action-btn" onclick="openModal(${t.id})">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ver
        </button>
      </td>
    </tr>`).join('');
}

function medicoLabel(m) {
  const map={
    'dra-baccon':    '<span class="medico-tag medico-tag--baccon">Luisina B. Baccon</span>',
    'dra-cappello':  '<span class="medico-tag medico-tag--cappello">Soledad Cappello</span>',
    'dr-molinari':   '<span class="medico-tag medico-tag--molinari">Francisco Molinari</span>',
    'dra-magdalena': '<span class="medico-tag medico-tag--magdalena">M. Magdalena</span>',
  };
  return map[m]||'<span style="font-size:11px;color:var(--adm-muted)">—</span>';
}

document.getElementById('filterBtn')?.addEventListener('click', loadTurnos);
document.getElementById('clearFilterBtn')?.addEventListener('click',()=>{
  ['searchInput','filterFrom','filterTo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  loadTurnos();
});
document.getElementById('searchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')loadTurnos();});

/* ── Eliminados ── */
async function loadEliminados() {
  const tbody=document.getElementById('eliminadosBody');
  if(tbody) tbody.innerHTML='<tr><td colspan="7" class="table-loading">Cargando...</td></tr>';
  try {
    const data=await API.turnos({vista:'eliminados'});
    State.eliminados=data.data;
    if(!tbody) return;
    tbody.innerHTML=!State.eliminados.length
      ?'<tr><td colspan="7" class="table-loading">No hay turnos eliminados.</td></tr>'
      :State.eliminados.map(t=>`<tr>
          <td><strong>#${String(t.id).slice(-5)}</strong></td>
          <td>${escHtml(t.nombre)}</td><td>${fmtFecha(t.fecha)}</td>
          <td>${t.hora} hs</td><td>${escHtml(t.servicio||'—')}</td>
          <td>${fmtDatetime(t.createdAt)}</td><td>${fmtDatetime(t.deletedAt)}</td>
        </tr>`).join('');
  } catch(err) { showToast('Error: '+err.message,'error'); }
}

/* ── Analytics ── */
async function loadAnalytics() {
  try {
    const data=await API.analytics();
    const a=data.data; State.analytics=a;
    setText('anPageviews', a.pageviews.toLocaleString('es-AR'));
    setText('anSessions',  a.sessions.toLocaleString('es-AR'));
    setText('anTurnosSem', a.turnosSemana);
    setText('anEliminados',a.eliminados);
    renderActivityChart('visitasDiaChart',a.visitasPorDia,'navy');
    renderBarChart('eventosChart',a.eventosPop.map(e=>({label:e.event,val:e.c})));
    renderActivityChart('turnosDiaChart',a.turnosPorDia,'gold');
  } catch(err) { showToast('Error analítica: '+err.message,'error'); }
}

/* ── Usuarios ── */
async function loadUsuarios() {
  const tbody=document.getElementById('usuariosBody');
  if(tbody) tbody.innerHTML='<tr><td colspan="5" class="table-loading">Cargando...</td></tr>';
  try {
    const data=await API.getUsers();
    if(!tbody) return;
    State._usuarios = data.data;
    tbody.innerHTML=data.data.map(u=>`<tr>
      <td><strong>${escHtml(u.username)}</strong></td>
      <td>${escHtml(u.nombre||'—')}</td>
      <td>${u.role==='admin'
        ?'<span class="role-tag role-tag--admin">Admin</span>'
        :'<span class="role-tag role-tag--doctor">Doctor</span>'}</td>
      <td>${medicoLabel(u.medico)}</td>
      <td><button class="action-btn" onclick="editUser('${u.username}')">
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>
      ${u.username==='admin'?'':`<button class="action-btn action-btn--danger" onclick="deleteUser('${u.username}')">
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg> Eliminar</button>`}</td>
    </tr>`).join('');
  } catch(err) { showToast('Error: '+err.message,'error'); }
}

/* ── Descargar copia de seguridad ── */
document.getElementById('backupBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('backupBtn');
  const txt = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    const res = await fetch(BASE_URL + '/api/admin/backup', {
      headers: { 'Authorization': `Bearer ${State.token}` }
    });
    if (!res.ok) throw new Error('No se pudo generar el backup');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `amco-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
});

window.editUser = function(username) {
  const u = (State._usuarios || []).find(x => x.username === username);
  if (!u) return;
  document.getElementById('ueUsername').value = u.username;
  document.getElementById('ueNombre').value   = u.nombre || '';
  document.getElementById('uePassword').value = '';
  document.getElementById('userEditModal').style.display = 'flex';
};

function closeUserEditModal() {
  document.getElementById('userEditModal').style.display = 'none';
}
document.getElementById('userEditClose')?.addEventListener('click', closeUserEditModal);
document.getElementById('userEditBackdrop')?.addEventListener('click', closeUserEditModal);

document.getElementById('ueSaveBtn')?.addEventListener('click', async () => {
  const username = document.getElementById('ueUsername').value;
  const nombre   = document.getElementById('ueNombre').value.trim();
  const password = document.getElementById('uePassword').value.trim();
  if (!nombre && !password) return showToast('Cambiá el nombre o ingresá una contraseña nueva','error');
  const body = {};
  if (nombre)   body.nombre   = nombre;
  if (password) body.password = password;
  try {
    await API.patchUser(username, body);
    showToast(password ? 'Usuario actualizado — la nueva contraseña ya está activa' : 'Usuario actualizado','success');
    closeUserEditModal();
    loadUsuarios();
  } catch(err) { showToast('Error: '+err.message,'error'); }
});

window.deleteUser = async function(username) {
  if(!confirm(`¿Eliminar usuario "${username}"?`)) return;
  try { await API.delUser(username); showToast('Usuario eliminado','success'); loadUsuarios(); }
  catch(err) { showToast('Error: '+err.message,'error'); }
};

document.getElementById('addUserForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const username=document.getElementById('newUsername').value.trim();
  const password=document.getElementById('newPassword').value.trim();
  const nombre  =document.getElementById('newNombre').value.trim();
  const role    =document.getElementById('newRole').value;
  const medico  =document.getElementById('newMedico').value;
  if(!username||!password) return showToast('Usuario y contraseña requeridos','error');
  try {
    await API.addUser({username,password,role,nombre,medico:medico||null});
    showToast('Usuario creado','success'); e.target.reset(); loadUsuarios();
  } catch(err) { showToast(err.message,'error'); }
});

document.getElementById('newRole')?.addEventListener('change', function() {
  const g=document.getElementById('medicoGroup');
  if(g) g.style.display=this.value==='doctor'?'block':'none';
});

/* ── Modal turno ── */
window.openModal = function(id) {
  const turno=State.turnos.find(t=>t.id===id);
  if(!turno) return;
  State.currentTurno=turno;
  const body=document.getElementById('modalBody');
  const estado=document.getElementById('modalEstado');
  body.innerHTML=`<div class="modal-detail">
    <div class="modal-row"><strong>Paciente</strong><span>${escHtml(turno.nombre)}</span></div>
    <div class="modal-row"><strong>Email</strong><span>${escHtml(turno.email||'—')}</span></div>
    <div class="modal-row"><strong>Teléfono</strong><span>${escHtml(turno.telefono||'—')}</span></div>
    <div class="modal-row"><strong>Fecha</strong><span>${fmtFecha(turno.fecha)}</span></div>
    <div class="modal-row"><strong>Hora</strong><span>${turno.hora} hs</span></div>
    <div class="modal-row"><strong>Servicio</strong><span>${escHtml(turno.servicio||'—')}</span></div>
    <div class="modal-row"><strong>Médico</strong><span>${medicoLabel(turno.medico)}</span></div>
    <div class="modal-row"><strong>Estado</strong><span>${badgeHtml(turno.estado)}</span></div>
    <div class="modal-row"><strong>Registrado</strong><span>${fmtDatetime(turno.createdAt)}</span></div>
    ${turno.notas?`<div class="modal-row"><strong>Notas</strong><span>${escHtml(turno.notas)}</span></div>`:''}
  </div>`;
  if(estado) estado.value=turno.estado;
  document.getElementById('turnoModal').style.display='flex';
  document.body.style.overflow='hidden';
};

function closeModal() {
  document.getElementById('turnoModal').style.display='none';
  document.body.style.overflow=''; State.currentTurno=null;
}
document.getElementById('modalClose')?.addEventListener('click', closeModal);
document.getElementById('modalBackdrop')?.addEventListener('click', closeModal);

document.addEventListener('keydown', e=>{
  if(e.key==='Escape') {
    if(document.getElementById('turnoModal')?.style.display==='flex') closeModal();
    if(document.getElementById('nuevoTurnoModal')?.style.display==='flex') closeNuevoTurnoModal();
    if(document.getElementById('pacienteModal')?.style.display==='flex') closePacienteModal();
  }
});

document.getElementById('modalSaveBtn')?.addEventListener('click', async()=>{
  if(!State.currentTurno) return;
  const estado=document.getElementById('modalEstado').value;
  try { await API.patch(State.currentTurno.id,{estado}); showToast('Estado actualizado','success'); closeModal(); loadTurnos(); }
  catch(err) { showToast('Error: '+err.message,'error'); }
});

document.getElementById('modalDeleteBtn')?.addEventListener('click', async()=>{
  if(!State.currentTurno) return;
  if(!confirm(`¿Eliminar turno de ${State.currentTurno.nombre}?`)) return;
  try { await API.del(State.currentTurno.id); showToast('Turno eliminado','default'); closeModal(); loadTurnos(); }
  catch(err) { showToast('Error: '+err.message,'error'); }
});

/* ── Charts ── */
function renderBarChart(containerId, items) {
  const el=document.getElementById(containerId);
  if(!el) return;
  if(!items?.length){el.innerHTML='<p style="color:#6B7A8D;font-size:13px;padding:8px 0">Sin datos aún</p>';return;}
  const max=Math.max(...items.map(i=>i.val),1);
  el.innerHTML=items.slice(0,8).map(item=>`
    <div class="bar-item">
      <span class="bar-item__label" title="${escHtml(item.label)}">${escHtml(item.label)}</span>
      <div class="bar-item__track"><div class="bar-item__fill" style="width:${Math.round((item.val/max)*100)}%"></div></div>
      <span class="bar-item__val">${item.val}</span>
    </div>`).join('');
}

function renderActivityChart(containerId, data, color='navy') {
  const el=document.getElementById(containerId);
  if(!el) return;
  if(!data?.length){el.innerHTML='<p style="color:#6B7A8D;font-size:13px;padding:8px 0">Sin datos aún</p>';return;}
  const fills={navy:'var(--adm-navy)',gold:'var(--adm-gold)',sage:'var(--adm-sage)'};
  const fill=fills[color]||fills.navy;
  const sorted=[...data].sort((a,b)=>a.dia.localeCompare(b.dia)).slice(-30);
  const max=Math.max(...sorted.map(d=>d.c),1);
  el.innerHTML=sorted.map(d=>{
    const h=Math.max(4,Math.round((d.c/max)*76));
    return `<div class="activity-bar" title="${d.dia}: ${d.c}">
      <div class="activity-bar__fill" style="height:${h}px;background:${fill}"></div>
      <span class="activity-bar__lbl">${d.dia?d.dia.slice(5):''}</span>
    </div>`;
  }).join('');
}

/* ── Helpers ── */
function escHtml(str){return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));}
function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val??'—';}
function fmtFecha(s){if(!s)return'—';const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
function fmtDatetime(s){if(!s)return'—';const d=new Date(s.replace(' ','T'));if(isNaN(d))return s;return d.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function badgeHtml(e){const cls=['pendiente','confirmado','completado','cancelado'].includes(e)?e:'pendiente';return`<span class="badge badge--${cls}">${escHtml(e)}</span>`;}

/* ══════════════════════════════════════════════════
   PACIENTES
══════════════════════════════════════════════════ */

async function loadPacientes(query = '') {
  const tbody = document.getElementById('pacientesBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Cargando...</td></tr>';
  try {
    const data = await API.getPacientes();
    let lista = data.data || [];
    if (query) {
      const q = query.toLowerCase();
      lista = lista.filter(p =>
        (p.nombre||'').toLowerCase().includes(q) ||
        (p.email||'').toLowerCase().includes(q) ||
        (p.dni||'').toLowerCase().includes(q) ||
        (p.telefono||'').toLowerCase().includes(q)
      );
    }
    State.pacientes = lista;

    // Deuda total de la cartera (se calcula sobre todos, no sobre el filtro)
    const deudaTotal = lista.reduce((acc, p) => { const s = saldoDeTrabajos(p.trabajos); return acc + (s > 0 ? s : 0); }, 0);
    const conDeuda   = lista.filter(p => saldoDeTrabajos(p.trabajos) > 0).length;
    const elTot = document.getElementById('pacientesTotalDeuda');
    if (elTot) {
      elTot.innerHTML = deudaTotal > 0
        ? `Por cobrar: <strong>${trabMoneda(deudaTotal)}</strong> · ${conDeuda} paciente(s)`
        : '';
    }

    if (document.getElementById('soloDeudores')?.checked) {
      lista = lista.filter(p => saldoDeTrabajos(p.trabajos) > 0);
    }

    if (!tbody) return;
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-loading">No hay pacientes que coincidan.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(p => `
      <tr>
        <td><strong style="color:var(--adm-gold)">#${String(p.id).slice(-5)}</strong></td>
        <td>
          <div style="font-weight:500">${escHtml(p.nombre)}</div>
          <div style="font-size:11px;color:var(--adm-muted)">${escHtml(p.email||'')}</div>
        </td>
        <td style="font-size:13px">${escHtml(p.dni||'—')}</td>
        <td style="font-size:13px">${escHtml(p.telefono||'—')}</td>
        <td style="font-size:13px">${p.fechaNacimiento ? fmtFecha(p.fechaNacimiento) : '—'}</td>
        <td style="text-align:right;white-space:nowrap">${saldoCeldaHtml(p.trabajos)}</td>
        <td style="font-size:12px;color:var(--adm-muted)">${fmtDatetime(p.createdAt)}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="action-btn" onclick="openPacienteModal(${p.id})">
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="action-btn" onclick="openHistorial(${p.id})" style="background:var(--adm-sage);color:#fff;border-color:var(--adm-sage)">
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            Historial
          </button>
        </td>
      </tr>`).join('');
  } catch(err) { showToast('Error pacientes: '+err.message, 'error'); }
}

// Celda de saldo para la lista de pacientes
function saldoCeldaHtml(trabajos) {
  const s = saldoDeTrabajos(trabajos);
  if (!s) return '<span style="font-size:12px;color:var(--adm-subtle)">—</span>';
  const debe = s > 0;
  return `<span class="saldo-tag ${debe ? 'saldo-tag--debe' : 'saldo-tag--favor'}"
    title="${debe ? 'Saldo pendiente de cobro' : 'Saldo a favor del paciente'}">${trabMoneda(Math.abs(s))}</span>`;
}

document.getElementById('soloDeudores')?.addEventListener('change', () => {
  loadPacientes(document.getElementById('pacientesSearch').value.trim());
});

document.getElementById('pacientesSearchBtn')?.addEventListener('click', () => {
  loadPacientes(document.getElementById('pacientesSearch').value.trim());
});
document.getElementById('pacientesClearBtn')?.addEventListener('click', () => {
  document.getElementById('pacientesSearch').value = '';
  loadPacientes();
});
document.getElementById('pacientesSearch')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadPacientes(e.target.value.trim());
});
document.getElementById('nuevoPacienteBtn')?.addEventListener('click', () => openPacienteModal(null));

window.openPacienteModal = function(id) {
  State._pacienteEditId = id;
  const p = id ? State.pacientes.find(x => x.id === id) : null;
  document.getElementById('pacienteModalTitle').textContent = id ? 'Ficha clínica' : 'Nueva ficha clínica';

  document.getElementById('pmNombre').value        = p?.nombre           || '';
  document.getElementById('pmDni').value           = p?.dni              || '';
  document.getElementById('pmEmail').value         = p?.email            || '';
  document.getElementById('pmTelefono').value      = p?.telefono         || '';
  document.getElementById('pmFechaNac').value      = p?.fechaNacimiento  || '';
  document.getElementById('pmObservaciones').value = p?.observaciones    || '';
  document.getElementById('pmHistorial').value     = p?.historialClinico || '';
  document.getElementById('pmEstadoCivil').value   = p?.estadoCivil      || '';
  document.getElementById('pmProfesion').value     = p?.profesion        || '';
  document.getElementById('pmDireccion').value     = p?.direccion        || '';
  document.getElementById('pmObrasocial').value    = p?.obrasocial       || '';
  document.getElementById('pmIndicacion').value    = p?.indicacion       || '';
  document.getElementById('pmMedicacion').value    = p?.medicacion       || '';
  document.getElementById('pmTratInicio').value    = p?.tratInicio       || '';
  document.getElementById('pmTratTermino').value   = p?.tratTermino      || '';
  // Nuevos campos ficha física
  document.getElementById('pmCredencial').value        = p?.credencial        || '';
  document.getElementById('pmTitular').value           = p?.titular           || '';
  document.getElementById('pmGrupoFamiliar').value     = p?.grupoFamiliar     || '';
  document.getElementById('pmParentesco').value        = p?.parentesco        || '';
  document.getElementById('pmEdad').value              = p?.edad              || '';
  document.getElementById('pmLocalidad').value         = p?.localidad         || '';
  document.getElementById('pmTrabajo').value           = p?.trabajo           || '';
  document.getElementById('pmRepNombre').value         = p?.repNombre         || '';
  document.getElementById('pmRepDomicilio').value      = p?.repDomicilio      || '';
  document.getElementById('pmRepDni').value            = p?.repDni            || '';
  document.getElementById('pmRepRelacion').value       = p?.repRelacion       || '';
  document.getElementById('pmUltimaConsulta').value    = p?.ultimaConsulta    || '';
  document.getElementById('pmMedicoCabecera').value    = p?.medicoCabecera    || '';
  document.getElementById('pmTratamientoMedico').value = p?.tratamientoMedico || '';
  document.getElementById('pmFechaInicioTrat').value   = p?.fechaInicioTrat   || '';

  const an = p?.anamnesis || {};
  document.getElementById('pmAlergNoNo').checked = an.alergNo  || false;
  document.getElementById('pmAlergSi').checked   = an.alergSi  || false;
  document.getElementById('pmAlergDesc').value   = an.alergDesc || '';
  document.getElementById('pmAntiNo').checked    = an.antiNo   || false;
  document.getElementById('pmAntiSi').checked    = an.antiSi   || false;
  document.getElementById('pmAntiDesc').value    = an.antiDesc || '';
  document.getElementById('pmAnestNo').checked   = an.anestNo  || false;
  document.getElementById('pmAnestSi').checked   = an.anestSi  || false;
  document.getElementById('pmAnestDesc').value   = an.anestDesc|| '';
  document.getElementById('pmSaludNo').checked   = an.saludNo  || false;
  document.getElementById('pmSaludSi').checked   = an.saludSi  || false;
  document.getElementById('pmSaludDesc').value   = an.saludDesc|| '';
  // Nuevos campos anamnesis
  document.getElementById('pmCardioNo').checked  = an.cardioNo  || false;
  document.getElementById('pmCardioSi').checked  = an.cardioSi  || false;
  document.getElementById('pmCardioDesc').value  = an.cardioDesc|| '';
  document.getElementById('pmHiperNo').checked   = an.hiperNo   || false;
  document.getElementById('pmHiperSi').checked   = an.hiperSi   || false;
  document.getElementById('pmHiperDesc').value   = an.hiperDesc || '';
  document.getElementById('pmReumaNo').checked   = an.reumaNo   || false;
  document.getElementById('pmReumaSi').checked   = an.reumaSi   || false;
  document.getElementById('pmReumaDesc').value   = an.reumaDesc || '';
  document.getElementById('pmDiabNo').checked    = an.diabNo    || false;
  document.getElementById('pmDiabSi').checked    = an.diabSi    || false;
  document.getElementById('pmDiabDesc').value    = an.diabDesc  || '';
  document.getElementById('pmGastroNo').checked  = an.gastroNo  || false;
  document.getElementById('pmGastroSi').checked  = an.gastroSi  || false;
  document.getElementById('pmGastroDesc').value  = an.gastroDesc|| '';
  document.getElementById('pmHepaNo').checked    = an.hepaNo    || false;
  document.getElementById('pmHepaSi').checked    = an.hepaSi    || false;
  document.getElementById('pmHepaTipo').value    = an.hepaTipo  || '';
  document.getElementById('pmHepaFecha').value   = an.hepaFecha || '';
  document.getElementById('pmHivNo').checked     = an.hivNo     || false;
  document.getElementById('pmHivSi').checked     = an.hivSi     || false;
  document.getElementById('pmHivDesc').value     = an.hivDesc   || '';
  document.getElementById('pmEmbarNo').checked   = an.embarNo   || false;
  document.getElementById('pmEmbarSi').checked   = an.embarSi   || false;
  document.getElementById('pmEmbarMes').value    = an.embarMes  || '';
  document.getElementById('pmHemorrNo').checked  = an.hemorrNo  || false;
  document.getElementById('pmHemorrSi').checked  = an.hemorrSi  || false;
  document.getElementById('pmHemorrDesc').value  = an.hemorrDesc|| '';
  document.getElementById('pmBruxNo').checked    = an.bruxNo    || false;
  document.getElementById('pmBruxSi').checked    = an.bruxSi    || false;
  document.getElementById('pmBruxDesc').value    = an.bruxDesc  || '';
  document.getElementById('pmCancerNo').checked  = an.cancerNo  || false;
  document.getElementById('pmCancerSi').checked  = an.cancerSi  || false;
  document.getElementById('pmCancerDesc').value  = an.cancerDesc|| '';
  document.getElementById('pmOtrasAfecciones').value = an.otrasAfecciones || '';
  // Cargar tabla de trabajos
  renderTrabajosTable(p?.trabajos || []);

  initOdontograma(p?.odontograma || {});

  document.getElementById('pmDeleteBtn').style.display = id ? 'inline-flex' : 'none';
  setFichaTab('datos');
  document.getElementById('pacienteModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

function setFichaTab(tab) {
  document.querySelectorAll('#fichaTabs .ficha-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#pacienteModal .ficha-section[data-tab-panel]').forEach(s =>
    s.classList.toggle('active', s.dataset.tabPanel === tab));
}
document.getElementById('fichaTabs')?.addEventListener('click', e => {
  const btn = e.target.closest('.ficha-tab');
  if (btn) setFichaTab(btn.dataset.tab);
});

window.openHistorial = function(id) {
  openPacienteModal(id);
  setTimeout(() => document.getElementById('pmHistorial')?.scrollIntoView({behavior:'smooth', block:'center'}), 300);
};

function closePacienteModal() {
  document.getElementById('pacienteModal').style.display = 'none';
  document.body.style.overflow = '';
  State._pacienteEditId = null;
}
document.getElementById('pacienteModalClose')?.addEventListener('click', closePacienteModal);
document.getElementById('pacienteModalBackdrop')?.addEventListener('click', closePacienteModal);

document.getElementById('pmSaveBtn')?.addEventListener('click', async () => {
  const nombre = document.getElementById('pmNombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'error'); return; }
  const body = {
    nombre,
    dni:              document.getElementById('pmDni').value.trim(),
    email:            document.getElementById('pmEmail').value.trim(),
    telefono:         document.getElementById('pmTelefono').value.trim(),
    fechaNacimiento:  document.getElementById('pmFechaNac').value,
    observaciones:    document.getElementById('pmObservaciones').value.trim(),
    historialClinico: document.getElementById('pmHistorial').value.trim(),
    estadoCivil:      document.getElementById('pmEstadoCivil').value,
    profesion:        document.getElementById('pmProfesion').value.trim(),
    direccion:        document.getElementById('pmDireccion').value.trim(),
    obrasocial:       document.getElementById('pmObrasocial').value.trim(),
    indicacion:       document.getElementById('pmIndicacion').value.trim(),
    medicacion:       document.getElementById('pmMedicacion').value.trim(),
    tratInicio:       document.getElementById('pmTratInicio').value,
    tratTermino:      document.getElementById('pmTratTermino').value,
    // Nuevos campos
    credencial:       document.getElementById('pmCredencial').value.trim(),
    titular:          document.getElementById('pmTitular').value.trim(),
    grupoFamiliar:    document.getElementById('pmGrupoFamiliar').value.trim(),
    parentesco:       document.getElementById('pmParentesco').value.trim(),
    edad:             document.getElementById('pmEdad').value.trim(),
    localidad:        document.getElementById('pmLocalidad').value.trim(),
    trabajo:          document.getElementById('pmTrabajo').value.trim(),
    repNombre:        document.getElementById('pmRepNombre').value.trim(),
    repDomicilio:     document.getElementById('pmRepDomicilio').value.trim(),
    repDni:           document.getElementById('pmRepDni').value.trim(),
    repRelacion:      document.getElementById('pmRepRelacion').value.trim(),
    ultimaConsulta:   document.getElementById('pmUltimaConsulta').value.trim(),
    medicoCabecera:   document.getElementById('pmMedicoCabecera').value.trim(),
    tratamientoMedico:document.getElementById('pmTratamientoMedico').value.trim(),
    fechaInicioTrat:  document.getElementById('pmFechaInicioTrat').value,
    trabajos:         getTrabajosData(),
    anamnesis: {
      alergNo:  document.getElementById('pmAlergNoNo').checked,
      alergSi:  document.getElementById('pmAlergSi').checked,
      alergDesc:document.getElementById('pmAlergDesc').value.trim(),
      antiNo:   document.getElementById('pmAntiNo').checked,
      antiSi:   document.getElementById('pmAntiSi').checked,
      antiDesc: document.getElementById('pmAntiDesc').value.trim(),
      anestNo:  document.getElementById('pmAnestNo').checked,
      anestSi:  document.getElementById('pmAnestSi').checked,
      anestDesc:document.getElementById('pmAnestDesc').value.trim(),
      saludNo:  document.getElementById('pmSaludNo').checked,
      saludSi:  document.getElementById('pmSaludSi').checked,
      saludDesc:document.getElementById('pmSaludDesc').value.trim(),
      cardioNo: document.getElementById('pmCardioNo').checked,
      cardioSi: document.getElementById('pmCardioSi').checked,
      cardioDesc:document.getElementById('pmCardioDesc').value.trim(),
      hiperNo:  document.getElementById('pmHiperNo').checked,
      hiperSi:  document.getElementById('pmHiperSi').checked,
      hiperDesc:document.getElementById('pmHiperDesc').value.trim(),
      reumaNo:  document.getElementById('pmReumaNo').checked,
      reumaSi:  document.getElementById('pmReumaSi').checked,
      reumaDesc:document.getElementById('pmReumaDesc').value.trim(),
      diabNo:   document.getElementById('pmDiabNo').checked,
      diabSi:   document.getElementById('pmDiabSi').checked,
      diabDesc: document.getElementById('pmDiabDesc').value.trim(),
      gastroNo: document.getElementById('pmGastroNo').checked,
      gastroSi: document.getElementById('pmGastroSi').checked,
      gastroDesc:document.getElementById('pmGastroDesc').value.trim(),
      hepaNo:   document.getElementById('pmHepaNo').checked,
      hepaSi:   document.getElementById('pmHepaSi').checked,
      hepaTipo: document.getElementById('pmHepaTipo').value.trim(),
      hepaFecha:document.getElementById('pmHepaFecha').value.trim(),
      hivNo:    document.getElementById('pmHivNo').checked,
      hivSi:    document.getElementById('pmHivSi').checked,
      hivDesc:  document.getElementById('pmHivDesc').value.trim(),
      embarNo:  document.getElementById('pmEmbarNo').checked,
      embarSi:  document.getElementById('pmEmbarSi').checked,
      embarMes: document.getElementById('pmEmbarMes').value.trim(),
      hemorrNo: document.getElementById('pmHemorrNo').checked,
      hemorrSi: document.getElementById('pmHemorrSi').checked,
      hemorrDesc:document.getElementById('pmHemorrDesc').value.trim(),
      bruxNo:   document.getElementById('pmBruxNo').checked,
      bruxSi:   document.getElementById('pmBruxSi').checked,
      bruxDesc: document.getElementById('pmBruxDesc').value.trim(),
      cancerNo: document.getElementById('pmCancerNo').checked,
      cancerSi: document.getElementById('pmCancerSi').checked,
      cancerDesc:document.getElementById('pmCancerDesc').value.trim(),
      otrasAfecciones:document.getElementById('pmOtrasAfecciones').value.trim(),
    },
    odontograma: State._odontograma || {},
  };
  const saveBtn = document.getElementById('pmSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="btn-spinner"></span> Guardando…';
  try {
    if (State._pacienteEditId) {
      await API.patchPaciente(State._pacienteEditId, body);
      showToast('Ficha actualizada', 'success');
    } else {
      await API.addPaciente(body);
      showToast('Paciente creado', 'success');
    }
    closePacienteModal();
    loadPacientes();
  } catch(err) { showToast('Error: '+err.message, 'error'); }
  finally { saveBtn.disabled = false; saveBtn.innerHTML = '💾 Guardar ficha'; }
});

document.getElementById('pmDeleteBtn')?.addEventListener('click', async () => {
  if (!State._pacienteEditId) return;
  const p = State.pacientes.find(x => x.id === State._pacienteEditId);
  if (!confirm(`¿Eliminar al paciente "${p?.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await API.delPaciente(State._pacienteEditId);
    showToast('Paciente eliminado', 'default');
    closePacienteModal();
    loadPacientes();
  } catch(err) { showToast('Error: '+err.message, 'error'); }
});

/* ══════════════════════════════════════════════════
   ODONTOGRAMA INTERACTIVO — por caras y prestaciones

   Formato de datos (JSONB en pacientes.odontograma):
     { _tipo:'permanente',
       "17": { pieza:{t:'corona',e:'r'}, caras:{ o:{t:'caries',e:'p'} } } }
   e: 'p' = a realizar (rojo) · 'r' = realizado (azul)

   Compatibilidad: el formato viejo ("17":"caries") se migra
   automáticamente a pieza completa, sin perder nada.
══════════════════════════════════════════════════ */

// Catálogo de prestaciones. ambito: 'pieza' (todo el diente) o 'cara'.
const OD_PRESTACIONES = [
  // ── Por cara ──
  { cod:'20', nom:'Caries',                  ambito:'cara'  },
  { cod:'21', nom:'Obturación composite',    ambito:'cara'  },
  { cod:'22', nom:'Obturación amalgama',     ambito:'cara'  },
  { cod:'23', nom:'Ionómero',                ambito:'cara'  },
  { cod:'24', nom:'Sellante',                ambito:'cara'  },
  { cod:'25', nom:'Incrustación',            ambito:'cara'  },
  { cod:'26', nom:'Desgaste / abrasión',     ambito:'cara'  },
  // ── Pieza completa ──
  { cod:'01', nom:'Pieza ausente',           ambito:'pieza', simbolo:'ausente'        },
  { cod:'02', nom:'Extracción indicada',     ambito:'pieza', simbolo:'extraccion'     },
  { cod:'03', nom:'Pieza extraída',          ambito:'pieza', simbolo:'extraida'       },
  { cod:'04', nom:'Implante',                ambito:'pieza', simbolo:'implante'       },
  { cod:'05', nom:'Corona',                  ambito:'pieza', simbolo:'corona'         },
  { cod:'06', nom:'Perno / muñón',           ambito:'pieza', simbolo:'perno'          },
  { cod:'07', nom:'Endodoncia',              ambito:'pieza', simbolo:'endodoncia'     },
  { cod:'08', nom:'Prótesis fija',           ambito:'pieza', simbolo:'puente'         },
  { cod:'09', nom:'Prótesis removible',      ambito:'pieza', simbolo:'removible'      },
  { cod:'10', nom:'Resto radicular',         ambito:'pieza', simbolo:'resto'          },
  { cod:'11', nom:'Diente en erupción',      ambito:'pieza', simbolo:'erupcion'       },
  { cod:'12', nom:'Supernumerario',          ambito:'pieza', simbolo:'supernumerario' },
  { cod:'13', nom:'Fractura',                ambito:'pieza', simbolo:'fractura'       },
  { cod:'14', nom:'Movilidad',               ambito:'pieza', simbolo:'movilidad'      },
];
const OD_PREST_BY_COD = Object.fromEntries(OD_PRESTACIONES.map(p => [p.cod, p]));

// Mapeo del formato viejo → código de prestación
const OD_LEGACY = {
  sano:null, caries:'20', obturacion:'21', corona:'05',
  implante:'04', extraccion:'02', ausente:'01',
};

const OD_TEETH = {
  permanente: {
    top: [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28],
    bot: [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38],
  },
  temporal: {
    top: [55,54,53,52,51, 61,62,63,64,65],
    bot: [85,84,83,82,81, 71,72,73,74,75],
  },
};

const OD_COLOR = { p:'#E74C3C', r:'#2980B9' };

let _odPrest  = '20';   // prestación seleccionada
let _odEstado = 'p';    // 'p' a realizar · 'r' realizado
let _odBorrar = false;  // modo goma

// ── Helpers de anatomía ──
function odCuadrante(num) { return Math.floor(num / 10); }
function odEsSuperior(num) { return [1,2,5,6].includes(odCuadrante(num)); }
// Mesial apunta hacia la línea media: cuadrantes 1,4,5,8 → derecha; 2,3,6,7 → izquierda
function odMesialDerecha(num) { return [1,4,5,8].includes(odCuadrante(num)); }
function odEsAnterior(num) { return (num % 10) <= 3; }

function odNombreCara(num, cara) {
  if (cara === 'v') return 'Vestibular';
  if (cara === 'p') return odEsSuperior(num) ? 'Palatina' : 'Lingual';
  if (cara === 'm') return 'Mesial';
  if (cara === 'd') return 'Distal';
  if (cara === 'o') return odEsAnterior(num) ? 'Incisal' : 'Oclusal';
  return cara;
}
function odLetraCara(num, cara) {
  if (cara === 'p') return odEsSuperior(num) ? 'P' : 'L';
  if (cara === 'o') return odEsAnterior(num) ? 'I' : 'O';
  return cara.toUpperCase();
}

// ── Migración / normalización ──
function odNormalizar(data) {
  const out = { _tipo: (data && data._tipo) || 'permanente' };
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') {
      // Formato viejo: "17": "caries"
      const cod = OD_LEGACY[v];
      if (!cod) continue;                       // 'sano' o desconocido → sin marca
      const prest = OD_PREST_BY_COD[cod];
      // Diagnósticos quedan como "a realizar"; tratamientos como "realizado"
      const e = (cod === '20' || cod === '02') ? 'p' : 'r';
      if (prest.ambito === 'pieza') out[k] = { pieza:{ t:cod, e } };
      else                         out[k] = { caras:{ o:{ t:cod, e } } };
    } else if (v && typeof v === 'object') {
      out[k] = v;                               // formato nuevo, tal cual
    }
  }
  return out;
}

function initOdontograma(data) {
  State._odontograma = odNormalizar(data);
  _odBorrar = false;
  _initOdToolbar();
  renderOdontograma();
  _initAnamnesisHighlight();
}

function _initAnamnesisHighlight() {
  document.querySelectorAll('.anam-row').forEach(row => {
    const siCb = row.querySelector('input[id$="Si"]');
    if (!siCb) return;
    const sync = () => row.classList.toggle('anam-row--si', siCb.checked);
    siCb.removeEventListener('change', sync);
    siCb.addEventListener('change', sync);
    sync();
  });
}

function _initOdToolbar() {
  const sel = document.getElementById('odPrestacion');
  if (sel && !sel.dataset.ready) {
    const grupo = (titulo, arr) =>
      `<optgroup label="${titulo}">` +
      arr.map(p => `<option value="${p.cod}">${p.cod} · ${p.nom}</option>`).join('') +
      `</optgroup>`;
    sel.innerHTML =
      grupo('Por cara del diente', OD_PRESTACIONES.filter(p => p.ambito === 'cara')) +
      grupo('Pieza completa',      OD_PRESTACIONES.filter(p => p.ambito === 'pieza'));
    sel.dataset.ready = '1';
    sel.addEventListener('change', () => { _odPrest = sel.value; _odBorrar = false; _syncOdToolbar(); });
  }
  if (sel) sel.value = _odPrest;

  const tipo = document.getElementById('odTipo');
  if (tipo && !tipo.dataset.ready) {
    tipo.dataset.ready = '1';
    tipo.addEventListener('change', () => {
      State._odontograma._tipo = tipo.value;
      renderOdontograma();
    });
  }
  if (tipo) tipo.value = State._odontograma._tipo || 'permanente';

  const tog = document.getElementById('odEstadoToggle');
  if (tog && !tog.dataset.ready) {
    tog.dataset.ready = '1';
    tog.addEventListener('click', e => {
      const b = e.target.closest('button[data-estado]');
      if (!b) return;
      _odEstado = b.dataset.estado;
      _odBorrar = false;
      _syncOdToolbar();
    });
  }

  const borrar = document.getElementById('odBorrarBtn');
  if (borrar && !borrar.dataset.ready) {
    borrar.dataset.ready = '1';
    borrar.addEventListener('click', () => { _odBorrar = !_odBorrar; _syncOdToolbar(); });
  }
  _syncOdToolbar();
}

function _syncOdToolbar() {
  document.querySelectorAll('#odEstadoToggle button').forEach(b =>
    b.classList.toggle('active', !_odBorrar && b.dataset.estado === _odEstado));
  document.getElementById('odBorrarBtn')?.classList.toggle('active', _odBorrar);
  const hint = document.getElementById('odHint');
  if (hint) {
    if (_odBorrar) {
      hint.textContent = '🧽 Modo borrar: hacé clic en una marca para eliminarla.';
    } else {
      const p = OD_PREST_BY_COD[_odPrest];
      hint.textContent = p?.ambito === 'cara'
        ? `Hacé clic en la cara del diente donde va "${p.nom}".`
        : `Hacé clic en cualquier parte del diente para marcar "${p?.nom}".`;
    }
  }
  document.getElementById('odontogramaContainer')?.classList.toggle('od-modo-borrar', _odBorrar);
}

// ── Render ──
function renderOdontograma() {
  const tipo = State._odontograma._tipo || 'permanente';
  const set  = OD_TEETH[tipo] || OD_TEETH.permanente;
  _renderOdRow('odTopRow', set.top);
  _renderOdRow('odBotRow', set.bot);
  _renderOdResumen();
}

function _renderOdRow(containerId, teeth) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const mid = teeth.length / 2;
  el.innerHTML = teeth.map((num, i) =>
    (i === mid ? '<div class="od-separator" style="min-height:64px"></div>' : '') +
    `<div class="od-tooth" data-tooth="${num}" title="${_odTitulo(num)}">
       ${_odToothSvg(num)}
       <span class="od-tooth__num">${num}</span>
     </div>`
  ).join('');
  el.querySelectorAll('.od-zona').forEach(z => {
    z.addEventListener('click', ev => {
      ev.stopPropagation();
      odAplicar(Number(z.dataset.tooth), z.dataset.cara);
    });
  });
}

function _odToothSvg(num) {
  const d     = State._odontograma[num] || {};
  const caras = d.caras || {};
  const pieza = d.pieza;
  const mesialDer = odMesialDerecha(num);
  const izq = mesialDer ? 'd' : 'm';
  const der = mesialDer ? 'm' : 'd';

  const poly = {
    v:   '3,3 37,3 26,14 14,14',
    p:   '3,37 37,37 26,26 14,26',
    [izq]: '3,3 3,37 14,26 14,14',
    [der]: '37,3 37,37 26,26 26,14',
    o:   '14,14 26,14 26,26 14,26',
  };

  const zona = (cara) => {
    const m = caras[cara];
    const fill = m ? OD_COLOR[m.e] || OD_COLOR.p : '#fff';
    return `<polygon class="od-zona" points="${poly[cara]}" fill="${fill}"
              data-tooth="${num}" data-cara="${cara}"><title>${odNombreCara(num,cara)}</title></polygon>`;
  };

  const zonas = ['v','p','m','d','o'].map(zona).join('');
  const overlay = pieza ? _odSimbolo(pieza) : '';

  return `<svg class="od-svg" viewBox="0 0 40 40" aria-label="Diente ${num}">${zonas}${overlay}</svg>`;
}

function _odSimbolo(pieza) {
  const p = OD_PREST_BY_COD[pieza.t];
  const c = OD_COLOR[pieza.e] || OD_COLOR.p;
  const s = p?.simbolo || 'corona';
  // Trazo con halo blanco debajo, para que se lea sobre caras pintadas
  const T = (d, w = 3) =>
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w + 2.2}" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>` +
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const gris = `<rect x="3" y="3" width="34" height="34" fill="#CFD4D8" opacity=".92"/>`;

  switch (s) {
    // Pieza ausente: diente "apagado" con cruz gris
    case 'ausente':
      return gris +
        `<path d="M8 8 L32 32 M32 8 L8 32" fill="none" stroke="#78838B" stroke-width="2.4" stroke-linecap="round"/>`;

    // Extracción indicada: cruz marcada
    case 'extraccion':
      return T('M7 7 L33 33 M33 7 L7 33', 3.4);

    // Pieza extraída: hueco + cruz
    case 'extraida':
      return gris + T('M8 8 L32 32 M32 8 L8 32', 3);

    // Implante: tornillo con plataforma y roscas
    case 'implante':
      return `<rect x="13.5" y="6" width="13" height="3.8" rx="1.4" fill="#fff" stroke="${c}" stroke-width="1.6"/>` +
        `<path d="M16.4 10.5 L23.6 10.5 L21.6 33 L18.4 33 Z" fill="${c}" opacity=".2" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>` +
        `<path d="M16.1 15.5 L23.9 15.5 M16.4 20.5 L23.6 20.5 M16.8 25.5 L23.2 25.5 M17.2 30 L22.8 30"
           fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>`;

    // Corona: anillo que envuelve la pieza
    case 'corona':
      return `<circle cx="20" cy="20" r="15.5" fill="${c}" opacity=".1"/>` +
        `<circle cx="20" cy="20" r="15.5" fill="none" stroke="#fff" stroke-width="5" opacity=".85"/>` +
        `<circle cx="20" cy="20" r="15.5" fill="none" stroke="${c}" stroke-width="3.2"/>`;

    // Perno / muñón: poste con cabeza dentro de la raíz
    case 'perno':
      return T('M20 33 L20 13', 3.4) +
        `<path d="M13.5 13 L26.5 13 L23.5 6.5 L16.5 6.5 Z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`;

    // Endodoncia: conductos radiculares
    case 'endodoncia':
      return T('M20 5 L20 20 M20 20 L15.5 34 M20 20 L24.5 34', 2.9);

    // Prótesis fija: barra de puente que conecta con las vecinas
    case 'puente':
      return `<path d="M0 20 L40 20" stroke="#fff" stroke-width="6" opacity=".9"/>` +
        `<path d="M0 20 L40 20" stroke="${c}" stroke-width="3.6"/>` +
        `<circle cx="20" cy="20" r="4.2" fill="#fff" stroke="${c}" stroke-width="2.2"/>`;

    // Prótesis removible: retenedores a los costados
    case 'removible':
      return T('M11 6 L4.5 6 L4.5 34 L11 34', 2.9) + T('M29 6 L35.5 6 L35.5 34 L29 34', 2.9);

    // Resto radicular: solo queda la base, con borde fracturado
    case 'resto':
      return `<path d="M5 20 L11 23.5 L17 18.5 L23 23.5 L29 18.5 L35 22 L35 37 L5 37 Z"
                fill="${c}" opacity=".42" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`;

    // Diente en erupción: flecha hacia arriba
    case 'erupcion':
      return T('M20 34 L20 11 M13.5 17 L20 9.5 L26.5 17', 3.2);

    // Supernumerario: más, dentro de un círculo
    case 'supernumerario':
      return `<circle cx="20" cy="20" r="11" fill="#fff" opacity=".85"/>` +
        `<circle cx="20" cy="20" r="11" fill="none" stroke="${c}" stroke-width="2.4"/>` +
        T('M20 13.5 L20 26.5 M13.5 20 L26.5 20', 2.8);

    // Fractura: línea de quiebre en zigzag
    case 'fractura':
      return T('M11 4 L18.5 14 L13 20.5 L22 27 L17 36', 2.9);

    // Movilidad: flecha doble horizontal
    case 'movilidad':
      return T('M8.5 20 L31.5 20 M13 15.5 L8 20 L13 24.5 M27 15.5 L32 20 L27 24.5', 2.9);

    default:
      return `<circle cx="20" cy="20" r="15.5" fill="none" stroke="${c}" stroke-width="3.2"/>`;
  }
}

function _odTitulo(num) {
  const items = _odItemsDiente(num);
  return items.length
    ? `Pieza ${num}\n` + items.map(i => `· ${i.texto}`).join('\n')
    : `Pieza ${num} — sin prestaciones`;
}

function _odItemsDiente(num) {
  const d = State._odontograma[num];
  if (!d) return [];
  const out = [];
  if (d.pieza) {
    const p = OD_PREST_BY_COD[d.pieza.t];
    out.push({ cara:null, estado:d.pieza.e,
      texto:`${p?.nom || d.pieza.t} — ${d.pieza.e === 'r' ? 'realizado' : 'a realizar'}` });
  }
  for (const [cara, m] of Object.entries(d.caras || {})) {
    const p = OD_PREST_BY_COD[m.t];
    out.push({ cara, estado:m.e,
      texto:`${p?.nom || m.t} en ${odNombreCara(num, cara)} — ${m.e === 'r' ? 'realizado' : 'a realizar'}` });
  }
  return out;
}

function _renderOdResumen() {
  const cont = document.getElementById('odResumen');
  if (!cont) return;
  const tipo = State._odontograma._tipo || 'permanente';
  const set  = OD_TEETH[tipo] || OD_TEETH.permanente;
  const orden = [...set.top, ...set.bot];
  const filas = [];
  for (const num of orden) {
    for (const it of _odItemsDiente(num)) {
      filas.push(`<div class="od-res-item">
        <span class="od-res-pieza">${num}</span>
        <span class="od-res-dot od-res-dot--${it.estado}"></span>
        <span class="od-res-txt">${escHtml(it.texto)}</span>
        <button type="button" class="od-res-del" title="Quitar"
          onclick="odQuitar(${num}, ${it.cara ? `'${it.cara}'` : 'null'})">✕</button>
      </div>`);
    }
  }
  const count = document.getElementById('odResumenCount');
  if (count) count.textContent = filas.length;
  cont.innerHTML = filas.length
    ? filas.join('')
    : '<p class="od-res-empty">Todavía no cargaste prestaciones en este odontograma.</p>';
}

// ── Acciones ──
function odAplicar(num, cara) {
  const d = State._odontograma;
  if (_odBorrar) {
    // Borra lo que esté visible en esa zona: primero la cara, si no la pieza
    if (d[num]?.caras?.[cara]) delete d[num].caras[cara];
    else if (d[num]?.pieza)    delete d[num].pieza;
    _odLimpiarVacio(num);
  } else {
    const p = OD_PREST_BY_COD[_odPrest];
    if (!p) return;
    d[num] = d[num] || {};
    if (p.ambito === 'pieza') {
      d[num].pieza = { t:_odPrest, e:_odEstado };
    } else {
      d[num].caras = d[num].caras || {};
      d[num].caras[cara] = { t:_odPrest, e:_odEstado };
    }
  }
  _odRefrescarDiente(num);
  _renderOdResumen();
}

window.odQuitar = function(num, cara) {
  const d = State._odontograma;
  if (!d[num]) return;
  if (cara) { if (d[num].caras) delete d[num].caras[cara]; }
  else      { delete d[num].pieza; }
  _odLimpiarVacio(num);
  _odRefrescarDiente(num);
  _renderOdResumen();
};

function _odLimpiarVacio(num) {
  const t = State._odontograma[num];
  if (!t) return;
  if (t.caras && Object.keys(t.caras).length === 0) delete t.caras;
  if (!t.pieza && !t.caras) delete State._odontograma[num];
}

function _odRefrescarDiente(num) {
  const el = document.querySelector(`.od-tooth[data-tooth="${num}"]`);
  if (!el) return;
  el.title = _odTitulo(num);
  el.querySelector('.od-svg')?.remove();
  el.insertAdjacentHTML('afterbegin', _odToothSvg(num));
  el.querySelectorAll('.od-zona').forEach(z => {
    z.addEventListener('click', ev => {
      ev.stopPropagation();
      odAplicar(Number(z.dataset.tooth), z.dataset.cara);
    });
  });
}

/* ══════════════════════════════════════════════════
   NUEVO TURNO MANUAL
══════════════════════════════════════════════════ */
function openNuevoTurnoModal() {
  ['ntNombre','ntEmail','ntTelefono','ntNotas'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('ntFecha').value    = new Date().toISOString().slice(0,10);
  document.getElementById('ntHora').value     = '';
  document.getElementById('ntServicio').value = '';
  document.getElementById('ntMedico').value   = '';
  document.getElementById('ntEstado').value   = 'confirmado';
  document.querySelectorAll('.nt-field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('#nuevoTurnoModal .form-group-adm input, #nuevoTurnoModal .form-group-adm select').forEach(el => el.classList.remove('input-error'));
  document.getElementById('nuevoTurnoModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('ntNombre')?.focus(), 80);
  // Pre-cargar pacientes si no están en memoria
  if (!State.pacientes || State.pacientes.length === 0) {
    API.getPacientes().then(r => { if (r?.data) State.pacientes = r.data; }).catch(()=>{});
  }
}

document.getElementById('nuevoTurnoBtn')?.addEventListener('click', openNuevoTurnoModal);

function closeNuevoTurnoModal() {
  const modal = document.getElementById('nuevoTurnoModal');
  modal.classList.add('modal--closing');
  setTimeout(() => { modal.style.display='none'; modal.classList.remove('modal--closing'); document.body.style.overflow=''; }, 180);
}
document.getElementById('nuevoTurnoClose')?.addEventListener('click', closeNuevoTurnoModal);
document.getElementById('nuevoTurnoBackdrop')?.addEventListener('click', closeNuevoTurnoModal);
window.closeNuevoTurnoModal = closeNuevoTurnoModal;

// Autocompletar pacientes
document.getElementById('ntNombre')?.addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  const list = document.getElementById('ntPacientesSugg');
  if (!list) return;
  if (!q || q.length < 2) { list.style.display='none'; return; }
  const matches = (State.pacientes||[]).filter(p => p.nombre.toLowerCase().includes(q)).slice(0,6);
  if (!matches.length) { list.style.display='none'; return; }
  list.innerHTML = matches.map(p =>
    `<li class="nt-sugg-item" data-nombre="${escHtml(p.nombre)}" data-email="${escHtml(p.email||'')}" data-tel="${escHtml(p.telefono||'')}">
      <span class="nt-sugg-nombre">${escHtml(p.nombre)}</span>
      ${p.telefono?`<span class="nt-sugg-meta">${escHtml(p.telefono)}</span>`:''}
    </li>`
  ).join('');
  list.style.display = 'block';
});

document.getElementById('ntPacientesSugg')?.addEventListener('click', function(e) {
  const item = e.target.closest('.nt-sugg-item');
  if (!item) return;
  document.getElementById('ntNombre').value   = item.dataset.nombre;
  document.getElementById('ntEmail').value    = item.dataset.email;
  document.getElementById('ntTelefono').value = item.dataset.tel;
  this.style.display = 'none';
});

document.addEventListener('click', e => {
  if (!e.target.closest('#ntNombre') && !e.target.closest('#ntPacientesSugg')) {
    const s = document.getElementById('ntPacientesSugg'); if(s) s.style.display='none';
  }
});

function ntSetFieldError(fieldId, msg) {
  const el = document.getElementById(fieldId);
  const err = document.getElementById(fieldId+'Err');
  if (el) el.classList.toggle('input-error', !!msg);
  if (err) err.textContent = msg || '';
}

document.getElementById('ntSaveBtn')?.addEventListener('click', async () => {
  const nombre   = document.getElementById('ntNombre').value.trim();
  const fecha    = document.getElementById('ntFecha').value;
  const hora     = document.getElementById('ntHora').value;
  const servicio = document.getElementById('ntServicio').value;
  const medico   = document.getElementById('ntMedico').value;
  const estado   = document.getElementById('ntEstado').value;
  const email    = document.getElementById('ntEmail').value.trim();
  const telefono = document.getElementById('ntTelefono').value.trim();
  const notas    = document.getElementById('ntNotas').value.trim();

  let valid = true;
  ntSetFieldError('ntNombre', nombre ? '' : 'El nombre es obligatorio');   if (!nombre) valid=false;
  ntSetFieldError('ntFecha',  fecha  ? '' : 'Seleccioná una fecha');       if (!fecha)  valid=false;
  ntSetFieldError('ntHora',   hora   ? '' : 'Indicá la hora del turno');   if (!hora)   valid=false;
  if (!valid) return;

  const btn = document.getElementById('ntSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Guardando…';

  try {
    const res = await API.req('POST', '/api/admin/turnos', { nombre, email, telefono, fecha, hora, servicio, medico, estado, notas });
    if (res.error) throw new Error(res.error);
    showToast('✓ Turno creado correctamente', 'success');
    closeNuevoTurnoModal();
    loadTurnos();
  } catch(err) {
    showToast('Error: '+(err.message||'Inténtalo de nuevo'), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✓ Crear turno';
  }
});

/* ══════════════════════════════════════════════════
   HISTORIAL DEL DÍA
══════════════════════════════════════════════════ */

const ESTADO_LABELS = {
  pendiente:  { label: 'Pendiente',  color: '#C47A1E' },
  confirmado: { label: 'Confirmado', color: '#1A6B3C' },
  completado: { label: 'Completado', color: '#1A5BA8' },
  cancelado:  { label: 'Cancelado',  color: '#A82A2A' },
};

async function loadHistorialHoy() {
  const lista   = document.getElementById('historialHoyLista');
  const fechaEl = document.getElementById('historialHoyFecha');
  if (!lista) return;
  lista.innerHTML = '<div style="text-align:center;padding:40px;color:var(--adm-muted)">Cargando...</div>';
  try {
    const data  = await API.getPacientesHoy();
    const items = data.data || [];
    const fecha = data.fecha || new Date().toISOString().slice(0,10);
    const [y,m,d] = fecha.split('-');
    if (fechaEl) fechaEl.textContent = `Turnos y historial clínico del día — ${d}/${m}/${y}`;

    if (!items.length) {
      lista.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:var(--adm-muted)">
          <svg viewBox="0 0 24 24" width="40" height="40" style="opacity:.3;margin-bottom:12px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
          <div style="font-size:15px;font-weight:500;margin-bottom:4px">Sin turnos hoy</div>
          <div style="font-size:13px">No hay turnos agendados para hoy.</div>
        </div>`;
      return;
    }

    lista.innerHTML = items.map(item => {
      const t = item.turno;
      const p = item.paciente;
      const est = ESTADO_LABELS[t.estado] || { label: t.estado || '—', color: '#888' };
      const historial    = (p.historialClinico || '').trim();
      const observaciones= (p.observaciones || '').trim();
      const medicacion   = (p.medicacion || '').trim();
      return `
        <div class="historial-card">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 18px;background:var(--adm-bg);border-bottom:1px solid var(--adm-border)">
            <div style="font-size:22px;font-weight:700;color:var(--adm-gold);min-width:52px;text-align:center;background:rgba(180,145,80,.1);border-radius:8px;padding:4px 10px">${escHtml(t.hora||'—')}</div>
            <div style="flex:1;min-width:160px">
              <div style="font-weight:600;font-size:15px;color:var(--adm-text)">${escHtml(p.nombre||'—')}</div>
              <div style="font-size:12px;color:var(--adm-muted);margin-top:2px">
                ${p.telefono ? '📞 '+escHtml(p.telefono) : ''}
                ${p.obrasocial ? ' · '+escHtml(p.obrasocial) : ''}
                ${p.dni ? ' · DNI '+escHtml(p.dni) : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${t.servicio ? `<span style="font-size:12px;background:rgba(100,120,160,.1);color:var(--adm-muted);border-radius:6px;padding:3px 10px">${escHtml(t.servicio)}</span>` : ''}
              <span style="font-size:12px;font-weight:600;border-radius:6px;padding:3px 10px;background:${est.color}22;color:${est.color}">${est.label}</span>
            </div>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
            ${historial ? `
            <div>
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--adm-muted);margin-bottom:6px">📋 Historial clínico</div>
              <div style="font-size:13px;line-height:1.65;color:var(--adm-text);background:var(--adm-bg);border-radius:8px;padding:12px 14px;border:1px solid var(--adm-border);white-space:pre-wrap;max-height:180px;overflow-y:auto">${escHtml(historial)}</div>
            </div>` : `<div style="font-size:13px;color:var(--adm-muted);font-style:italic">Sin historial clínico registrado.</div>`}
            ${observaciones ? `
            <div>
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--adm-muted);margin-bottom:6px">📝 Observaciones</div>
              <div style="font-size:13px;color:var(--adm-text);line-height:1.6;white-space:pre-wrap">${escHtml(observaciones)}</div>
            </div>` : ''}
            ${medicacion ? `
            <div>
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--adm-muted);margin-bottom:6px">💊 Medicación</div>
              <div style="font-size:13px;color:var(--adm-text);line-height:1.6">${escHtml(medicacion)}</div>
            </div>` : ''}
            ${t.notas ? `
            <div>
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--adm-muted);margin-bottom:6px">🗒️ Notas del turno</div>
              <div style="font-size:13px;color:var(--adm-text);line-height:1.6;font-style:italic">${escHtml(t.notas)}</div>
            </div>` : ''}
          </div>
        </div>`;
    }).join('');

  } catch(err) {
    lista.innerHTML = `<div style="text-align:center;padding:40px;color:var(--adm-muted)">Error al cargar: ${escHtml(err.message)}</div>`;
    showToast('Error historial: '+err.message, 'error');
  }
}

// ── TABLA DE TRABAJOS REALIZADOS ──────────────────────────────────────────
/* ── Cuenta corriente del paciente (Trabajos realizados) ──
   El saldo pasó a ser automático (acumulado de debe − haber).
   El valor que estuviera cargado a mano se conserva en `saldoManual`,
   así no se pierde ningún dato que ya estuviera escrito. */

function trabNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function trabMoneda(n) {
  return '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

// Saldo final de una lista de trabajos (usado también en la lista de pacientes)
function saldoDeTrabajos(trabajos) {
  if (!Array.isArray(trabajos)) return 0;
  return trabajos.reduce((acc, t) => acc + trabNum(t.debe) - trabNum(t.haber), 0);
}

function renderTrabajosTable(trabajos) {
  const tbody = document.getElementById('trabajosBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!trabajos || trabajos.length === 0) {
    addTrabajoRow(tbody, { fecha: '', trabajo: '', debe: '', haber: '', saldo: '' });
  } else {
    trabajos.forEach(t => addTrabajoRow(tbody, t));
  }
  recalcTrabajos();
}

function addTrabajoRow(tbody, data) {
  const tr = document.createElement('tr');
  // Conservamos lo que vino de la base para no perderlo nunca
  tr.dataset.saldoOrig   = data.saldo ?? '';
  tr.dataset.saldoManual = data.saldoManual ?? '';
  tr.innerHTML = `
    <td style="border:1px solid var(--adm-border);padding:4px 6px">
      <input type="date" value="${data.fecha||''}" class="trab-fecha" style="border:none;background:transparent;width:130px;color:var(--adm-text);font-size:13px">
    </td>
    <td style="border:1px solid var(--adm-border);padding:4px 6px">
      <input type="text" value="${escHtml(data.trabajo||'')}" class="trab-trabajo" placeholder="Descripción del trabajo" style="border:none;background:transparent;width:100%;color:var(--adm-text);font-size:13px">
    </td>
    <td style="border:1px solid var(--adm-border);padding:4px 6px">
      <input type="number" value="${data.debe||''}" class="trab-debe" placeholder="0" step="0.01" style="border:none;background:transparent;width:88px;text-align:right;color:var(--adm-text);font-size:13px">
    </td>
    <td style="border:1px solid var(--adm-border);padding:4px 6px">
      <input type="number" value="${data.haber||''}" class="trab-haber" placeholder="0" step="0.01" style="border:none;background:transparent;width:88px;text-align:right;color:var(--adm-text);font-size:13px">
    </td>
    <td class="trab-saldo-cell" style="border:1px solid var(--adm-border);padding:4px 10px;text-align:right;font-size:13px;font-weight:600;white-space:nowrap;background:var(--adm-surface-2)">—</td>
    <td style="border:1px solid var(--adm-border);padding:4px 6px;text-align:center">
      <button type="button" class="trab-del" style="background:none;border:none;color:var(--adm-muted);cursor:pointer;font-size:14px;line-height:1" title="Eliminar fila">✕</button>
    </td>
  `;
  tr.querySelector('.trab-del').addEventListener('click', () => { tr.remove(); recalcTrabajos(); });
  tr.querySelector('.trab-debe').addEventListener('input', recalcTrabajos);
  tr.querySelector('.trab-haber').addEventListener('input', recalcTrabajos);
  tbody.appendChild(tr);
}

function recalcTrabajos() {
  const tbody = document.getElementById('trabajosBody');
  if (!tbody) return;
  let acc = 0, totDebe = 0, totHaber = 0;
  tbody.querySelectorAll('tr').forEach(tr => {
    const d = trabNum(tr.querySelector('.trab-debe')?.value);
    const h = trabNum(tr.querySelector('.trab-haber')?.value);
    totDebe += d; totHaber += h; acc += d - h;
    const cell = tr.querySelector('.trab-saldo-cell');
    if (cell) {
      cell.textContent = (d || h || tr.dataset.saldoOrig) ? trabMoneda(acc) : '—';
      cell.style.color = acc > 0 ? 'var(--adm-red)' : acc < 0 ? 'var(--adm-sage)' : 'var(--adm-muted)';
    }
    tr.dataset.saldoCalc = acc.toFixed(2);
  });
  const setTot = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = trabMoneda(val);
    if (color) el.style.color = color;
  };
  setTot('trabTotDebe',  totDebe);
  setTot('trabTotHaber', totHaber);
  setTot('trabTotSaldo', acc, acc > 0 ? 'var(--adm-red)' : acc < 0 ? 'var(--adm-sage)' : 'var(--adm-text)');

  const res = document.getElementById('trabResumen');
  if (res) {
    res.innerHTML = acc > 0
      ? `<span class="trab-chip trab-chip--debe">El paciente debe ${trabMoneda(acc)}</span>`
      : acc < 0
        ? `<span class="trab-chip trab-chip--favor">Saldo a favor del paciente ${trabMoneda(-acc)}</span>`
        : `<span class="trab-chip trab-chip--ok">Cuenta al día</span>`;
  }
}

function getTrabajosData() {
  const tbody = document.getElementById('trabajosBody');
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll('tr')).map(tr => {
    const calc = tr.dataset.saldoCalc || '';
    // Si había un saldo escrito a mano que no coincide con el calculado,
    // lo guardamos aparte para no perderlo.
    let manual = tr.dataset.saldoManual || '';
    const orig = tr.dataset.saldoOrig || '';
    if (!manual && orig && Math.abs(trabNum(orig) - trabNum(calc)) > 0.009) manual = orig;
    const fila = {
      fecha:   tr.querySelector('.trab-fecha')?.value   || '',
      trabajo: tr.querySelector('.trab-trabajo')?.value || '',
      debe:    tr.querySelector('.trab-debe')?.value    || '',
      haber:   tr.querySelector('.trab-haber')?.value   || '',
      saldo:   calc,
    };
    if (manual) fila.saldoManual = manual;
    return fila;
  });
}

document.getElementById('agregarTrabajoBtn')?.addEventListener('click', () => {
  const tbody = document.getElementById('trabajosBody');
  if (tbody) { addTrabajoRow(tbody, { fecha:'', trabajo:'', debe:'', haber:'', saldo:'' }); recalcTrabajos(); }
});

/* ── Plan: traer las prestaciones pendientes del odontograma ── */
document.getElementById('planImportBtn')?.addEventListener('click', () => {
  const od = State._odontograma || {};
  const tipo = od._tipo || 'permanente';
  const set = OD_TEETH[tipo] || OD_TEETH.permanente;
  const lineas = [];
  for (const num of [...set.top, ...set.bot]) {
    for (const it of _odItemsDiente(num)) {
      if (it.estado !== 'p') continue;                 // solo lo que falta hacer
      lineas.push(`• Pieza ${num} — ${it.texto.replace(' — a realizar', '')}`);
    }
  }
  if (!lineas.length) {
    return showToast('No hay prestaciones marcadas como «a realizar» en el odontograma', 'default');
  }
  const ta = document.getElementById('pmHistorial');
  const bloque = `Prestaciones pendientes según odontograma (${new Date().toLocaleDateString('es-AR')}):\n` + lineas.join('\n');
  // Se agrega al final: nunca sobrescribe lo que ya estaba escrito
  ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n\n' + bloque : bloque;
  ta.focus();
  ta.scrollTop = ta.scrollHeight;
  showToast(`${lineas.length} prestación(es) agregadas al plan`, 'success');
});
