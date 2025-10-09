const axios = require('axios');
const logger = require('../utils/logger');

// ⚙️ Configuración — usa tus valores reales
const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages'; // ID de número de WhatsApp
const WHATSAPP_TOKEN = 'EAAR0i6DhhjIBO5ZCuHiH29grsbd4mYQ6ydZB1KLAWqZBBPKSh15fz2m37jnhUP1OnfyUniM5LVMBfxg1S6TTRR9AOSnbL2ZBKGEIZAkIJXbUO5rfGcFZCCilRLR0PsZAVR52ZAF4RNfGIGex7y7O1aZAX7F6GzW98CYDsRcF7K8rIT7R8ZCQFesbYPgVN4KZC2FdaEZCwwZDZD';

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

/**
 * Enviar mensaje de plantilla a WhatsApp (alerta_siniestro)
 * @param {string} number Número en formato internacional (ej. 5212227086105)
 * @param {string} contactName Nombre del contacto
 * @param {string} companyName Nombre de la empresa
 * @param {string} [coords] Coordenadas opcionales
 */
async function sendWhatsAppTemplate(number, contactName, label, coords = '0,0') {
  const body = {
    messaging_product: 'whatsapp',
    to: String(number),
    type: 'template',
    template: {
      name: 'alerta_siniestro', // nombre de tu plantilla aprobada
      language: { code: 'es_MX' },
      components: [
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
        // Si activas body con variables, descomenta este bloque
        // {
        //   type: 'body',
        //   parameters: [
        //     { type: 'text', text: contactName },
        //     { type: 'text', text: companyName },
        //   ],
        // },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            {
              type: 'text',
              text: coords, // Ej. "24.626428,-107.463373"
            },
          ],
        },
      ],
    },
  };

  try {
    const response = await axios.post(WHATSAPP_URL, body, { headers });
    logger.info(`✅ Mensaje WhatsApp enviado a ${number}: ${contactName || '(sin nombre)'}`);
    return response.data;
  } catch (error) {
    logger.error(`❌ Error enviando WhatsApp a ${number}: ${error.response?.data?.error?.message || error.message}`);
    return null;
  }
}

/**
 * Enviar prueba masiva a contactos definidos
 */
async function sendTestAlerts() {
  const testContacts = [
    { number: '5212227086105', contactName: 'David Hernández', companyName: 'DLA' },
  ];

  const responses = [];
  for (const c of testContacts) {
    const res = await sendWhatsAppTemplate(c.number, c.contactName, c.companyName, '24.626428,-107.463373');
    responses.push(res);
  }
  return responses;
}

module.exports = {
  sendWhatsAppTemplate,
  sendTestAlerts,
};
