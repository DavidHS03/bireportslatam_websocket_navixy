const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dayjs/locale/es');

const axios = require('axios');
const logger = require('../utils/logger');
const { getAuthHash, getTrackerLabel } = require('./navixyClient');
const { logNavixyEvent } = require('../db/database');
const { sendWhatsAppTemplateMultipleEvents } = require('../services/whatsappService');
const { configure, onFlush, pushEvent } = require('../services/eventAggregator');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('es');

const COMPANY_ID = 31;
const sourceToTracker = new Map();
const recentEvents = new Map();

/**
 * Códigos de eventos relevantes para posible siniestro.
 * Nota: Ajusta GEOFENCE_EXIT_CODE con el código real de “Salida de geocerca” en tu cuenta.
 */
const PANIC_CODE = '42';
const HARSH_ACCEL_CODE = '46';
const HARSH_BRAKE_CODE = '47';
const GEOFENCE_EXIT_CODE = process.env.NAVIXY_GEOFENCE_EXIT_CODE || '0'; // Cambia a tu código real

const TARGET_EVENT_CODES = new Set([
  PANIC_CODE,
  HARSH_ACCEL_CODE,
  HARSH_BRAKE_CODE,
  GEOFENCE_EXIT_CODE,
]);

const eventNamesMap = {
  [PANIC_CODE]: 'Botón de pánico',
  [HARSH_ACCEL_CODE]: 'Aceleración brusca',
  [HARSH_BRAKE_CODE]: 'Frenado brusco',
  [GEOFENCE_EXIT_CODE]: 'Salida de geocerca',
};

// Contactos
const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández' },
  { number: '5212213508906', contactName: 'Carlos Maravilla' },
];

// Ventana 5 min, mínimo 3 eventos, grace 30s
const isTest = process.env.NODE_ENV === 'test';

configure({
  windowMs: 5 * 60 * 1000,
  graceMs: isTest ? 500 : 30 * 1000,
  requiredUniqueEvents: 3,
});

/**
 * Envío consolidado tras el grace time.
 * Regla: enviar solo si hay 3 o 4 tipos distintos dentro de la ventana.
 */
onFlush(async (trackerId, snapshot) => {
  try {
    // Solo considerar eventos objetivo
    const filtered = snapshot.filter(e => TARGET_EVENT_CODES.has(e.code));
    if (filtered.length === 0) return;

    // Tipos únicos
    const uniqueByCode = new Map();
    for (const e of filtered) {
      if (!uniqueByCode.has(e.code)) uniqueByCode.set(e.code, e);
    }

    const uniqueEvents = Array.from(uniqueByCode.values()).sort((a, b) => a.ts - b.ts);
    const uniqueCount = uniqueEvents.length;

    // Regla: 3 o 4 (si tienes más por ruido, también puedes permitir >=3)
    if (uniqueCount < 3) {
      logger.info(`Flush omitido. Tipos únicos=${uniqueCount}. Requiere >= 3.`);
      return;
    }

    const hash = await getAuthHash();
    const label = await getTrackerLabel(hash, trackerId);

    const last = uniqueEvents[uniqueEvents.length - 1];
    const coords = `${last.lat},${last.lng}`;
    const eventDate = last.eventDate;

    // Tu plantilla soporta 3 variables de eventos ({{3}}, {{4}}, {{5}})
    // Si hay 4 eventos, el cuarto se concatena en la tercera línea.
    const names = uniqueEvents.map(e => e.name);
    const eventsForTemplate = normalizeEventsFor3Vars(names);

    for (const c of ALERT_RECIPIENTS) {
      await sendWhatsAppTemplateMultipleEvents(
        c.number,
        label,               // {{1}}
        eventDate,           // {{2}}
        eventsForTemplate,   // {{3}} {{4}} {{5}}
        coords
      );
    }

    logger.warn(`Notificación enviada. Tipos únicos=${uniqueCount}. Eventos=${names.join(', ')}`);
  } catch (err) {
    logger.error(`Error al enviar notificación consolidada: ${err.message}`);
  }
});

