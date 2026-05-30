/**
 * 一次性清理用户风控状态：
 * - unpaid_default_count -> 0
 * - risk_blocked_until -> ''
 *
 * 用法：
 *   node scripts/reset-user-risk.js --network sepolia --wallet 0x...
 *   node scripts/reset-user-risk.js --network local --user-id uid_xxx
 *   node scripts/reset-user-risk.js --network sepolia --all
 *   node scripts/reset-user-risk.js --network all --all
 */
const { getUserDb, saveUserDb, parseResult, resolveUserNetwork, getUserDbPath } = require('../apps/backend/src/user-db');

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeWallet(value) {
  const v = String(value || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? v.toLowerCase() : '';
}

function printUsageAndExit(code = 1) {
  console.log([
    'Usage:',
    '  node scripts/reset-user-risk.js --network sepolia --wallet 0x...',
    '  node scripts/reset-user-risk.js --network local --user-id uid_xxx',
    '  node scripts/reset-user-risk.js --network sepolia --all',
    '  node scripts/reset-user-risk.js --network all --all',
  ].join('\n'));
  process.exit(code);
}

async function resetForNetwork(network, { wallet, userId, resetAll }) {
  const db = await getUserDb(network);
  let targets = [];
  if (resetAll) {
    targets = parseResult(db.exec(
      `SELECT id, wallet_address, role, nickname, unpaid_default_count, risk_blocked_until
       FROM users
       WHERE COALESCE(unpaid_default_count, 0) <> 0 OR COALESCE(risk_blocked_until, '') <> ''
       ORDER BY created_at DESC`
    ));
    db.run(
      `UPDATE users
       SET unpaid_default_count = 0,
           risk_blocked_until = ''
       WHERE COALESCE(unpaid_default_count, 0) <> 0 OR COALESCE(risk_blocked_until, '') <> ''`
    );
  } else if (wallet) {
    targets = parseResult(db.exec(
      `SELECT id, wallet_address, role, nickname, unpaid_default_count, risk_blocked_until
       FROM users
       WHERE LOWER(wallet_address) = ?`,
      [wallet]
    ));
    db.run(
      `UPDATE users
       SET unpaid_default_count = 0,
           risk_blocked_until = ''
       WHERE LOWER(wallet_address) = ?`,
      [wallet]
    );
  } else if (userId) {
    targets = parseResult(db.exec(
      `SELECT id, wallet_address, role, nickname, unpaid_default_count, risk_blocked_until
       FROM users
       WHERE id = ?`,
      [userId]
    ));
    db.run(
      `UPDATE users
       SET unpaid_default_count = 0,
           risk_blocked_until = ''
       WHERE id = ?`,
      [userId]
    );
  } else {
    throw new Error('missing target');
  }

  const changed = db.getRowsModified();
  if (changed > 0) {
    saveUserDb(network);
  }

  return {
    network,
    dbPath: getUserDbPath(network),
    changed,
    targets,
  };
}

async function main() {
  const networkArg = String(readArg('--network') || '').trim().toLowerCase();
  const wallet = normalizeWallet(readArg('--wallet'));
  const userId = readArg('--user-id');
  const resetAll = hasFlag('--all');

  if (!networkArg) printUsageAndExit();
  if (!resetAll && !wallet && !userId) printUsageAndExit();
  if (wallet && userId) {
    throw new Error('请只提供 --wallet 或 --user-id 其中一个');
  }

  const networks = networkArg === 'all'
    ? ['sepolia', 'local']
    : [resolveUserNetwork(networkArg)];

  const summary = [];
  for (const network of networks) {
    const result = await resetForNetwork(network, { wallet, userId, resetAll });
    summary.push(result);
  }

  console.log(JSON.stringify({
    success: true,
    mode: resetAll ? 'all' : wallet ? 'wallet' : 'user-id',
    network: networkArg,
    wallet: wallet || '',
    userId: userId || '',
    results: summary,
  }, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
