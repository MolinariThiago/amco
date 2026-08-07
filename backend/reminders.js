'use strict';

// ─────────────────────────────────────────────────────────────────
//  AMCO — Recordatorios de turnos (email vía Resend + WhatsApp vía
//  API oficial de Meta / WhatsApp Business Cloud).
//
//  Diseño seguro para producción:
//   · Si faltan las variables de entorno, el módulo queda inactivo
//     y no cambia nada del comportamiento del servidor.
//   · La migración solo AGREGA columnas (IF NOT EXISTS) — nunca
//     modifica ni borra datos existentes.
//   · Cada turno se "reclama" de forma atómica antes de enviar,
//     así un recordatorio jamás se envía dos veces.
//   · Todo está envuelto en try/catch: un fallo de envío nunca
//     tira abajo el servidor.
// ─────────────────────────────────────────────────────────────────

const RESEND_API_KEY  = process.env.RESEND_API_KEY  || '';
const RESEND_FROM     = process.env.RESEND_FROM     || 'AMCO Centro Odontológico <turnos@amcoodontologia.com.ar>';
const WA_TOKEN        = process.env.WHATSAPP_TOKEN  || '';
const WA_PHONE_ID     = process.env.WHATSAPP_PHONE_ID || '';
const WA_TEMPLATE     = process.env.WHATSAPP_TEMPLATE || 'recordatorio_turno';
const WA_TEMPLATE_LANG= process.env.WHATSAPP_TEMPLATE_LANG || 'es_AR';

// Hora (de Argentina) a partir de la cual se envía cada tanda
const HORA_ENVIO_24H  = Number(process.env.REMINDER_HORA_24H || 10); // recordatorio "mañana tenés turno"
const HORA_ENVIO_DIA  = Number(process.env.REMINDER_HORA_DIA || 8);  // recordatorio "hoy tenés turno"

const EMAIL_ON = !!RESEND_API_KEY;
const WA_ON    = !!(WA_TOKEN && WA_PHONE_ID);

// Los pacientes se cargan como «Apellido, Nombre», así que partir por el
// espacio devolvía el apellido con la coma pegada: «Hola Arias,!». Sirve para
// los dos órdenes — «Arias, María» y «María Arias» — porque los turnos que
// entran por el formulario público vienen con el nombre como lo escribe el
// paciente.
function primerNombre(completo) {
  const n = String(completo || '').trim();
  if (!n) return '';
  const trasComa = n.includes(',') ? n.slice(n.indexOf(',') + 1).trim() : n;
  return (trasComa.split(/\s+/)[0] || '').replace(/,$/, '');
}

// ── Fecha/hora de Argentina (UTC-3, sin horario de verano) ──
function ahoraArg() {
  return new Date(Date.now() - 3 * 3600 * 1000);
}
function fechaArg(diasOffset = 0) {
  return new Date(Date.now() - 3 * 3600 * 1000 + diasOffset * 86400 * 1000)
    .toISOString().slice(0, 10); // YYYY-MM-DD
}
function horaArg() {
  return ahoraArg().getUTCHours();
}
function fechaBonita(iso) {
  if (!iso || !iso.includes('-')) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ── Normalizar teléfono argentino a formato internacional ──
// "345 528-7370" → "5493455287370"
function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('549')) return d;
  if (d.startsWith('54'))  return '549' + d.slice(2);
  if (d.startsWith('0'))   d = d.slice(1);          // 0345... → 345...
  if (d.length < 8)        return null;             // demasiado corto para ser válido
  return '549' + d;
}

// ── Envío de email vía Resend ──
async function enviarEmail(turno, esMismoDia) {
  if (!EMAIL_ON || !turno.email) return false;
  const cuando  = esMismoDia ? 'HOY' : 'MAÑANA';
  const fecha   = fechaBonita(turno.fecha);
  const asunto  = esMismoDia
    ? `🦷 Recordatorio: tu turno en AMCO es hoy a las ${turno.hora} hs`
    : `🦷 Recordatorio: tenés turno en AMCO mañana ${fecha}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e6e6eb;border-radius:12px;overflow:hidden">
      <div style="background:#0E0E13;padding:26px;text-align:center">
        <div style="color:#fff;font-size:22px;letter-spacing:6px;font-weight:700">AMCO</div>
        <div style="color:#C9A96E;font-size:11px;letter-spacing:2px;margin-top:4px">CENTRO ODONTOL&Oacute;GICO</div>
      </div>
      <div style="padding:28px;color:#1A1A1E">
        <p style="font-size:16px;margin:0 0 14px">Hola <strong>${primerNombre(turno.nombre)}</strong> 👋</p>
        <p style="font-size:14px;margin:0 0 18px">Te recordamos que <strong>${cuando}</strong> ten&eacute;s un turno con nosotros:</p>
        <div style="background:#FAFAFA;border:1px solid #e6e6eb;border-radius:10px;padding:16px 20px;margin-bottom:18px">
          <p style="margin:4px 0;font-size:14px">📅 <strong>${fecha}</strong></p>
          <p style="margin:4px 0;font-size:14px">🕐 <strong>${turno.hora} hs</strong></p>
          ${turno.servicio ? `<p style="margin:4px 0;font-size:14px">🦷 ${turno.servicio}</p>` : ''}
        </div>
        <p style="font-size:13px;color:#6C6C73;margin:0 0 6px">📍 Hip&oacute;lito Yrigoyen 1293, Concordia, Entre R&iacute;os</p>
        <p style="font-size:13px;color:#6C6C73;margin:0">Si no pod&eacute;s asistir, avisanos al <a href="tel:+543454216043" style="color:#A87C42">(0345)&nbsp;421&nbsp;6043</a> o por <a href="https://wa.me/5493455287370" style="color:#A87C42">WhatsApp</a>.</p>
      </div>
      <div style="background:#F4F4F7;padding:14px;text-align:center;font-size:11px;color:#A0A0A8">
        <p style="margin:0 0 6px">Este es un mensaje autom&aacute;tico — por favor no respondas a este email. Para contactarnos, llamanos o escribinos por WhatsApp.</p>
        AMCO &middot; Centro Odontol&oacute;gico &middot; Concordia, Entre R&iacute;os
      </div>
    </div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [turno.email], subject: asunto, html }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`✉️  Resend error (turno #${turno.id}):`, res.status, err.slice(0, 300));
    return false;
  }
  return true;
}

