'use strict';

// Cargar variables de entorno desde .env (útil en desarrollo local)
require('dotenv').config({ path: __dirname + '/.env' });

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const { Pool }   = require('pg');
const { initReminders } = require('./reminders');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── JWT ───────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  ADVERTENCIA: JWT_SECRET no definido en .env. Usando valor por defecto — NO usar en producción.');
}
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ── CORS ──────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3001';
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigin === '*' || origin === allowedOrigin) return cb(null, true);
    cb(new Error('CORS: origen no permitido'));
  },
  credentials: true,
}));
app.use(express.json());

// ── Password hashing ──────────────────────────────
const PASS_PEPPER = process.env.PASS_PEPPER || 'amco_pepper_changeme_2026';
function hashPassword(plain) {
  const salt = 'amco_salt_v4_' + plain.length;
  return crypto.createHash('sha256').update(PASS_PEPPER + salt + plain).digest('hex');
}
function verifyPassword(plain, hashed) {
  return hashPassword(plain) === hashed;
}

// ── Static files ──────────────────────────────────
app.use(express.static(path.resolve(__dirname, '..')));
app.use(express.static(path.resolve(__dirname, '../public')));
app.use('/admin', express.static(path.resolve(__dirname, '../admin')));

// ── PostgreSQL ────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'false'
    ? false
    : process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : process.env.DATABASE_URL && process.env.DATABASE_URL.includes('proxy.rlwy.net')
        ? { rejectUnauthorized: false }   // URL pública → SSL sí
        : false,                           // URL interna → SSL no
});

// Si Postgres reinicia o corta una conexión inactiva, loguear y seguir.
// Sin este handler el evento 'error' no manejado tira abajo el proceso.
pool.on('error', (err) => {
  console.error('⚠️  PG pool: conexión perdida (se reconecta sola):', err.message);
});

// ── DB init — crea tablas si no existen ───────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        username    TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        hashed      BOOLEAN DEFAULT TRUE,
        role        TEXT DEFAULT 'admin',
        nombre      TEXT,
        medico      TEXT
      );

      CREATE TABLE IF NOT EXISTS turnos (
        id          SERIAL PRIMARY KEY,
        nombre      TEXT NOT NULL,
        email       TEXT DEFAULT '',
        telefono    TEXT DEFAULT '',
        fecha       TEXT NOT NULL,
        hora        TEXT NOT NULL,
        servicio    TEXT DEFAULT '',
        medico      TEXT DEFAULT '',
        estado      TEXT DEFAULT 'pendiente',
        notas       TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS pacientes (
        id                  SERIAL PRIMARY KEY,
        nombre              TEXT NOT NULL,
        email               TEXT DEFAULT '',
        telefono            TEXT DEFAULT '',
        fecha_nacimiento    TEXT DEFAULT '',
        dni                 TEXT DEFAULT '',
        observaciones       TEXT DEFAULT '',
        historial_clinico   TEXT DEFAULT '',
        estado_civil        TEXT DEFAULT '',
        profesion           TEXT DEFAULT '',
        direccion           TEXT DEFAULT '',
        obrasocial          TEXT DEFAULT '',
        indicacion          TEXT DEFAULT '',
        medicacion          TEXT DEFAULT '',
        trat_inicio         TEXT DEFAULT '',
        trat_termino        TEXT DEFAULT '',
        anamnesis           JSONB DEFAULT '{}',
        odontograma         JSONB DEFAULT '{}',
        credencial          TEXT DEFAULT '',
        titular             TEXT DEFAULT '',
        grupo_familiar      TEXT DEFAULT '',
        parentesco          TEXT DEFAULT '',
        edad                TEXT DEFAULT '',
        localidad           TEXT DEFAULT '',
        trabajo             TEXT DEFAULT '',
        rep_nombre          TEXT DEFAULT '',
        rep_domicilio       TEXT DEFAULT '',
        rep_dni             TEXT DEFAULT '',
        rep_relacion        TEXT DEFAULT '',
        ultima_consulta     TEXT DEFAULT '',
        medico_cabecera     TEXT DEFAULT '',
        tratamiento_medico  TEXT DEFAULT '',
        fecha_inicio_trat   TEXT DEFAULT '',
        trabajos            JSONB DEFAULT '[]',
        created_at          TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS analytics (
        id          SERIAL PRIMARY KEY,
        event       TEXT DEFAULT 'pageview',
        page        TEXT DEFAULT '',
        session_id  TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Migración segura: agregar columnas nuevas a pacientes si no existen
    // (para bases de datos ya creadas antes de esta versión)
    const newCols = [
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS credencial TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS titular TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS grupo_familiar TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS parentesco TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS edad TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS localidad TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS trabajo TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS rep_nombre TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS rep_domicilio TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS rep_dni TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS rep_relacion TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS ultima_consulta TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS medico_cabecera TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS tratamiento_medico TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS fecha_inicio_trat TEXT DEFAULT ''",
      "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS trabajos JSONB DEFAULT '[]'",
    ];
    for (const sql of newCols) {
      await client.query(sql);
    }

    // Insertar admin por defecto si no existe
    const exists = await client.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (exists.rows.length === 0) {
      await client.query(
        `INSERT INTO users (username, password, hashed, role, nombre, medico)
         VALUES ($1, $2, true, 'admin', 'Administrador', null)`,
        ['admin', hashPassword('1234')]
      );
      console.log('✅ Usuario admin creado (admin / 1234)');
    }
  } finally {
    client.release();
  }
}

// ── WhatsApp ──────────────────────────────────────
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
    `🌿 *AMCO \u00B7 Centro Odontol\u00F3gico*\n\n` +
    `Hola ${primerNombre}! Recibimos tu consulta \uD83D\uDE4C\n\n` +
    `\uD83E\uDDB7 *${servicio}*\n` +
    `\uD83D\uDCC5 ${fechaStr} \u00B7 ${turno.hora || '-'} hs\n\n` +
    `Te contactamos a la brevedad para confirmar el turno.\n` +
    `_AMCO \u00B7 Concordia, Entre R\u00EDos_`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;
}

