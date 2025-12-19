const WebSocket = require('ws');
const axios = require('axios');
const dayjs = require('dayjs');
require('dayjs/locale/es');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

const logger = require('../utils/logger');
const { getAuthHash, getTrackerLabel } = require('./navixyClient');
const { logNavixyEvent } = require('../db/database');
const { sendWhatsAppTemplateMultipleEvents } = require('./whatsappService');
const { configure, onFlush, pushEvent } = require('./eventAggregator');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('es');

/* ======================================================
   CONFIG GENERAL
====================================================== */
const COMPANY_ID = 31;
const sourceToTracker = new Map();
const recentEvents = new Map();

/* ======================================================
   EVENTOS SOPORTADOS
====================================================== */
const EVENT_CODES = {
  PANIC: '42',
  OVERSPEED: '33',
  POWER_CUT: '12',
  HARSH_ACCEL: '46',
  HARSH_BRAKE: '47',
};

const TARGET_EVENT_CODES = new Set(Object.values(EVENT_CODES));

const eventNamesMap = {
  '42': 'Botón de pánico',
  '33': 'Exceso de velocidad',
  '12': 'Corte de energía',
  '46': 'Aceleración brusca',
  '47': 'Frenado brusco',
};

const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández' },
  { number: '5212213508906', contactName: 'Carlos Maravilla' },
];

/* ======================================================
   VENTANA DESLIZANTE
====================================================== */
const isTest = process.env.NODE_ENV === 'test';

configure({
  windowMs: 5 * 60 * 1000,          // 5 minutos
  graceMs: isTest ? 500 : 30_000,   // 30s prod
  requiredUniqueEvents: 3,
});

/* ======================================================
   HELPERS
====================================================== */
function extractCode(state) {
  return state?.event_code?.value ?? state?.additional?.event_code?.value ?? null;
}

function isDuplicateEvent(trackerId, code, lat, lng) {
  const key = `${trackerId}_${code}`;
  const now = Date.now();
  const prev = recentEvents.get(key);

  if (prev && now - prev.time < 10_000) return true;

  recentEvents.set(key, { time: now, lat, lng });
  return false;
}

/**
 * Obtiene la ÚLTIMA coordenada válida
 */
function getLastValidCoords(events) {
  const valid = [...events]
    .reverse()
    .find(e =>
      typeof e.lat === 'number' &&
      typeof e.lng === 'number' &&
      e.lat !== 0 &&
      e.lng !== 0
    );

  return valid ? `${valid.lat},${valid.lng}` : null;
}

/* ======================================================
   FLUSH → WHATSAPP
====================================================== */
onFlush(async (trackerId, snapshot) => {
  try {
    if (snapshot.length < 3) return;

    const hash = await getAuthHash();
    const label = await getTrackerLabel(hash, trackerId);

    const coords = getLastValidCoords(snapshot);
    const lastEvent = snapshot[snapshot.length - 1];
    const eventDate = lastEvent.eventDate;

    const names = snapshot.slice(0, 3).map(e => e.name);

    for (const c of ALERT_RECIPIENTS) {
      await sendWhatsAppTemplateMultipleEvents(
        c.number,
        label,
        eventDate,
        names,
        coords
      );
    }

    logger.warn(
      `🚨 SINIESTRO DETECTADO | Tracker=${trackerId} | Eventos=${names.join(', ')}`
    );
  } catch (err) {
    logger.error(`❌ Error en onFlush: ${err.message}`);
  }
});

/* ======================================================
   TRACKERS
====================================================== */
async function buildSourceTrackerMap() {
  const hash = await getAuthHash();
  const API = process.env.NAVIXY_API_URL;

  const resp = await axios.post(`${API}/v2/tracker/list`, { hash });
  sourceToTracker.clear();

  resp.data.list.forEach(tr => {
    if (tr.source?.id != null) {
      sourceToTracker.set(tr.source.id, tr.id);
      logger.info(`📟 Tracker activo → ${tr.label} (${tr.id})`);
    }
  });

  logger.info(`✅ Trackers monitoreados: ${sourceToTracker.size}`);
}

/* ======================================================
   MANEJO DE EVENTOS
====================================================== */
async function handleEvent(msg) {
  if (msg.type !== 'event' || msg.event !== 'state_batch') return;

  for (const item of msg.data) {
    if (item.type !== 'source_state_event') continue;

    const state = item.state;
    const trackerId = sourceToTracker.get(state.source_id);
    if (!trackerId) continue;

    const eventCode = extractCode(state);
    if (!TARGET_EVENT_CODES.has(eventCode)) continue;

    const lat = state.gps?.location?.lat ?? 0;
    const lng = state.gps?.location?.lng ?? 0;
    if (isDuplicateEvent(trackerId, eventCode, lat, lng)) continue;

    const eventDate = dayjs(state.updated || new Date())
      .tz('America/Mexico_City')
      .format('DD [de] MMMM [de] YYYY, HH:mm:ss');

    const eventName = eventNamesMap[eventCode];

    await logNavixyEvent({
      companyId: COMPANY_ID,
      trackerId,
      sourceId: state.source_id,
      eventType: msg.event,
      eventCode,
      eventName,
      payload: state,
    });

    pushEvent(trackerId, {
      code: eventCode,
      name: eventName,
      ts: Date.now(),
      lat,
      lng,
      eventDate,
    });

    logger.info(`📌 Evento ${eventName} | Tracker ${trackerId}`);
  }
}

/* ======================================================
   WEBSOCKET (AUTO-RECONEXIÓN)
====================================================== */
async function connectWebSocket() {
  await buildSourceTrackerMap();

  const ws = new WebSocket(process.env.NAVIXY_WS_URL, {
    headers: { Origin: 'https://www.flotaobd2.com' },
  });

  ws.on('open', async () => {
    const hash = await getAuthHash();
    ws.send(JSON.stringify({
      action: 'subscribe',
      hash,
      iso_datetime: true,
      requests: [
        { type: 'state_batch', target: { type: 'all' }, rate_limit: '5s' },
      ],
    }));
    logger.info('📡 Suscrito a Navixy');
  });

  ws.on('message', async (data) => {
    const text = data.toString().trim();

    // Navixy manda heartbeats no JSON
    if (!text.startsWith('{')) return;

    try {
      const msg = JSON.parse(text);
      await handleEvent(msg);
    } catch (err) {
      logger.error(`❌ Error parseando mensaje WS: ${err.message}`);
    }
  });

  ws.on('close', () => {
    logger.warn('⚠️ WebSocket cerrado. Reintentando en 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', err => {
    logger.error(`❌ WebSocket error: ${err.message}`);
    ws.terminate();
  });
}

module.exports = {
  connectWebSocket,
  handleEvent,
  buildSourceTrackerMap,
};