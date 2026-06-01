const express = require('express');
const { getDb, saveDb } = require('../db');
const { authMiddleware } = require('../auth');
const { sendError } = require('../app-error');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
} = require('../notifications');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const unreadOnly = String(req.query?.unreadOnly || '').trim() === '1';
  const limit = Number(req.query?.limit || 50);
  const items = listNotifications(db, req.user.id, { unreadOnly, limit });
  res.json({ success: true, data: items });
}));

router.get('/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  res.json({
    success: true,
    data: {
      unreadCount: getUnreadNotificationCount(db, req.user.id),
    },
  });
}));

router.post('/:id/read', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const ok = markNotificationRead(db, req.user.id, req.params.id);
  if (!ok) return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', '通知不存在');
  saveDb();
  res.json({ success: true });
}));

router.post('/read-all', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const updated = markAllNotificationsRead(db, req.user.id);
  saveDb();
  res.json({ success: true, data: { updated } });
}));

module.exports = router;
