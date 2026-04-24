'use strict';

const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');

const app    = express();
const PORT   = process.env.PORT || 3001;

// JWT_SECRET DEBE ser seteado en variable de entorno en producción
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  ADVERTENCIA: JWT_SECRET no definido en .env. Usando valor por defecto — NO usar en producción.');
}
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// CORS — solo permite el origen configurado (o localhost en dev)
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3001';
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin origin (ej: curl, Postman, apps móviles en dev)
    if (!origin || allowedOrigin === '*' || origin === allowedOrigin) return cb(null, true);
    cb(new Error('CORS: origen no permitido'));
  },
  credentials: true,
}));
app.use(express.json());

// ── Hashing de contraseñas (SHA-256 + salt fijo + salt por contraseña) ──────
// Nota: en producción se recomienda bcrypt. Esto requiere solo módulos nativos de Node.
const PASS_PEPPER = process.env.PASS_PEPPER || 'amco_pepper_changeme_2026';
function hashPassword(plain) {
  const salt = 'amco_salt_v4_' + plain.length;
  return crypto.createHash('sha256').update(PASS_PEPPER + salt + plain).digest('hex');
}
function verifyPassword(plain, hashed) {
  return hashPassword(plain) === hashed;
}

app.use(express.static(path.resolve(__dirname, '../public')));
app.use('/admin', express.static(path.resolve(__dirname, '../admin')));

// ── DB ────────────────────────────────────────────
const dbPath = path.join(__dirname, 'db.json');

function readDB() {
  if (!fs.existsSync(dbPath)) {
    const init = {
      turnos: [], analytics: [], pacientes: [],
      users: [{ username: 'admin', password: hashPassword('1234'), hashed: true, role: 'admin', nombre: 'Administrador', medico: null }]
    };
    fs.writeFileSync(dbPath, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    db.users = (db.users || []).map(u => ({
      username: u.username || u.user,
      password: u.password || u.pass,
      hashed:   u.hashed   || false,
      role:     u.role     || 'admin',
      nombre:   u.nombre   || u.username,
      medico:   u.medico   || null
    }));
    if (!db.analytics) db.analytics = [];
    if (!db.pacientes) db.pacientes = [];
    return db;
  } catch {
    return { turnos: [], analytics: [], users: [] };
  }
}

function writeDB(d) {
  fs.writeFileSync(dbPath, JSON.stringify(d, null, 2));
}

// ── WhatsApp ───────────────────────────────────────
// Número con código de país Argentina (54) + número sin el 0 inicial
const WHATSAPP_NUMBER = '5493455287370';

function generarLinkWhatsApp(turno) {
  const nombre       = turno.nombre   || '-';
  const primerNombre = nombre.split(' ')[0];
  const servicio     = turno.servicio || 'Consulta general';

  let fechaStr = turno.fecha || '-';
  if (turno.fecha && turno.fecha.includes('-')) {
    const [y, m, d] = turno.fecha.split('-');
    fechaStr = `${d}/${m}/${y}`;
  }

  const mensaje =
    `🪷 *AMCO · Centro Odontológico*\n\n` +
    `Hola ${primerNombre}! Recibimos tu consulta 🙌\n\n` +
    `🦷 *${servicio}*\n` +
    `📅 ${fechaStr} · ${turno.hora || '-'} hs\n\n` +
    `Te contactamos a la brevedad para confirmar el turno.\n` +
    `_AMCO · Concordia, Entre Ríos_`;

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;
}
function enviarMails(turno) {
  generarLinkWhatsApp(turno);
}

// ── Auth ──────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Solo admin puede acceder
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso solo para administradores' });
  next();
}

// ══════════════════════════════════════════════════
//  RUTAS PÚBLICAS
// ══════════════════════════════════════════════════

// LOGIN — devuelve role y medico para que el front sepa qué mostrar
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const db   = readDB();
  const user = db.users.find(u => {
    if (u.username !== username) return false;
    // Soporte de contraseñas hasheadas y legacy (texto plano) durante migración
    if (u.hashed) return verifyPassword(password, u.password);
    // Contraseña legacy en texto plano → comparar y migrar al vuelo
    if (u.password === password) {
      u.password = hashPassword(password);
      u.hashed   = true;
      writeDB(db);
      return true;
    }
    return false;
  });
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign(
    { username: user.username, role: user.role, medico: user.medico, nombre: user.nombre },
    SECRET, { expiresIn: '8h' }
  );
  res.json({ success: true, token, username: user.username, role: user.role, medico: user.medico, nombre: user.nombre });
});