// ── Auth ──────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inv\u00E1lido o expirado' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso solo para administradores' });
  next();
}

// Helper: mapear fila DB -> objeto turno (camelCase)
function mapTurno(row) {
  return {
    id:        row.id,
    nombre:    row.nombre,
    email:     row.email,
    telefono:  row.telefono,
    fecha:     row.fecha,
    hora:      row.hora,
    servicio:  row.servicio,
    medico:    row.medico,
    estado:    row.estado,
    notas:     row.notas,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function mapPaciente(row) {
  return {
    id:               row.id,
    nombre:           row.nombre,
    email:            row.email,
    telefono:         row.telefono,
    fechaNacimiento:  row.fecha_nacimiento,
    dni:              row.dni,
    observaciones:    row.observaciones,
    historialClinico: row.historial_clinico,
    estadoCivil:      row.estado_civil,
    profesion:        row.profesion,
    direccion:        row.direccion,
    obrasocial:       row.obrasocial,
    indicacion:       row.indicacion,
    medicacion:       row.medicacion,
    tratInicio:       row.trat_inicio,
    tratTermino:      row.trat_termino,
    anamnesis:        row.anamnesis,
    odontograma:      row.odontograma,
    // Campos ficha física
    credencial:       row.credencial,
    titular:          row.titular,
    grupoFamiliar:    row.grupo_familiar,
    parentesco:       row.parentesco,
    edad:             row.edad,
    localidad:        row.localidad,
    trabajo:          row.trabajo,
    repNombre:        row.rep_nombre,
    repDomicilio:     row.rep_domicilio,
    repDni:           row.rep_dni,
    repRelacion:      row.rep_relacion,
    ultimaConsulta:   row.ultima_consulta,
    medicoCabecera:   row.medico_cabecera,
    tratamientoMedico:row.tratamiento_medico,
    fechaInicioTrat:  row.fecha_inicio_trat,
    trabajos:         row.trabajos,
    createdAt:        row.created_at,
  };
}

// ═════════════════════════════════════════════════
//  RUTAS PUBLICAS
// ═════════════════════════════════════════════════

// LOGIN
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const user = result.rows[0];
    let valid = false;

    if (user.hashed) {
      valid = verifyPassword(password, user.password);
    } else {
      if (user.password === password) {
        valid = true;
        await pool.query(
          `UPDATE users SET password = $1, hashed = true WHERE id = $2`,
          [hashPassword(password), user.id]
        );
      }
    }

    if (!valid) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = jwt.sign(
      { username: user.username, role: user.role, medico: user.medico, nombre: user.nombre },
      SECRET, { expiresIn: '8h' }
    );
    res.json({ success: true, token, username: user.username, role: user.role, medico: user.medico, nombre: user.nombre });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// REGISTRO desde formulario publico (no crea turno en calendario)
app.post('/api/turnos', async (req, res) => {
  try {
    const { nombre, email = '', telefono = '', fecha, hora, servicio = '' } = req.body;
    if (!nombre || !fecha || !hora) return res.status(400).json({ error: 'nombre, fecha y hora son obligatorios' });
    const whatsappUrl = generarLinkWhatsApp({ nombre: nombre.trim(), email: email.trim(), telefono: telefono.trim(), fecha, hora, servicio });
    res.status(201).json({ success: true, ok: true, message: 'Datos recibidos correctamente. Un profesional se contactará para confirmar tu turno.', whatsappUrl });
  } catch (err) {
    console.error('POST /api/turnos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ANALYTICS TRACK (publico)
app.post('/api/analytics/track', async (req, res) => {
  try {
    const { event = 'pageview', page = '', session_id = '' } = req.body;
    await pool.query(
      `INSERT INTO analytics (event, page, session_id) VALUES ($1, $2, $3)`,
      [event, page, session_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Analytics track error:', err);
    res.json({ ok: true });
  }
});

// ═════════════════════════════════════════════════
//  RUTAS ADMIN (requieren JWT)
// ═════════════════════════════════════════════════

// CREAR TURNO MANUAL desde el admin
app.post('/api/admin/turnos', auth, async (req, res) => {
  try {
    const { nombre, email = '', telefono = '', fecha, hora, servicio = '', medico = '', estado = 'pendiente', notas = '' } = req.body;
    if (!nombre || !fecha || !hora) return res.status(400).json({ error: 'nombre, fecha y hora son obligatorios' });
    const result = await pool.query(
      `INSERT INTO turnos (nombre, email, telefono, fecha, hora, servicio, medico, estado, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [nombre.trim(), email.trim(), telefono.trim(), fecha, hora, servicio, medico, estado, notas.trim()]
    );
    const turnoId = result.rows[0].id;
    await autoRegistrarPaciente({ nombre: nombre.trim(), email: email.trim(), telefono: telefono.trim() });
    res.status(201).json({ success: true, ok: true, id: turnoId });
  } catch (err) {
    console.error('POST /api/admin/turnos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET TURNOS
app.get('/api/turnos', auth, async (req, res) => {
  try {
    const { vista = 'activos', search = '', from = '', to = '' } = req.query;
    let query = `SELECT * FROM turnos WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (req.user.role === 'doctor' && req.user.medico) {
      query += ` AND medico = $${idx++}`;
      params.push(req.user.medico);
    }
    if (vista === 'eliminados') {
      query += ` AND deleted_at IS NOT NULL`;
    } else {
      query += ` AND deleted_at IS NULL`;
    }
    if (search) {
      query += ` AND (LOWER(nombre) LIKE $${idx} OR LOWER(servicio) LIKE $${idx} OR LOWER(email) LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }
    if (from) { query += ` AND fecha >= $${idx++}`; params.push(from); }
    if (to)   { query += ` AND fecha <= $${idx++}`; params.push(to); }
    query += ` ORDER BY id DESC`;

    const result = await pool.query(query, params);
    res.json({ ok: true, data: result.rows.map(mapTurno) });
  } catch (err) {
    console.error('GET /api/turnos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH turno
app.patch('/api/turnos/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const turnoResult = await pool.query(`SELECT * FROM turnos WHERE id = $1`, [id]);
    if (turnoResult.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    const turno = turnoResult.rows[0];
    if (req.user.role === 'doctor' && turno.medico !== req.user.medico) {
      return res.status(403).json({ error: 'Sin permiso para editar este turno' });
    }
    const { estado, notas } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (estado !== undefined) { updates.push(`estado = $${idx++}`); params.push(estado); }
    if (notas  !== undefined) { updates.push(`notas  = $${idx++}`); params.push(notas); }
    if (updates.length === 0) return res.json({ success: true, ok: true });
    params.push(id);
    await pool.query(`UPDATE turnos SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ success: true, ok: true });
  } catch (err) {
    console.error('PATCH /api/turnos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE turno (soft)
app.delete('/api/turnos/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const turnoResult = await pool.query(`SELECT * FROM turnos WHERE id = $1`, [id]);
    if (turnoResult.rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado' });
    const turno = turnoResult.rows[0];
    if (req.user.role === 'doctor' && turno.medico !== req.user.medico) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    await pool.query(`UPDATE turnos SET deleted_at = NOW() WHERE id = $1`, [id]);
    res.json({ success: true, ok: true });
  } catch (err) {
    console.error('DELETE /api/turnos error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ═════════════════════════════════════════════════
//  PACIENTES
// ═════════════════════════════════════════════════

app.get('/api/pacientes/hoy', auth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    let turnosQuery = `SELECT * FROM turnos WHERE deleted_at IS NULL AND fecha = $1`;
    const params = [hoy];
    if (req.user.role === 'doctor' && req.user.medico) {
      turnosQuery += ` AND medico = $2`;
      params.push(req.user.medico);
    }
    turnosQuery += ` ORDER BY hora ASC`;
    const turnosResult = await pool.query(turnosQuery, params);
    const resultado = await Promise.all(turnosResult.rows.map(async (t) => {
      const pacResult = await pool.query(
        `SELECT * FROM pacientes WHERE LOWER(nombre) = LOWER($1) OR (email != '' AND LOWER(email) = LOWER($2)) LIMIT 1`,
        [t.nombre, t.email || '']
      );
      const p = pacResult.rows[0];
      return {
        turno: { id: t.id, hora: t.hora, servicio: t.servicio, estado: t.estado, notas: t.notas },
        paciente: p ? mapPaciente(p) : { nombre: t.nombre, email: t.email || '', telefono: t.telefono || '', historialClinico: '', observaciones: '' }
      };
    }));
    res.json({ ok: true, data: resultado, fecha: hoy });
  } catch (err) {
    console.error('GET /api/pacientes/hoy error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/pacientes', auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM pacientes ORDER BY id DESC`);
    res.json({ ok: true, data: result.rows.map(mapPaciente) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/pacientes', auth, adminOnly, async (req, res) => {
  try {
    const {
      nombre, email = '', telefono = '', fechaNacimiento = '', dni = '', observaciones = '',
      estadoCivil = '', profesion = '', direccion = '', obrasocial = '', indicacion = '',
      medicacion = '', tratInicio = '', tratTermino = '', anamnesis = {}, odontograma = {},
      credencial = '', titular = '', grupoFamiliar = '', parentesco = '', edad = '',
      localidad = '', trabajo = '', repNombre = '', repDomicilio = '', repDni = '',
      repRelacion = '', ultimaConsulta = '', medicoCabecera = '', tratamientoMedico = '',
      fechaInicioTrat = '', trabajos = [],
    } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const result = await pool.query(
      `INSERT INTO pacientes (nombre, email, telefono, fecha_nacimiento, dni, observaciones,
         estado_civil, profesion, direccion, obrasocial, indicacion, medicacion,
         trat_inicio, trat_termino, anamnesis, odontograma,
         credencial, titular, grupo_familiar, parentesco, edad, localidad, trabajo,
         rep_nombre, rep_domicilio, rep_dni, rep_relacion,
         ultima_consulta, medico_cabecera, tratamiento_medico, fecha_inicio_trat, trabajos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING id`,
      [nombre.trim(), email.trim(), telefono.trim(), fechaNacimiento.trim(), dni.trim(),
       observaciones.trim(), estadoCivil, profesion, direccion, obrasocial, indicacion,
       medicacion, tratInicio, tratTermino, JSON.stringify(anamnesis), JSON.stringify(odontograma),
       credencial, titular, grupoFamiliar, parentesco, edad, localidad, trabajo,
       repNombre, repDomicilio, repDni, repRelacion,
       ultimaConsulta, medicoCabecera, tratamientoMedico, fechaInicioTrat, JSON.stringify(trabajos)]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /api/pacientes error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.patch('/api/pacientes/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const check = await pool.query(`SELECT id FROM pacientes WHERE id = $1`, [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Paciente no encontrado' });
    const fieldMap = {
      nombre: 'nombre', email: 'email', telefono: 'telefono',
      fechaNacimiento: 'fecha_nacimiento', dni: 'dni',
      observaciones: 'observaciones', historialClinico: 'historial_clinico',
      estadoCivil: 'estado_civil', profesion: 'profesion', direccion: 'direccion',
      obrasocial: 'obrasocial', indicacion: 'indicacion', medicacion: 'medicacion',
      tratInicio: 'trat_inicio', tratTermino: 'trat_termino',
      anamnesis: 'anamnesis', odontograma: 'odontograma',
      // Campos ficha física
      credencial: 'credencial', titular: 'titular', grupoFamiliar: 'grupo_familiar',
      parentesco: 'parentesco', edad: 'edad', localidad: 'localidad', trabajo: 'trabajo',
      repNombre: 'rep_nombre', repDomicilio: 'rep_domicilio', repDni: 'rep_dni',
      repRelacion: 'rep_relacion', ultimaConsulta: 'ultima_consulta',
      medicoCabecera: 'medico_cabecera', tratamientoMedico: 'tratamiento_medico',
      fechaInicioTrat: 'fecha_inicio_trat', trabajos: 'trabajos',
    };
    const updates = []; const params = []; let idx = 1;
    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[jsKey] !== undefined) {
        updates.push(`${dbCol} = $${idx++}`);
        const val = req.body[jsKey];
        params.push(typeof val === 'object' ? JSON.stringify(val) : val);
      }
    }
    if (updates.length === 0) return res.json({ ok: true });
    params.push(id);
    await pool.query(`UPDATE pacientes SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/pacientes error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/pacientes/:id', auth, adminOnly, async (req, res) => {
  try {
    await pool.query(`DELETE FROM pacientes WHERE id = $1`, [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

async function autoRegistrarPaciente(turno) {
  try {
    const exists = await pool.query(
      `SELECT id FROM pacientes WHERE LOWER(nombre) = LOWER($1) OR (email != '' AND LOWER(email) = LOWER($2)) LIMIT 1`,
      [turno.nombre, turno.email || '']
    );
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO pacientes (nombre, email, telefono) VALUES ($1, $2, $3)`,
        [turno.nombre, turno.email || '', turno.telefono || '']
      );
    }
  } catch (err) {
    console.error('autoRegistrarPaciente error:', err);
  }
}

// ANALYTICS
app.get('/api/analytics', auth, adminOnly, async (req, res) => {
  try {
    const hoy   = new Date().toISOString().slice(0, 10);
    const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const [
      turnosTotal, turnosPend, turnosHoy, turnosSemana, eliminados,
      pageviewsRes, sessionsRes, ultimosTurnos,
      serviciosRes, visitasPorDia, turnosPorDia, eventosPop
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM turnos WHERE deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) FROM turnos WHERE deleted_at IS NULL AND estado = 'pendiente'`),
      pool.query(`SELECT COUNT(*) FROM turnos WHERE deleted_at IS NULL AND fecha = $1`, [hoy]),
      pool.query(`SELECT COUNT(*) FROM turnos WHERE deleted_at IS NULL AND created_at::date >= $1`, [hace7]),
      pool.query(`SELECT COUNT(*) FROM turnos WHERE deleted_at IS NOT NULL`),
      pool.query(`SELECT COUNT(*) FROM analytics WHERE event = 'pageview'`),
      pool.query(`SELECT COUNT(DISTINCT session_id) FROM analytics WHERE session_id != ''`),
      pool.query(`SELECT * FROM turnos WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 5`),
      pool.query(`SELECT servicio, COUNT(*) as total FROM turnos WHERE deleted_at IS NULL GROUP BY servicio ORDER BY total DESC`),
      pool.query(`SELECT created_at::date as dia, COUNT(*) as c FROM analytics WHERE event = 'pageview' AND created_at >= NOW() - INTERVAL '30 days' GROUP BY dia ORDER BY dia`),
      pool.query(`SELECT created_at::date as dia, COUNT(*) as c FROM turnos WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days' GROUP BY dia ORDER BY dia`),
      pool.query(`SELECT event, COUNT(*) as c FROM analytics GROUP BY event ORDER BY c DESC LIMIT 8`),
    ]);
    res.json({
      ok: true,
      data: {
        turnosTotal:   Number(turnosTotal.rows[0].count),
        turnosPend:    Number(turnosPend.rows[0].count),
        turnosHoy:     Number(turnosHoy.rows[0].count),
        turnosSemana:  Number(turnosSemana.rows[0].count),
        eliminados:    Number(eliminados.rows[0].count),
        pageviews:     Number(pageviewsRes.rows[0].count),
        sessions:      Number(sessionsRes.rows[0].count),
        ultimosTurnos: ultimosTurnos.rows.map(mapTurno),
        servicios:     serviciosRes.rows.map(r => ({ servicio: r.servicio || 'General', total: Number(r.total) })),
        visitasPorDia: visitasPorDia.rows.map(r => ({ dia: r.dia, c: Number(r.c) })),
        turnosPorDia:  turnosPorDia.rows.map(r => ({ dia: r.dia, c: Number(r.c) })),
        eventosPop:    eventosPop.rows.map(r => ({ event: r.event, c: Number(r.c) })),
      }
    });
  } catch (err) {
    console.error('GET /api/analytics error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// USUARIOS
app.get('/api/users', auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, hashed, role, nombre, medico FROM users ORDER BY id`);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  try {
    const { username, password, role = 'doctor', nombre, medico } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
    await pool.query(
      `INSERT INTO users (username, password, hashed, role, nombre, medico) VALUES ($1, $2, true, $3, $4, $5)`,
      [username, hashPassword(password), role, nombre || username, medico || null]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Usuario ya existe' });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.patch('/api/users/:username', auth, adminOnly, async (req, res) => {
  try {
    const { nombre, password } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (nombre !== undefined && String(nombre).trim() !== '') {
      updates.push(`nombre = $${idx++}`);
      params.push(String(nombre).trim());
    }
    if (password !== undefined && String(password).trim() !== '') {
      updates.push(`password = $${idx++}`, `hashed = true`);
      params.push(hashPassword(String(password).trim()));
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para actualizar' });
    params.push(req.params.username);
    const r = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE username = $${idx} RETURNING id`, params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/users error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/users/:username', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.username === 'admin') return res.status(400).json({ error: 'No se puede eliminar al admin' });
    await pool.query(`DELETE FROM users WHERE username = $1`, [req.params.username]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Auto-completar turnos pasados ─────────────────
// Un turno confirmado cuya fecha/hora ya pasó (con 1 h de gracia)
// se marca automáticamente como completado. Los pendientes y
// cancelados no se tocan.
async function autoCompletarTurnos() {
  try {
    // Hora de Argentina (UTC-3) menos 60 minutos de gracia
    const d = new Date(Date.now() - 3 * 3600 * 1000 - 60 * 60 * 1000);
    const fecha = d.toISOString().slice(0, 10);  // YYYY-MM-DD
    const hora  = d.toISOString().slice(11, 16); // HH:MM
    const r = await pool.query(
      `UPDATE turnos SET estado = 'completado'
       WHERE deleted_at IS NULL AND estado = 'confirmado'
         AND (fecha < $1 OR (fecha = $1 AND hora <= $2))
       RETURNING id`,
      [fecha, hora]
    );
    if (r.rows.length > 0) console.log(`✅ ${r.rows.length} turno(s) pasados marcados como completados`);
  } catch (err) {
    console.error('autoCompletarTurnos error:', err.message);
  }
}

// ── Rutas HTML ────────────────────────────────────
app.get('/admin*', (req, res) => res.sendFile(path.resolve(__dirname, '../admin/index.html')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../index.html')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.send('AMCO running');
});

// ── Arranque ──────────────────────────────────────
async function start() {
  try {
    await initDB();
    initReminders(pool).catch(err => console.error('Reminders init error:', err.message));
    autoCompletarTurnos();                                    // primera pasada al arrancar
    setInterval(autoCompletarTurnos, 30 * 60 * 1000);         // luego cada 30 minutos
    app.listen(PORT, () => {
      console.log(`\n🦷  AMCO -> http://localhost:${PORT}`);
      console.log(`🔒  Admin -> http://localhost:${PORT}/admin\n`);
      console.log('  admin / 1234  (administrador)');
    });
  } catch (err) {
    console.error('❌ Error al iniciar el servidor:', err);
    process.exit(1);
  }
}

start();
