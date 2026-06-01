const { parseResult } = require('./db');

function createNotificationId() {
  return `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNotificationText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function createNotification(db, {
  recipientId,
  actorId = '',
  actorRole = '',
  kind,
  entityType,
  entityId,
  title,
  body,
  metadata = {},
  dedupeKey = '',
  allowSelf = false,
}) {
  const normalizedRecipientId = String(recipientId || '').trim();
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedRecipientId) return null;
  if (!allowSelf && normalizedActorId && normalizedRecipientId === normalizedActorId) return null;
  const normalizedKind = normalizeNotificationText(kind);
  const normalizedEntityType = normalizeNotificationText(entityType);
  const normalizedEntityId = normalizeNotificationText(entityId);
  const normalizedTitle = normalizeNotificationText(title);
  const normalizedBody = normalizeNotificationText(body);
  if (!normalizedKind || !normalizedEntityType || !normalizedEntityId || !normalizedTitle || !normalizedBody) return null;

  db.run(
    `INSERT OR IGNORE INTO notifications (
      id, recipient_id, actor_id, actor_role, kind, entity_type, entity_id, title, body, metadata_json, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createNotificationId(),
      normalizedRecipientId,
      normalizedActorId,
      String(actorRole || '').trim(),
      normalizedKind,
      normalizedEntityType,
      normalizedEntityId,
      normalizedTitle,
      normalizedBody,
      JSON.stringify(metadata || {}),
      String(dedupeKey || '').trim() || null,
    ]
  );
  return db.getRowsModified() > 0;
}

function createNotifications(db, entries = []) {
  let inserted = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (createNotification(db, entry)) inserted += 1;
  }
  return inserted;
}

function listNotifications(db, recipientId, { limit = 50, unreadOnly = false } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 50)));
  const sql = unreadOnly
    ? `SELECT *
       FROM notifications
       WHERE recipient_id = ?
         AND COALESCE(read_at, '') = ''
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    : `SELECT *
       FROM notifications
       WHERE recipient_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT ?`;
  return parseResult(db.exec(sql, [String(recipientId || '').trim(), safeLimit]));
}

function markNotificationRead(db, recipientId, notificationId) {
  db.run(
    `UPDATE notifications
     SET read_at = CASE
       WHEN COALESCE(read_at, '') = '' THEN datetime('now', '+8 hours')
       ELSE read_at
     END
     WHERE id = ? AND recipient_id = ?`,
    [String(notificationId || '').trim(), String(recipientId || '').trim()]
  );
  return db.getRowsModified() > 0;
}

function markAllNotificationsRead(db, recipientId) {
  db.run(
    `UPDATE notifications
     SET read_at = datetime('now', '+8 hours')
     WHERE recipient_id = ?
       AND COALESCE(read_at, '') = ''`,
    [String(recipientId || '').trim()]
  );
  return Number(db.getRowsModified() || 0);
}

function getUnreadNotificationCount(db, recipientId) {
  const rows = parseResult(db.exec(
    `SELECT COUNT(*) AS count
     FROM notifications
     WHERE recipient_id = ?
       AND COALESCE(read_at, '') = ''`,
    [String(recipientId || '').trim()]
  ));
  return Number(rows[0]?.count || 0);
}

module.exports = {
  createNotification,
  createNotifications,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
};