/**
 * Convierte una lista de eventos (3 o 4) a 3 strings para la plantilla.
 * - 3 eventos: [e1,e2,e3]
 * - 4 eventos: [e1,e2,"e3 / e4"]
 */
function normalizeEventsFor3Vars(names) {
  const clean = (names || []).filter(Boolean);
  if (clean.length <= 3) return clean;

  // 4 o más: toma 4 y fusiona los últimos 2 en el tercer campo
  const first = clean[0];
  const second = clean[1];
  const third = `${clean[2]} / ${clean[3]}`;
  return [first, second, third];
}

// ========================================================
// Base Navixy
// ========================================================

async function getTrackerIdsWithSources(hash) {
  const API = process.env.NAVIXY_API_URL;
  const resp = await axios.post(`${API}/v2/tracker/list`, { hash });
  if (resp.data.success) return resp.data;
  throw new Error('Error obteniendo trackers');
}

async function buildSourceTrackerMap() {
  const hash = await getAuthHash();
  const res = await getTrackerIdsWithSources(hash);
  sourceToTracker.clear();
  res.list.forEach(tr => {
    if (tr.source?.id != null) sourceToTracker.set(tr.source.id, tr.id);
  });
  logger.info(`Mapeo source->tracker cargado (${sourceToTracker.size})`);
}

// ========================================================
// Utilidades
// ========================================================

function extractCode(state, key) {
  return state?.[key]?.value ?? state?.additional?.[key]?.value ?? null;
}

function isDuplicateEvent(trackerId, eventCode, lat, lng) {
  const key = `${trackerId}_${eventCode}`;
  const now = Date.now();
  const prev = recentEvents.get(key);
  if (prev) {
    const diff = now - prev.time;
    const dist = Math.abs(prev.lat - lat) + Math.abs(prev.lng - lng);
    if (diff < 10000 && dist < 0.0005) return true;
  }
  recentEvents.set(key, { time: now, lat, lng });
  return false;
}

// ========================================================
// Manejo de eventos
// ========================================================

async function handleEvent(msg) {
  if (msg.type !== 'event' || msg.event !== 'state_batch') return;
  if (!Array.isArray(msg.data)) return;

  for (const item of msg.data) {
    if (item.type !== 'source_state_event') continue;

    const state = item.state;
    const sourceId = state.source_id;
    const trackerId = sourceToTracker.get(sourceId);
    if (!trackerId) continue;

    const eventCode = extractCode(state, 'event_code');
    if (!eventCode) continue;

    // Solo los eventos objetivo
    if (!TARGET_EVENT_CODES.has(eventCode)) continue;

    const lat = state.gps?.location?.lat ?? 0;
    const lng = state.gps?.location?.lng ?? 0;
    if (isDuplicateEvent(trackerId, eventCode, lat, lng)) continue;

    const eventDateIso = state.gps?.updated || state.updated || new Date().toISOString();
    const eventDate = dayjs(eventDateIso)
      .tz('America/Mexico_City')
      .format('DD [de] MMMM [de] YYYY, HH:mm:ss');

    const eventName = eventNamesMap[eventCode] ?? `Evento ${eventCode}`;

    await logNavixyEvent({
      companyId: COMPANY_ID,
      trackerId,
      sourceId,
      eventType: msg.event,
      eventCode,
      eventName,
      payload: state,
    });

    // Importante: el ts debe ser real, usa Date.now()
    pushEvent(trackerId, {
      code: eventCode,
      name: eventName,
      ts: Date.now(),
      lat,
      lng,
      eventDate,
    });

    logger.info(`Evento objetivo capturado. tracker=${trackerId} code=${eventCode} name=${eventName}`);
  }
}

module.exports = { handleEvent, buildSourceTrackerMap };