const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages';
const WHATSAPP_TOKEN = 'EAAR0i6DhhjIBO5ZCuHiH29grsbd4mYQ6ydZB1KLAWqZBBPKSh15fz2m37jnhUP1OnfyUniM5LVMBfxg1S6TTRR9AOSnbL2ZBKGEIZAkIJXbUO5rfGcFZCCilRLR0PsZAVR52ZAF4RNfGIGex7y7O1aZAX7F6GzW98CYDsRcF7K8rIT7R8ZCQFesbYPgVN4KZC2FdaEZCwwZDZD';

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

/**
 * Envía notificación de incidentes múltiples.
 * Variables esperadas:
 * {{1}} vehículo
 * {{2}} fecha
 * {{3}}, {{4}}, {{5}} eventos
 * botón dinámico con {{1}} = link del mapa
 */
async function sendWhatsAppTemplateMultipleEvents(number, vehicleName, eventDate, events = [], coords = null) {
  try {
    const [e1, e2, e3] = [
      events[0] || '—',
      events[1] || '—',
      events[2] || '—',
    ];

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
          { type: 'text', text: vehicleName },  // {{1}}
          { type: 'text', text: eventDate },    // {{2}}
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
            text: `https://maps.google.com/?q=${coords}`, // {{1}} dinámico del botón
          },
        ],
      });
    }

    const body = {
      messaging_product: 'whatsapp',
      to: String(number),
      type: 'template',
      template: {
        name: 'alerta_siniestro_2', // nombre exacto de tu plantilla
        language: { code: 'es_MX' },
        components,
      },
    };

    const response = await axios.post(WHATSAPP_URL, body, { headers });
    const data = response.data;

    if (data.messages?.[0]?.id) {
      logger.info(`✅ [META OK] Mensaje ID ${data.messages[0].id} → ${number}`);
    } else {
      logger.warn(`⚠️ Respuesta sin messages.id → ${number}`);
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
