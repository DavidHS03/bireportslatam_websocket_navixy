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

// Códigos
const SOS_EVENT_CODE = '42';
const POWER_CUT_EVENT_CODE = '12';
const OVERSPEED_CODES = ['33', '34'];

// Nombres
const eventNamesMap = {
  '42': 'Botón de pánico',
  '12': 'Corte de energía',
  '33': 'Exceso de velocidad',
  '34': 'Exceso de velocidad',
};

// Contactos
const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández' },
  { number: '5219933085878', contactName: 'Alexander Hidalgo' },
  { number: '5212229228568', contactName: 'JP' },
  { number: '5215554065207', contactName: 'Hector' },
  { number: '5215544544345', contactName: 'Jose' },
  { number: '5212225414499', contactName: 'Gaby' }
];

// Config ventana y grace
configure({ windowMs: 5 * 60 * 1000, minEvents: 2, graceMs: 30 * 1000 });

// Al completar el grace, se arma y envía 1 notificación por tracker
onFlush(async (trackerId, snapshot) => {
  try {
    const hash = await getAuthHash();
    const label = await getTrackerLabel(hash, trackerId);

    const last = snapshot[snapshot.length - 1];
    const coords = `${last.lat},${last.lng}`;
    const eventDate = last.eventDate;

    // nombres únicos en orden de llegada, máximo 3
    const eventsList = snapshot.map(e => e.name).slice(0, 3);

    for (const c of ALERT_RECIPIENTS) {
      await sendWhatsAppTemplateMultipleEvents(
        c.number,
        label,           // {{1}}
        eventDate,       // {{2}}
        eventsList,      // {{3}} {{4}} {{5}}
        coords           // botón mapa
      );
    }

    logger.warn(`Notificación consolidada: ${eventsList.join(', ')}`);
  } catch (err) {
    logger.error(`Error al enviar notificación consolidada: ${err.message}`);
  }
});

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

  for (const item of msg.data) {
    if (item.type !== 'source_state_event') continue;
    const state = item.state;
    const sourceId = state.source_id;
    const trackerId = sourceToTracker.get(sourceId);
    if (!trackerId) continue;

    const eventCode = extractCode(state, 'event_code');
    if (!eventCode) continue;

    const lat = state.gps?.location?.lat ?? 0;
    const lng = state.gps?.location?.lng ?? 0;
    if (isDuplicateEvent(trackerId, eventCode, lat, lng)) continue;

    const speed = state.gps?.speed ?? 0;
    const eventDateIso = state.gps?.updated || new Date().toISOString();
    const eventDate = dayjs(eventDateIso).tz('America/Mexico_City')
      .format('DD [de] MMMM [de] YYYY, HH:mm:ss');
    const eventName = eventNamesMap[eventCode] ?? `Evento ${eventCode}`;

    // Filtra overspeed menor o igual a 110 km/h
    if (OVERSPEED_CODES.includes(eventCode) && speed <= 110) {
      continue;
    }

    await logNavixyEvent({
      companyId: COMPANY_ID,
      trackerId,
      sourceId,
      eventType: msg.event,
      eventCode,
      eventName,
      payload: state,
    });

    // agrega al buffer; la notificación se enviará tras GRACE_MS
    pushEvent(trackerId, {
      code: eventCode,
      name: eventName,
      ts: Date.now(),
      lat, lng, speed,
      eventDate,
    });
  }
}

module.exports = { handleEvent, buildSourceTrackerMap };