const axios = require('axios');
const logger = require('../utils/logger');

const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages';
const WHATSAPP_TOKEN = process.env.WA_ACCESS_TOKEN;

if (!WHATSAPP_TOKEN) {
  logger.error('❌ WHATSAPP_TOKEN no está definido en process.env');
} else {
  logger.info(`✅ WHATSAPP_TOKEN cargado: ${WHATSAPP_TOKEN.slice(0, 10)}...`);
}

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

async function sendWhatsAppTemplateMultipleEvents(number, vehicleName, eventDate, events = [], coords = null) {
  const normalizedEvents = (events || []).filter(Boolean);

  // EXACTAMENTE 3 variables para plantilla
  if (normalizedEvents.length !== 3) {
    logger.info(`⏭️ WhatsApp omitido → Se requieren 3 eventos exactos (recibidos: ${normalizedEvents.length})`);
    return null;
  }

  const [e1, e2, e3] = normalizedEvents;

  const components = [
    {
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: 'https://api.bireportslatam.com/images/dla-header-message-2.jpeg' },
        },
      ],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: vehicleName }, // {{1}}
        { type: 'text', text: eventDate },   // {{2}}
        { type: 'text', text: e1 },          // {{3}}
        { type: 'text', text: e2 },          // {{4}}
        { type: 'text', text: e3 },          // {{5}}
      ],
    },
  ];

  if (coords) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: `https://maps.google.com/?q=${coords}` }],
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: String(number),
    type: 'template',
    template: {
      name: 'alerta_siniestro_2',
      language: { code: 'es_MX' },
      components,
    },
  };

  const resp = await axios.post(WHATSAPP_URL, payload, {
    headers,
    validateStatus: () => true,
  });

  logger.info(`📨 WhatsApp HTTP status=${resp.status}`);
  logger.info(`📨 WhatsApp response=${JSON.stringify(resp.data)}`);

  if (resp.data?.messages?.[0]?.id) {
    logger.info(`✅ WhatsApp ACCEPTED → ${number} | wamid=${resp.data.messages[0].id}`);
    logger.warn('ℹ️ ACCEPTED ≠ ENTREGADO (estado real llega por webhook)');
    return resp.data;
  }

  if (resp.data?.error) {
    logger.error(`❌ WhatsApp ERROR → ${JSON.stringify(resp.data.error)}`);
    return null;
  }

  logger.warn(`⚠️ Respuesta inesperada WhatsApp → ${JSON.stringify(resp.data)}`);
  return null;
}

module.exports = { sendWhatsAppTemplateMultipleEvents };