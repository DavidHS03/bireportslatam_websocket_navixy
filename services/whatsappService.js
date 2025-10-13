const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages';
const WHATSAPP_TOKEN = 'EAAR0i6DhhjIBO5ZCuHiH29grsbd4mYQ6ydZB1KLAWqZBBPKSh15fz2m37jnhUP1OnfyUniM5LVMBfxg1S6TTRR9AOSnbL2ZBKGEIZAkIJXbUO5rfGcFZCCilRLR0PsZAVR52ZAF4RNfGIGex7y7O1aZAX7F6GzW98CYDsRcF7K8rIT7R8ZCQFesbYPgVN4KZC2FdaEZCwwZDZD';

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

async function sendWhatsAppTemplate(number, contactName, vehicle_name, event_date, coords = null) {
  try {
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
          { type: 'text', text: vehicle_name },
          { type: 'text', text: event_date },
        ],
      },
    ];

    if (coords) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: coords }],
      });
    }

    const body = {
      messaging_product: 'whatsapp',
      to: String(number),
      type: 'template',
      template: {
        name: 'alerta_siniestro_2',
        language: { code: 'es_MX' },
        components,
      },
    };

    const response = await axios.post(WHATSAPP_URL, body, { headers });

    // logger.info(`Response: ${response.status} ${response.statusText}`);
    // logger.info(`Body: ${JSON.stringify(response.data, null, 2)}`);

    const data = response.data;

    // Validar si Meta realmente aceptó el mensaje
    if (data.messages && data.messages[0] && data.messages[0].id) {
      logger.info(`✅ [ACEPTADO POR META] Mensaje ID: ${data.messages[0].id} → ${number}`);
    } else {
      logger.warn(`⚠️ WhatsApp respondió sin 'messages.id' para ${number}`);
      logger.warn(`Respuesta completa: ${JSON.stringify(data, null, 2)}`);
    }

    return data;
  } catch (error) {
    const err = error.response?.data?.error || error.message;
    logger.error(`❌ Error enviando WhatsApp a ${number}: ${err.message || err}`);
    if (error.response?.data) {
      logger.error('Detalles:', JSON.stringify(error.response.data, null, 2));
    }
    return null;
  }
}

module.exports = { sendWhatsAppTemplate };