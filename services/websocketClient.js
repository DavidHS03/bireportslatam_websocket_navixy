const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getAuthHash, getTrackerLabel } = require('./navixyClient');
const { logNavixyEvent } = require('../db/database');
const axios = require('axios');
const {
  sendWhatsAppTemplate,
  sendWhatsAppTemplateOverspeed,
  sendWhatsAppTemplatePowerCut
} = require('../services/whatsappService');

const dayjs = require('dayjs');
require('dayjs/locale/es');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('es');

const COMPANY_ID = 31;
const sourceToTracker = new Map();
const recentEvents = new Map();

// Códigos de eventos
const SOS_EVENT_CODE = '42';
const OVERSPEED_EVENT_CODE = '33'; 
const POWER_CUT_EVENT_CODE = '12';

// Capacidades descriptivas
const eventNamesMap = {
  '42': 'Botón de pánico',
  '33': 'Exceso de velocidad',
  '12': 'Corte de energía (Paro de motor)'
};

// Contactos para alertas
const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández', companyName: 'DLA' },
  { number: '5219933085878', contactName: 'Alexander Hidalgo', companyName: 'DLA' },
  { number: '5212229228568', contactName: 'JP', companyName: 'DLA' },
];

// ========================================================
// 🔧 Funciones base
// ========================================================

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
  if (resp.data.success && Array.isArray(resp.data.list)) {
    return resp.data;
  }
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
        { type: 'readings_batch', target: { type: 'all' }, rate_limit: '5s' },
        { type: 'state_batch', target: { type: 'all' }, rate_limit: '5s', include_components: true }
      ]
    };
    ws.send(JSON.stringify(payload));
    logger.info(`📡 Suscripción enviada con hash: ${hash}`);
  } catch (err) {
    logger.error(`Error durante la suscripción: ${err.message}`);
  }
}

// ========================================================
//  Utilidades
// ========================================================

/**
 * Extrae el valor de una propiedad adicional o state.
 * @param {object} state – objeto state del evento.
 * @param {string} key – clave buscada.
 * @returns {string|null} valor o null.
 */
function extractCode(state, key) {
  return (state?.[key]?.value) ?? (state?.additional?.[key]?.value) ?? null;
}

/**
 * Determina si un evento con trackerId y eventCode ya fue procesado recientemente
 * para evitar duplicados.
 * @param {string|number} trackerId
 * @param {string} eventCode
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean} true si es duplicado y debe ignorarse.
 */
function isDuplicateEvent(trackerId, eventCode, lat, lng) {
  const key = `${trackerId}_${eventCode}`;
  const now = Date.now();
  const prev = recentEvents.get(key);
  if (prev) {
    const diff = now - prev.time;
    const dist = Math.abs(prev.lat - lat) + Math.abs(prev.lng - lng);
    if (diff < 10000 && dist < 0.0005) { // 10 segundos y poca distancia
      return true;
    }
  }
  recentEvents.set(key, { time: now, lat, lng });
  return false;
}

// Limpieza de cache cada minuto
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of recentEvents.entries()) {
    if (now - data.time > 60000) { // eventos más antiguos de 1 minuto
      recentEvents.delete(key);
    }
  }
}, 60000);

// ========================================================
// Manejo de eventos WebSocket
// ========================================================

async function handleEvent(msg) {
  if (msg.type !== 'event') return;
  const { event, data } = msg;
  if (event !== 'state_batch' || !Array.isArray(data)) return;

  for (const item of data) {
    if (item.type !== 'source_state_event') continue;
    const state = item.state;
    const sourceId = state.source_id ?? null;
    const trackerId = sourceToTracker.get(sourceId) ?? null;
    if (!trackerId) continue;

    const eventCode = extractCode(state, 'event_code');
    if (!eventCode) continue;

    logger.info(`[🔍 EVENTO RECIBIDO] Tracker ${trackerId} → event_code: ${eventCode}`);

    const lat = state.gps?.location?.lat ?? 0;
    const lng = state.gps?.location?.lng ?? 0;
    if (isDuplicateEvent(trackerId, eventCode, lat, lng)) continue;

    const speed = state.gps?.speed ?? 0;
    const battery = state.battery_level ?? 'N/D';
    const ignition = state.ignition ?? 'N/D';
    const eventDate = dayjs(state.updated || new Date())
      .tz('America/Mexico_City')
      .format('DD [de] MMMM [de] YYYY, HH:mm:ss');

    let templateFn = null;
    let eventName = '';

    if (eventCode === SOS_EVENT_CODE) {
      eventName = eventNamesMap[eventCode];
      templateFn = sendWhatsAppTemplate;
      logger.warn(`[🚨 DETECTADO] ${eventName} - Tracker ${trackerId}`);
    } else if (eventCode === OVERSPEED_EVENT_CODE) {
      // Aquí condición de exceso de velocidad
      const threshold = 110; // km/h
      if (speed <= threshold) {
        logger.info(`Velocidad (${speed} km/h) no supera umbral (${threshold} km/h). Omisión.`);
        continue;
      }
      eventName = eventNamesMap[eventCode];
      templateFn = sendWhatsAppTemplateOverspeed;
      logger.warn(`[💨 DETECTADO] ${eventName} - Tracker ${trackerId}`);
      logger.info(`📊 Detalles overspeed:
        • Velocidad: ${speed} km/h
        • Latitud: ${lat}
        • Longitud: ${lng}
        • Batería: ${battery}%
        • Ignición: ${ignition}
        • Fecha evento: ${eventDate}
      `);
    } else if (eventCode === POWER_CUT_EVENT_CODE) {
      eventName = eventNamesMap[eventCode];
      templateFn = sendWhatsAppTemplatePowerCut;
      logger.warn(`[🔋 DETECTADO] ${eventName} - Tracker ${trackerId}`);
      logger.info(`📊 Detalles corte de energía:
        • Batería: ${battery}%
        • Latitud: ${lat}
        • Longitud: ${lng}
        • Ignición: ${ignition}
        • Fecha evento: ${eventDate}
      `);
    } else {
      continue; 
    }

    try {
      const hash = await getAuthHash();
      const label = await getTrackerLabel(hash, trackerId);
      const coords = `${lat},${lng}`;

      await logNavixyEvent({
        companyId: COMPANY_ID,
        trackerId,
        sourceId,
        eventType: event,
        eventCode,
        eventName,
        payload: state
      });

      if (templateFn) {
        for (const contact of ALERT_RECIPIENTS) {
          if (eventCode === OVERSPEED_EVENT_CODE) {
            await templateFn(contact.number, contact.contactName, label, eventDate, coords, speed);
          } else {
            await templateFn(contact.number, contact.contactName, label, eventDate, coords);
          }
        }
      }
    } catch (err) {
      logger.error(`Error procesando evento (${eventCode}): ${err.message}`);
    }
  }
}

// ========================================================
// Conexión WebSocket
// ========================================================

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