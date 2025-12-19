const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages';
//const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_TOKEN = 'EAAR0i6DhhjIBO5ZCuHiH29grsbd4mYQ6ydZB1KLAWqZBBPKSh15fz2m37jnhUP1OnfyUniM5LVMBfxg1S6TTRR9AOSnbL2ZBKGEIZAkIJXbUO5rfGcFZCCilRLR0PsZAVR52ZAF4RNfGIGex7y7O1aZAX7F6GzW98CYDsRcF7K8rIT7R8ZCQFesbYPgVN4KZC2FdaEZCwwZDZD';
logger.info(`WHATSAPP_TOKEN cargado: ${process.env.WHATSAPP_TOKEN?.slice(0, 10)}...`);

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

/**
 * Envía notificación SOLO si hay exactamente 3 eventos.
 *
 * Variables esperadas por la plantilla:
 * {{1}} vehículo
 * {{2}} fecha
 * {{3}} evento 1
 * {{4}} evento 2
 * {{5}} evento 3
 * Botón dinámico {{1}} = link del mapa
 */
async function sendWhatsAppTemplateMultipleEvents(
  number,
  vehicleName,
  eventDate,
  events = [],
  coords = null
) {
  try {
    // Normalizar eventos
    const normalizedEvents = (events || []).filter(Boolean);

    // Regla estricta: SOLO 3 eventos
    if (normalizedEvents.length !== 3) {
      logger.info(
        `WhatsApp omitido → Se requieren exactamente 3 eventos (recibidos: ${normalizedEvents.length})`
      );
      return null;
    }

    const [e1, e2, e3] = normalizedEvents;

    const components = [
      {
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: {
              link: 'https://api.bireportslatam.com/images/dla-header-message-2.jpeg',
            },
          },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: vehicleName }, // {{1}}
          { type: 'text', text: eventDate },   // {{2}}
          { type: 'text', text: e1 },           // {{3}}
          { type: 'text', text: e2 },           // {{4}}
          { type: 'text', text: e3 },           // {{5}}
        ],
      },
    ];

    if (coords) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [
          {
            type: 'text',
            text: `https://maps.google.com/?q=${coords}`,
          },
        ],
      });
    }

    const body = {
      messaging_product: 'whatsapp',
      to: String(number),
      type: 'template',
      template: {
        name: 'alerta_siniestro_2', // plantilla exacta
        language: { code: 'es_MX' },
        components,
      },
    };

    const response = await axios.post(WHATSAPP_URL, body, { headers });
    const data = response.data;

    if (data.messages?.[0]?.id) {
      logger.info(`✅ WhatsApp enviado → ${number} | ID ${data.messages[0].id}`);
    } else {
      logger.warn(`⚠️ WhatsApp sin messages.id → ${number}`);
      logger.warn(JSON.stringify(data, null, 2));
    }

    return data;
  } catch (error) {
    const err = error.response?.data?.error || error.message;
    logger.error(`❌ Error WhatsApp ${number}: ${err.message || err}`);
    if (error.response?.data) {
      logger.error(JSON.stringify(error.response.data, null, 2));
    }
    return null;
  }
}

module.exports = { sendWhatsAppTemplateMultipleEvents };
