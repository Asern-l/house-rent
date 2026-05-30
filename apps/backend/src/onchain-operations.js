/**
 * 文件说明：统一链上操作总账工具。
 * 负责记录所有链上交易的 pending/confirmed/failed 状态，作为后台补偿入口。
 */

function safeJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value || {}, (_, current) => (typeof current === 'bigint' ? current.toString() : current));
  } catch {
    return fallback;
  }
}

function upsertOnchainOperation(db, payload) {
  db.run(
    `INSERT INTO onchain_operations (
      op_id, entity_type, entity_id, operation_kind, tx_hash, status,
      request_id, payload_json, result_json, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(op_id) DO UPDATE SET
       tx_hash = excluded.tx_hash,
       status = excluded.status,
       request_id = excluded.request_id,
       payload_json = excluded.payload_json,
       result_json = excluded.result_json,
       error_message = excluded.error_message,
       updated_at = datetime('now', '+8 hours')`,
    [
      String(payload.opId || '').trim(),
      String(payload.entityType || '').trim(),
      String(payload.entityId || '').trim(),
      String(payload.operationKind || '').trim(),
      String(payload.txHash || '').trim().toLowerCase(),
      String(payload.status || 'pending').trim(),
      String(payload.requestId || '').trim(),
      safeJson(payload.payload, '{}'),
      safeJson(payload.result, '{}'),
      String(payload.errorMessage || '').trim(),
    ]
  );
}

function markOnchainOperationConfirmed(db, payload) {
  upsertOnchainOperation(db, { ...payload, status: 'confirmed', errorMessage: '' });
}

function markOnchainOperationFailed(db, payload) {
  upsertOnchainOperation(db, { ...payload, status: 'failed' });
}

function buildOperationKindsSql(operationKinds = []) {
  const normalized = Array.isArray(operationKinds)
    ? operationKinds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!normalized.length) {
    return { clause: '', params: [] };
  }
  return {
    clause: ` AND operation_kind IN (${normalized.map(() => '?').join(', ')})`,
    params: normalized,
  };
}

function getLatestOnchainOperation(db, entityType, entityId, operationKinds = []) {
  const { clause, params } = buildOperationKindsSql(operationKinds);
  const result = db.exec(
    `SELECT *
     FROM onchain_operations
     WHERE entity_type = ?
       AND entity_id = ?${clause}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [String(entityType || '').trim(), String(entityId || '').trim(), ...params]
  );
  if (!result.length || !result[0].values.length) return null;
  const { columns, values } = result[0];
  const row = {};
  columns.forEach((column, index) => {
    row[column] = values[0][index];
  });
  return row;
}

function getLatestOnchainStatus(db, entityType, entityId, operationKinds = []) {
  const row = getLatestOnchainOperation(db, entityType, entityId, operationKinds);
  if (!row) {
    return {
      status: 'not_started',
      errorMessage: '',
      txHash: '',
      operationKind: '',
      updatedAt: '',
      requestId: '',
    };
  }
  return {
    status: String(row.status || 'not_started').trim() || 'not_started',
    errorMessage: String(row.error_message || '').trim(),
    txHash: String(row.tx_hash || '').trim(),
    operationKind: String(row.operation_kind || '').trim(),
    updatedAt: String(row.updated_at || row.created_at || '').trim(),
    requestId: String(row.request_id || '').trim(),
  };
}

module.exports = {
  upsertOnchainOperation,
  markOnchainOperationConfirmed,
  markOnchainOperationFailed,
  getLatestOnchainOperation,
  getLatestOnchainStatus,
};
