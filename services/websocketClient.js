const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getAuthHash, getTrackerLabel } = require('./navixyClient');
const { logNavixyEvent } = require('../db/database');
const axios = require('axios');
const { sendWhatsAppTemplate } = require('../services/whatsappService');
const dayjs = require('dayjs');
require('dayjs/locale/es');
dayjs.locale('es');

const COMPANY_ID = 31;

const sourceToTracker = new Map();
const recentEvents = new Map();

const SOS_EVENT_CODE = '42';
const eventNamesMap = { '42': 'Botón de pánico' };

const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández', companyName: 'DLA' },
  { number: '5219933085878', contactName: 'Alexander Hidalgo', companyName: 'DLA' },
  { number: '5215544544345', contactName: 'Jose Marsal', companyName: 'DLA' },
  { number: '5212229228568', contactName: 'JP', companyName: 'DLA' },
  { number: '5215554065207', contactName: '-', companyName: 'Syngenta' },
  { number: '5491124672697', contactName: '-', companyName: 'Syngenta' }
];

async function buildSourceTrackerMap() {
  try {
    const hash = await getAuthHash();
    const res = await getTrackerIdsWithSources(hash);
    sourceToTracker.clear();

    res.list.forEach(tr => {
      if (tr.source && tr.source.id != null) {
        sourceToTracker.set(tr.source.id, tr.id);
      }
    });

    logger.info(`✅ Mapeo source->tracker cargado (${sourceToTracker.size} elementos)`);
  } catch (err) {
    logger.error(`Error al construir mapa source->tracker: ${err.message}`);
  }
}

async function getTrackerIdsWithSources(hash) {
  const API = process.env.NAVIXY_API_URL;
  const resp = await axios.post(`${API}/v2/tracker/list`, { hash });
  if (resp.data.success && Array.isArray(resp.data.list)) return resp.data;
  throw new Error('Error obteniendo trackers con fuentes');
}

async function subscribe(ws) {
  try {
    const hash = await getAuthHash();
    const payload = {
      action: 'subscribe',
      hash,
      iso_datetime: true,
      requests: [
        { type: 'readings_batch', target: { type: 'all' }, rate_limit: '5s', include_components: false },
        { type: 'state_batch', target: { type: 'all' }, rate_limit: '5s', include_components: true }
      ]
    };
    ws.send(JSON.stringify(payload));
    logger.info(`📡 Suscripción enviada con hash: ${hash}`);
  } catch (err) {
    logger.error(`Error durante la suscripción: ${err.message}`);
  }
}

function extractCode(state, key) {
  return state?.[key]?.value ?? state?.additional?.[key]?.value ?? null;
}

/**
 * Evita duplicados dentro de 10 segundos y distancia mínima
 */
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

// Limpieza cada minuto de eventos antiguos
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of recentEvents.entries()) {
    if (now - data.time > 60000) recentEvents.delete(key);
  }
}, 60000);

/**
 * Manejo de eventos WebSocket
 * Solo procesamos el botón de pánico (event_code 42)
 */
async function handleEvent(msg) {
  if (msg.type !== 'event') return;
  const { event, data } = msg;

  // Solo procesamos eventos "state_batch"
  if (event !== 'state_batch' || !Array.isArray(data)) return;

  for (const item of data) {
    if (item.type !== 'source_state_event') continue;

    const state = item.state;
    const sourceId = state.source_id ?? null;
    const trackerId = sourceToTracker.get(sourceId) ?? null;
    if (!trackerId) continue;

    const eventCode = extractCode(state, 'event_code');
    if (eventCode !== SOS_EVENT_CODE) continue;

    const lat = state.gps?.location?.lat ?? 0;
    const lng = state.gps?.location?.lng ?? 0;
    if (isDuplicateEvent(trackerId, eventCode, lat, lng)) continue;

    const eventName = eventNamesMap[eventCode] || 'Evento desconocido';
    logger.warn(`[🚨 DETECTADO] ${eventName} - Tracker ${trackerId}`);

    try {
      const hash = await getAuthHash();
      const label = await getTrackerLabel(hash, trackerId);
      const coords = `${lat},${lng}`;
      const eventDateRaw = state.updated || new Date().toISOString();
      const eventDate = dayjs(eventDateRaw).format('DD [de] MMMM [de] YYYY, HH:mm:ss');

      // Guardar evento en BD
      await logNavixyEvent({
        companyId: COMPANY_ID,
        trackerId,
        sourceId,
        eventType: event,
        eventCode,
        eventName,
        payload: state
      });

      logger.info(`💾 Botón de pánico guardado (${label})`);

      // Enviar notificaciones
      for (const contact of ALERT_RECIPIENTS) {
        await sendWhatsAppTemplate(contact.number, contact.contactName, label, eventDate, coords);
      }
    } catch (err) {
      logger.error(`Error procesando evento de pánico: ${err.message}`);
    }
  }
}

/**
 * Conexión principal WebSocket
 */
async function connectWebSocket() {
  await buildSourceTrackerMap();

  const wsUrl = process.env.NAVIXY_WS_URL;
  logger.info(`🔌 Conectando WebSocket a: ${wsUrl}`);

  const ws = new WebSocket(wsUrl, { headers: { Origin: 'https://www.flotaobd2.com' } });

  ws.on('open', () => {
    logger.info('✅ WebSocket conectado correctamente');
    subscribe(ws);
  });

  ws.on('message', async data => {
    const text = data.toString().trim();
    if (!text.startsWith('{')) return;
    try {
      const msg = JSON.parse(text);
      await handleEvent(msg);
    } catch (err) {
      logger.error(`Error al parsear mensaje: ${err.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`⚠️ WebSocket cerrado (${code}) → ${reason}`);
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', err => {
    logger.error(`❌ Error WebSocket: ${err.message}`);
    ws.terminate();
  });
}

module.exports = { connectWebSocket };