// REGISTRO DE PACIENTE desde formulario público (NO crea turno en calendario)
app.post('/api/turnos', (req, res) => {
  const { nombre, email = '', telefono = '', fecha, hora, servicio = '', medico = '' } = req.body;
  if (!nombre || !fecha || !hora) return res.status(400).json({ error: 'nombre, fecha y hora son obligatorios' });

  // Solo registrar al paciente, sin guardar turno en el calendario
  const datosContacto = {
    nombre: nombre.trim(),
    email:  email.trim(),
    telefono: telefono.trim(),
    // Guardamos la preferencia de fecha/hora/servicio en observaciones
    observaciones: `Consulta solicitada: ${servicio || 'General'} — ${fecha} ${hora}hs`,
  };
  autoRegistrarPaciente(datosContacto);

  // Generar link de WhatsApp igual que antes
  const whatsappUrl = generarLinkWhatsApp({ nombre: nombre.trim(), email: email.trim(), telefono: telefono.trim(), fecha, hora, servicio });
  res.status(201).json({ success: true, ok: true, message: 'Datos recibidos correctamente. Un profesional se contactará para confirmar tu turno.', whatsappUrl });
});


// CREAR TURNO MANUAL desde el admin (requiere JWT)
app.post("/api/admin/turnos", auth, (req, res) => {
  const { nombre, email = "", telefono = "", fecha, hora, servicio = "", medico = "", estado = "pendiente", notas = "" } = req.body;
  if (!nombre || !fecha || !hora) return res.status(400).json({ error: "nombre, fecha y hora son obligatorios" });
  const db = readDB();
  const turno = {
    id: Date.now(),
    nombre: nombre.trim(), email: email.trim(), telefono: telefono.trim(),
    fecha, hora, servicio, medico, estado, notas: notas.trim(),
    createdAt: new Date().toISOString(), deletedAt: null
  };
  db.turnos.push(turno);
  writeDB(db);
  autoRegistrarPaciente(turno);
  res.status(201).json({ success: true, ok: true, id: turno.id });
});
// ANALYTICS TRACK (público)
app.post('/api/analytics/track', (req, res) => {
  const { event = 'pageview', page = '', session_id = '' } = req.body;
  const db = readDB();
  db.analytics.push({ event, page, session_id, createdAt: new Date().toISOString() });
  writeDB(db);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
//  RUTAS ADMIN (requieren JWT)
// ══════════════════════════════════════════════════

// GET TURNOS — admin ve todos, doctor solo los suyos
app.get('/api/turnos', auth, (req, res) => {
  const { vista = 'activos', search = '', from = '', to = '' } = req.query;
  let lista = readDB().turnos || [];

  // Filtrar por médico si es doctor
  if (req.user.role === 'doctor' && req.user.medico) {
    lista = lista.filter(t => t.medico === req.user.medico);
  }

  if (vista === 'eliminados') lista = lista.filter(t => !!t.deletedAt);
  else                        lista = lista.filter(t => !t.deletedAt);

  if (search) {
    const q = search.toLowerCase();
    lista = lista.filter(t =>
      (t.nombre   || '').toLowerCase().includes(q) ||
      (t.servicio || '').toLowerCase().includes(q) ||
      (t.email    || '').toLowerCase().includes(q)
    );
  }
  if (from) lista = lista.filter(t => (t.fecha || '') >= from);
  if (to)   lista = lista.filter(t => (t.fecha || '') <= to);

  res.json({ ok: true, data: [...lista].reverse() });
});

// PATCH turno
app.patch('/api/turnos/:id', auth, (req, res) => {
  const db  = readDB();
  const id  = Number(req.params.id);
  const idx = db.turnos.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Turno no encontrado' });
  // Doctor solo puede editar sus propios turnos
  if (req.user.role === 'doctor' && db.turnos[idx].medico !== req.user.medico) {
    return res.status(403).json({ error: 'Sin permiso para editar este turno' });
  }
  const { estado, notas } = req.body;
  if (estado !== undefined) db.turnos[idx].estado = estado;
  if (notas  !== undefined) db.turnos[idx].notas  = notas;
  writeDB(db);
  res.json({ success: true, ok: true });
});

// DELETE turno (soft)
app.delete('/api/turnos/:id', auth, (req, res) => {
  const db  = readDB();
  const id  = Number(req.params.id);
  const idx = db.turnos.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Turno no encontrado' });
  if (req.user.role === 'doctor' && db.turnos[idx].medico !== req.user.medico) {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  db.turnos[idx].deletedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true, ok: true });
});

// ══════════════════════════════════════════════════
//  PACIENTES
// ══════════════════════════════════════════════════

// GET pacientes con turno HOY — accesible para doctores y admins
app.get('/api/pacientes/hoy', auth, (req, res) => {
  const db = readDB();
  const hoy = new Date().toISOString().slice(0, 10);
  let turnos = (db.turnos || []).filter(t => !t.deletedAt && t.fecha === hoy);

  // Doctor solo ve sus propios turnos
  if (req.user.role === 'doctor' && req.user.medico) {
    turnos = turnos.filter(t => t.medico === req.user.medico);
  }

  const pacientes = db.pacientes || [];
  // Para cada turno, buscar el paciente correspondiente
  const resultado = turnos.map(t => {
    const paciente = pacientes.find(p =>
      p.nombre.toLowerCase() === t.nombre.toLowerCase() ||
      (t.email && p.email && p.email.toLowerCase() === t.email.toLowerCase())
    );
    return {
      turno: { id: t.id, hora: t.hora, servicio: t.servicio, estado: t.estado, notas: t.notas },
      paciente: paciente ? {
        id: paciente.id,
        nombre: paciente.nombre,
        email: paciente.email || '',
        telefono: paciente.telefono || '',
        fechaNacimiento: paciente.fechaNacimiento || '',
        dni: paciente.dni || '',
        obrasocial: paciente.obrasocial || '',
        historialClinico: paciente.historialClinico || '',
        observaciones: paciente.observaciones || '',
        medicacion: paciente.medicacion || '',
      } : {
        nombre: t.nombre,
        email: t.email || '',
        telefono: t.telefono || '',
        historialClinico: '',
        observaciones: '',
      }
    };
  }).sort((a, b) => (a.turno.hora || '').localeCompare(b.turno.hora || ''));

  res.json({ ok: true, data: resultado, fecha: hoy });
});

// GET todos los pacientes
app.get('/api/pacientes', auth, adminOnly, (req, res) => {
  const db = readDB();
  res.json({ ok: true, data: db.pacientes || [] });
});

// POST crear paciente manualmente
app.post('/api/pacientes', auth, adminOnly, (req, res) => {
  const { nombre, email = '', telefono = '', fechaNacimiento = '', dni = '', observaciones = '',
          estadoCivil = '', profesion = '', direccion = '', obrasocial = '', indicacion = '',
          medicacion = '', tratInicio = '', tratTermino = '', anamnesis = {}, odontograma = {} } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const db = readDB();
  if (!db.pacientes) db.pacientes = [];
  const paciente = {
    id:              Date.now(),
    nombre:          nombre.trim(),
    email:           email.trim(),
    telefono:        telefono.trim(),
    fechaNacimiento: fechaNacimiento.trim(),
    dni:             dni.trim(),
    observaciones:   observaciones.trim(),
    historialClinico: '',
    estadoCivil, profesion, direccion, obrasocial, indicacion,
    medicacion, tratInicio, tratTermino, anamnesis, odontograma,
    createdAt:       new Date().toISOString(),
  };
  db.pacientes.push(paciente);
  writeDB(db);
  res.status(201).json({ ok: true, id: paciente.id });
});

// PATCH editar paciente (datos + historial clínico)
app.patch('/api/pacientes/:id', auth, adminOnly, (req, res) => {
  const db  = readDB();
  if (!db.pacientes) db.pacientes = [];
  const id  = Number(req.params.id);
  const idx = db.pacientes.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Paciente no encontrado' });
  const allowed = ['nombre','email','telefono','fechaNacimiento','dni','observaciones','historialClinico',
                   'estadoCivil','profesion','direccion','obrasocial','indicacion','medicacion',
                   'tratInicio','tratTermino','anamnesis','odontograma'];
  allowed.forEach(k => { if (req.body[k] !== undefined) db.pacientes[idx][k] = req.body[k]; });
  writeDB(db);
  res.json({ ok: true });
});

// DELETE paciente
app.delete('/api/pacientes/:id', auth, adminOnly, (req, res) => {
  const db  = readDB();
  if (!db.pacientes) db.pacientes = [];
  const id  = Number(req.params.id);
  db.pacientes = db.pacientes.filter(p => p.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ── Al crear un turno, auto-registrar paciente si no existe ──
// (esto se llama dentro del POST /api/turnos ya existente)
function autoRegistrarPaciente(turno) {
  const db = readDB();
  if (!db.pacientes) db.pacientes = [];
  const existe = db.pacientes.find(p =>
    p.nombre.toLowerCase() === turno.nombre.toLowerCase() ||
    (turno.email && p.email && p.email.toLowerCase() === turno.email.toLowerCase())
  );
  if (!existe) {
    db.pacientes.push({
      id:               Date.now() + Math.floor(Math.random() * 1000),
      nombre:           turno.nombre,
      email:            turno.email || '',
      telefono:         turno.telefono || '',
      fechaNacimiento:  '',
      dni:              '',
      observaciones:    '',
      historialClinico: '',
      createdAt:        new Date().toISOString(),
    });
    writeDB(db);
  }
}

// ANALYTICS — solo admin
app.get('/api/analytics', auth, adminOnly, (req, res) => {
  const db = readDB();
  const tr = db.turnos    || [];
  const ev = db.analytics || [];
  const hoy   = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const activos = tr.filter(t => !t.deletedAt);
  const pageviews    = ev.filter(e => e.event === 'pageview').length;
  const sessions     = new Set(ev.filter(e => e.session_id).map(e => e.session_id)).size;
  const turnosSemana = activos.filter(t => (t.createdAt || '').slice(0, 10) >= hace7).length;
  const svcMap = {};
  activos.forEach(t => { const s = t.servicio || 'General'; svcMap[s] = (svcMap[s] || 0) + 1; });
  const servicios = Object.entries(svcMap).map(([servicio, total]) => ({ servicio, total })).sort((a, b) => b.total - a.total);
  const vDia = {};
  ev.filter(e => e.event === 'pageview').forEach(e => { const d = (e.createdAt||'').slice(0,10); if(d) vDia[d]=(vDia[d]||0)+1; });
  const visitasPorDia = Object.entries(vDia).map(([dia,c])=>({dia,c})).sort((a,b)=>a.dia.localeCompare(b.dia)).slice(-30);
  const tDia = {};
  activos.forEach(t => { const d = (t.createdAt||'').slice(0,10); if(d) tDia[d]=(tDia[d]||0)+1; });
  const turnosPorDia = Object.entries(tDia).map(([dia,c])=>({dia,c})).sort((a,b)=>a.dia.localeCompare(b.dia)).slice(-30);
  const evMap = {};
  ev.forEach(e => { evMap[e.event]=(evMap[e.event]||0)+1; });
  const eventosPop = Object.entries(evMap).map(([event,c])=>({event,c})).sort((a,b)=>b.c-a.c).slice(0,8);
  res.json({
    ok: true,
    data: {
      turnosTotal: activos.length,
      turnosPend:  activos.filter(t=>t.estado==='pendiente').length,
      turnosHoy:   activos.filter(t=>(t.fecha||'')===hoy).length,
      turnosSemana, eliminados: tr.filter(t=>!!t.deletedAt).length,
      pageviews, sessions,
      ultimosTurnos: [...tr].reverse().slice(0,5),
      servicios, visitasPorDia, turnosPorDia, eventosPop
    }
  });
});

// USUARIOS — solo admin
app.get('/api/users', auth, adminOnly, (req, res) => {
  const users = readDB().users.map(({ password, ...u }) => u);
  res.json({ ok: true, data: users });
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, role = 'doctor', nombre, medico } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  const db = readDB();
  if (db.users.find(u => u.username === username)) return res.status(400).json({ error: 'Usuario ya existe' });
  db.users.push({ username, password: hashPassword(password), hashed: true, role, nombre: nombre || username, medico: medico || null });
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
  if (req.params.username === 'admin') return res.status(400).json({ error: 'No se puede eliminar al admin' });
  const db = readDB();
  db.users = db.users.filter(u => u.username !== req.params.username);
  writeDB(db);
  res.json({ ok: true });
});

app.get('/admin*', (req, res) => res.sendFile(path.resolve(__dirname, '../admin/index.html')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../public/index.html')));

app.listen(PORT, () => {
  console.log(`\n🦷  AMCO → http://localhost:${PORT}`);
  console.log(`🔒  Admin → http://localhost:${PORT}/admin\n`);
  console.log('  admin / 1234  (administrador)');
  console.log('  jperez / perez123  (Dr. Juan Pérez)');
  console.log('  alopez / lopez123  (Dra. Ana López)');
  console.log('  cdiaz / diaz123   (Dr. Carlos Díaz)\n');
});


app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.send("AMCO running");
});
