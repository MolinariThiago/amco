/**
 * AMCO — Script de migración db.json → PostgreSQL
 * 
 * Uso: DATABASE_URL=postgres://... node backend/migrate-from-json.js
 * 
 * Importa todos los datos existentes de db.json a la base de datos PostgreSQL.
 * Ejecutar UNA SOLA VEZ luego del primer deploy.
 */
'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
});

const dbPath = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbPath)) {
  console.log('No se encontró db.json — nada que migrar.');
  process.exit(0);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Iniciando migración...');

    // Users
    const users = (db.users || []).map(u => ({
      username: u.username || u.user,
      password: u.password || u.pass,
      hashed:   u.hashed   || false,
      role:     u.role     || 'admin',
      nombre:   u.nombre   || u.username,
      medico:   u.medico   || null,
    }));
    for (const u of users) {
      await client.query(
        `INSERT INTO users (username, password, hashed, role, nombre, medico)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (username) DO UPDATE SET
           password=$2, hashed=$3, role=$4, nombre=$5, medico=$6`,
        [u.username, u.password, u.hashed, u.role, u.nombre, u.medico]
      );
    }
    console.log(`✅ ${users.length} usuarios migrados`);

    // Turnos
    const turnos = db.turnos || [];
    for (const t of turnos) {
      await client.query(
        `INSERT INTO turnos (id, nombre, email, telefono, fecha, hora, servicio, medico, estado, notas, created_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.nombre, t.email||'', t.telefono||'', t.fecha, t.hora,
         t.servicio||'', t.medico||'', t.estado||'pendiente', t.notas||'',
         t.createdAt||new Date().toISOString(), t.deletedAt||null]
      );
    }
    // Reset sequence
    if (turnos.length > 0) {
      const maxId = Math.max(...turnos.map(t => Number(t.id)));
      await client.query(`SELECT setval('turnos_id_seq', $1)`, [maxId]);
    }
    console.log(`✅ ${turnos.length} turnos migrados`);

    // Pacientes
    const pacientes = db.pacientes || [];
    for (const p of pacientes) {
      await client.query(
        `INSERT INTO pacientes (id, nombre, email, telefono, fecha_nacimiento, dni, observaciones,
           historial_clinico, estado_civil, profesion, direccion, obrasocial, indicacion,
           medicacion, trat_inicio, trat_termino, anamnesis, odontograma, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.nombre, p.email||'', p.telefono||'', p.fechaNacimiento||'', p.dni||'',
         p.observaciones||'', p.historialClinico||'', p.estadoCivil||'', p.profesion||'',
         p.direccion||'', p.obrasocial||'', p.indicacion||'', p.medicacion||'',
         p.tratInicio||'', p.tratTermino||'',
         JSON.stringify(p.anamnesis||{}), JSON.stringify(p.odontograma||{}),
         p.createdAt||new Date().toISOString()]
      );
    }
    if (pacientes.length > 0) {
      const maxId = Math.max(...pacientes.map(p => Number(p.id)));
      await client.query(`SELECT setval('pacientes_id_seq', $1)`, [maxId]);
    }
    console.log(`✅ ${pacientes.length} pacientes migrados`);

    // Analytics (puede ser grande — insertar en lotes)
    const analytics = db.analytics || [];
    const BATCH = 100;
    for (let i = 0; i < analytics.length; i += BATCH) {
      const batch = analytics.slice(i, i + BATCH);
      for (const a of batch) {
        await client.query(
          `INSERT INTO analytics (event, page, session_id, created_at) VALUES ($1,$2,$3,$4)`,
          [a.event||'pageview', a.page||'', a.session_id||'', a.createdAt||new Date().toISOString()]
        );
      }
    }
    console.log(`✅ ${analytics.length} eventos de analytics migrados`);

    console.log('\n🎉 Migración completada exitosamente!');
  } catch (err) {
    console.error('❌ Error durante la migración:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
