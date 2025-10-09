const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function logNavixyEvent({ companyId, trackerId, sourceId, eventType, eventCode, subEventCode, payload }) {
  const query = `
    INSERT INTO navixy_events_logs 
    (company_id, tracker_id, source_id, event_type, event_code, sub_event_code, raw_payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  await pool.query(query, [
    companyId,
    trackerId || null,
    sourceId || null,
    eventType,
    eventCode || null,
    subEventCode || null,
    JSON.stringify(payload),
  ]);
}

module.exports = {
  logNavixyEvent
};
