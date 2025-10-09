const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getAuthHash } = require('./navixyClient');
const { logNavixyEvent } = require('../db/database');
const axios = require('axios');

const COMPANY_ID = 31;

const sourceToTracker = new Map();
const trackerActivity = new Map(); // Para verificar actividad de cada tracker

// Códigos válidos
const allowedEventCodes = new Set(['83', '41', '950', '991', '990']);

// Nombres legibles
const eventNamesMap = {
  '83': 'Botón de pánico',
  // '41': 'Desconexión del dispositivo',
  // '950': 'Exceso de velocidad',
  // '991': 'Frenado brusco',
  // '990': 'Aceleración brusca',
  // 'DOOR': 'Apertura de sensor de puerta'
};

async function buildSourceTrackerMap() {
  const hash = await getAuthHash();
  const res = await getTrackerIdsWithSources(hash);

  sourceToTracker.clear();

  res.list.forEach(tr => {
    if (tr.source && tr.source.id != null) {
      sourceToTracker.set(tr.source.id, tr.id);
    }
  });

  logger.info(`🔄 Mapeo source->tracker cargado: ${sourceToTracker.size} elementos`);

  // Log detallado de trackers
  logger.info("📊 Lista de trackers mapeados:");
  for (const [sourceId, trackerId] of sourceToTracker.entries()) {
    logger.info(`   - Source ID: ${sourceId} → Tracker ID: ${trackerId}`);
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
      action: "subscribe",
      hash,
      iso_datetime: true,
      requests: [
        {
          type: "readings_batch",
          target: { type: "all" },
          rate_limit: "5s",
          include_components: true
        },
        {
          type: "state_batch",
          target: { type: "all" },
          rate_limit: "5s",
          include_components: true
        }
      ]
    };
    ws.send(JSON.stringify(payload));
    logger.info(`✅ Suscripción enviada con hash: ${hash}`);
  } catch (err) {
    logger.error(`❌ Error durante la suscripción: ${err.message}`);
  }
}

function extractCode(source, key) {
  return source?.[key]?.value ?? source?.additional?.[key]?.value ?? null;
}

// Actualiza actividad del tracker
function updateTrackerActivity(trackerId) {
  const now = new Date();
  trackerActivity.set(trackerId, now);
  logger.debug(`🕒 Último evento del tracker ${trackerId}: ${now.toISOString()}`);
}

// Verifica trackers inactivos cada 10 minutos
setInterval(() => {
  const now = new Date();
  for (const [trackerId, last] of trackerActivity.entries()) {
    const diff = (now - last) / 60000;
    if (diff > 10) {
      logger.warn(`⚠ Tracker ${trackerId} sin eventos desde hace ${diff.toFixed(1)} min`);
    }
  }
}, 10 * 60 * 1000);

async function handleEvent(msg) {
  if (msg.type !== 'event') return;

  const event = msg.event;
  const data = msg.data;
  logger.info(`📦 Evento tipo: ${event} (${data.length} elementos)`);

  for (const item of data) {
    logger.info(`Logg: (${data} elementos)`);
    if (item.type === 'source_state_event') {
      const state = item.state;
      const sourceId = state.source_id ?? null;
      const trackerId = sourceToTracker.get(sourceId) ?? null;

      // Actualiza actividad
      if (trackerId) updateTrackerActivity(trackerId);

      // Log completo del evento recibido
      logger.debug(`📡 Evento recibido: ${JSON.stringify(item, null, 2)}`);

      const eventCode = extractCode(state, 'event_code');
      const subEventCode = extractCode(state, 'sub_event_code');

      logger.info(`📌 Fuente ${sourceId}, tracker ${trackerId}, code: ${eventCode}, sub: ${subEventCode}`);

      // Filtrar solo los códigos permitidos
      if (!allowedEventCodes.has(eventCode)) {
        logger.debug(`❌ Evento no permitido por código: ${eventCode} (omitido)`);
        continue;
      }

      const inputs = state.inputs ?? [];
      const isPanic = eventCode === '83';
      const isDisconnection = eventCode === '41';
      const isSpeed = eventCode === '950';
      const isBraking = eventCode === '991';
      const isAccel = eventCode === '990';
      const isDoor = inputs[3] === true;

      let eventName = eventNamesMap[eventCode];
      if (!eventName && isDoor) {
        eventName = eventNamesMap['DOOR'];
      }

      const shouldSave = isPanic || isDisconnection || isSpeed || isBraking || isAccel || isDoor;

      if (shouldSave) {
        logger.info(`💾 Guardando evento para tracker ${trackerId}, source ${sourceId}, nombre: ${eventName}`);
        try {
          await logNavixyEvent({
            companyId: COMPANY_ID,
            trackerId,
            sourceId,
            eventType: event,
            eventCode,
            subEventCode,
            eventName,
            payload: state
          });
          logger.info(`✅ Evento ${eventName} (${eventCode}) guardado correctamente`);
        } catch (err) {
          logger.error(`❌ Error al guardar evento: ${err.message}`);
        }
      } else {
        logger.debug(`ℹ Evento filtrado (no relevante): ${eventCode}`);
      }
    }
  }
}

async function connectWebSocket() {
  try {
    await buildSourceTrackerMap();
  } catch (err) {
    logger.error(`❌ Error mapeo source->tracker: ${err.message}`);
  }

  const wsUrl = process.env.NAVIXY_WS_URL;
  logger.info(`🔌 Conectando WebSocket a: ${wsUrl}`);

  const ws = new WebSocket(wsUrl, {
    headers: {
      'Origin': 'https://www.flotaobd2.com'
    }
  });

  ws.on('open', () => {
    logger.info("🟢 WebSocket conectado");
    subscribe(ws);
  });

  ws.on('message', async (data) => {
    const text = data.toString().trim();
    if (!text.startsWith('{')) {
      logger.debug(`Mensaje no JSON: ${text}`);
      return;
    }
    try {
      const msg = JSON.parse(text);
      await handleEvent(msg);
    } catch (err) {
      logger.error(`❌ Error al parsear mensaje: ${err.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`⚠ WebSocket cerrado: ${code} – ${reason}`);
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    logger.error(`❌ Error WebSocket: ${err.message}`);
    ws.terminate();
  });
}

module.exports = {
  connectWebSocket
};