// ── Envío de WhatsApp vía API oficial de Meta (plantilla aprobada) ──
// La plantilla debe tener 3 variables: {{1}} nombre, {{2}} "hoy 29/07" / "mañana 30/07", {{3}} hora
async function enviarWhatsApp(turno, esMismoDia) {
  if (!WA_ON) return false;
  const to = normalizarTelefono(turno.telefono);
  if (!to) return false;
  const cuando = `${esMismoDia ? 'hoy' : 'mañana'} ${fechaBonita(turno.fecha)}`;
  const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: WA_TEMPLATE,
        language: { code: WA_TEMPLATE_LANG },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: primerNombre(turno.nombre) || 'paciente' },
            { type: 'text', text: cuando },
            { type: 'text', text: `${turno.hora} hs` },
          ],
        }],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`📲 WhatsApp error (turno #${turno.id}, ${to}):`, res.status, err.slice(0, 300));
    return false;
  }
  return true;
}

// ── Procesar una tanda (24h antes o mismo día) ──
async function procesarTanda(pool, columna, fecha, esMismoDia) {
  // Buscar turnos candidatos: activos, no cancelados/completados, sin recordatorio enviado
  const { rows } = await pool.query(
    `SELECT id, nombre, email, telefono, fecha, hora, servicio FROM turnos
     WHERE deleted_at IS NULL
       AND estado IN ('pendiente', 'confirmado')
       AND fecha = $1
       AND ${columna} IS NULL
     ORDER BY hora ASC`,
    [fecha]
  );
  for (const turno of rows) {
    try {
      // Reclamo atómico: solo un proceso puede marcarlo. Garantiza que
      // el recordatorio nunca se envía dos veces, incluso con reinicios.
      const claim = await pool.query(
        `UPDATE turnos SET ${columna} = NOW() WHERE id = $1 AND ${columna} IS NULL RETURNING id`,
        [turno.id]
      );
      if (claim.rows.length === 0) continue; // otro proceso ya lo tomó

      const [mailOk, waOk] = await Promise.all([
        enviarEmail(turno, esMismoDia).catch(e => { console.error('email fail:', e.message); return false; }),
        enviarWhatsApp(turno, esMismoDia).catch(e => { console.error('wa fail:', e.message); return false; }),
      ]);
      console.log(`🔔 Recordatorio ${esMismoDia ? 'mismo día' : '24h'} — turno #${turno.id} (${turno.nombre}): email ${mailOk ? '✅' : '—'} · whatsapp ${waOk ? '✅' : '—'}`);
    } catch (err) {
      console.error(`Recordatorio turno #${turno.id} error:`, err.message);
    }
  }
}

// ── Ciclo principal ──
async function tick(pool) {
  try {
    const h = horaArg();
    if (h >= HORA_ENVIO_DIA) await procesarTanda(pool, 'recordatorio_dia', fechaArg(0), true);
    if (h >= HORA_ENVIO_24H) await procesarTanda(pool, 'recordatorio_24h', fechaArg(1), false);
  } catch (err) {
    console.error('Reminders tick error:', err.message);
  }
}

// ── Inicialización (llamar después de initDB) ──
async function initReminders(pool) {
  if (!EMAIL_ON && !WA_ON) {
    console.log('🔕 Recordatorios inactivos (faltan RESEND_API_KEY y/o WHATSAPP_TOKEN + WHATSAPP_PHONE_ID)');
    return;
  }
  try {
    // Migración segura: solo agrega columnas si no existen
    await pool.query(`ALTER TABLE turnos ADD COLUMN IF NOT EXISTS recordatorio_24h TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE turnos ADD COLUMN IF NOT EXISTS recordatorio_dia TIMESTAMPTZ`);
  } catch (err) {
    console.error('❌ Reminders: no se pudieron crear las columnas, módulo desactivado:', err.message);
    return;
  }
  console.log(`🔔 Recordatorios activos — email: ${EMAIL_ON ? 'Resend ✅' : 'no'} · whatsapp: ${WA_ON ? 'Meta API ✅' : 'no'} (mismo día desde ${HORA_ENVIO_DIA}:00, 24h antes desde ${HORA_ENVIO_24H}:00, hora AR)`);
  tick(pool);                                   // primera pasada al arrancar
  setInterval(() => tick(pool), 10 * 60 * 1000); // luego cada 10 minutos
}

module.exports = { initReminders };
