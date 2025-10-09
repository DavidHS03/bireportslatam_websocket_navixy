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
const trackerActivity = new Map();

const SOS_EVENT_CODE = '83';

const eventNamesMap = {
  '83': 'Botón de pánico'
};

// Lista de contactos que recibirán la alerta
const ALERT_RECIPIENTS = [
  { number: '5212227086105', contactName: 'David Hernández', companyName: 'DLA' },
  { number: '5219933085878', contactName: 'Alexander Hidalgo', companyName: 'DLA' }
];

async function buildSourceTrackerMap() {
  const hash = await getAuthHash();
  const res = await getTrackerIdsWithSources(hash);

  sourceToTracker.clear();

  res.list.forEach(tr => {
    if (tr.source && tr.source.id != null) {
      sourceToTracker.set(tr.source.id, tr.id);
    }
  });

  logger.info(`Mapeo source->tracker cargado: ${sourceToTracker.size} elementos`);
  for (const [sourceId, trackerId] of sourceToTracker.entries()) {
    logger.info(`Source ID: ${sourceId} → Tracker ID: ${trackerId}`);
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
        {
          type: 'readings_batch',
          target: { type: 'all' },
          rate_limit: '5s',
          include_components: true
        },
        {
          type: 'state_batch',
          target: { type: 'all' },
          rate_limit: '5s',
          include_components: true
        }
      ]
    };
    ws.send(JSON.stringify(payload));
    logger.info(`Suscripción enviada con hash: ${hash}`);
  } catch (err) {
    logger.error(`Error durante la suscripción: ${err.message}`);
  }
}

function extractCode(source, key) {
  return source?.[key]?.value ?? source?.additional?.[key]?.value ?? null;
}

function updateTrackerActivity(trackerId) {
  const now = new Date();
  trackerActivity.set(trackerId, now);
  logger.debug(`Último evento del tracker ${trackerId}: ${now.toISOString()}`);
}

setInterval(() => {
  const now = new Date();
  for (const [trackerId, last] of trackerActivity.entries()) {
    const diff = (now - last) / 60000;
    if (diff > 10) {
      logger.warn(`Tracker ${trackerId} sin eventos desde hace ${diff.toFixed(1)} min`);
    }
  }
}, 10 * 60 * 1000);

async function handleEvent(msg) {
  if (msg.type !== 'event') return;

  const event = msg.event;
  const data = msg.data;
  logger.info(`Evento tipo: ${event} (${data.length} elementos)`);

  for (const item of data) {
    if (item.type === 'source_state_event') {
      const state = item.state;
      const sourceId = state.source_id ?? null;
      const trackerId = sourceToTracker.get(sourceId) ?? null;

      if (trackerId) updateTrackerActivity(trackerId);

      const eventCode = extractCode(state, 'event_code');
      const subEventCode = extractCode(state, 'sub_event_code');

      logger.info(`Fuente ${sourceId}, tracker ${trackerId}, code: ${eventCode}, sub: ${subEventCode}`);

      if (eventCode === SOS_EVENT_CODE) {
        const eventName = eventNamesMap[SOS_EVENT_CODE];
        logger.warn(`[DETECTADO SOS] Tracker ${trackerId} (${sourceId}) activó: ${eventName}`);

        try {
          const hash = await getAuthHash();
          const label = await getTrackerLabel(hash, trackerId);

          const lat = state.gps?.lat ?? 0;
          const lng = state.gps?.lng ?? 0;
          const coords = `${lat},${lng}`;

          const eventDateRaw = state.timestamp ?? new Date().toISOString();
          const eventDate = dayjs(eventDateRaw).format('DD [de] MMMM [de] YYYY, HH:mm:ss');

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

          logger.info(`Evento SOS guardado correctamente para tracker ${trackerId} (${label})`);

          // Enviar el mismo template a todos los destinatarios
          for (const contact of ALERT_RECIPIENTS) {
            await sendWhatsAppTemplate(
              contact.number,
              contact.contactName,
              label,
              coords,
              eventDate
            );
            logger.info(`Template enviado a ${contact.contactName} (${contact.number})`);
          }
        } catch (err) {
          logger.error(`Error al procesar evento SOS: ${err.message}`);
        }
      } else {
        logger.debug(`Evento ignorado (no SOS): ${eventCode}`);
      }
    }
  }
}

async function connectWebSocket() {
  try {
    await buildSourceTrackerMap();
  } catch (err) {
    logger.error(`Error mapeo source->tracker: ${err.message}`);
  }

  const wsUrl = process.env.NAVIXY_WS_URL;
  logger.info(`Conectando WebSocket a: ${wsUrl}`);

  const ws = new WebSocket(wsUrl, {
    headers: { Origin: 'https://www.flotaobd2.com' }
  });

  ws.on('open', () => {
    logger.info('WebSocket conectado');
    subscribe(ws);
  });

  ws.on('message', async data => {
    const text = data.toString().trim();
    if (!text.startsWith('{')) {
      logger.debug(`Mensaje no JSON: ${text}`);
      return;
    }
    try {
      const msg = JSON.parse(text);
      await handleEvent(msg);
    } catch (err) {
      logger.error(`Error al parsear mensaje: ${err.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`WebSocket cerrado: ${code} – ${reason}`);
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', err => {
    logger.error(`Error WebSocket: ${err.message}`);
    ws.terminate();
  });
}

module.exports = {
  connectWebSocket
};