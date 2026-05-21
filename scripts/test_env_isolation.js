const { spawn } = require('child_process');

const backendDir = `${__dirname}/../apps/backend`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHealth(port) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return res.json();
    } catch {}
    await sleep(300);
  }
  throw new Error(`health timeout on ${port}`);
}

function start(env, port) {
  return spawn('node', ['src/index.js'], {
    cwd: backendDir,
    env: { ...process.env, CHAIN_ENV: env, PORT: String(port), JWT_SECRET: 'env_isolation_test_secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

(async () => {
  const local = start('local', 3021);
  const sepolia = start('sepolia', 3022);
  local.stderr.on('data', (b) => process.stderr.write(b));
  sepolia.stderr.on('data', (b) => process.stderr.write(b));
  try {
    const localHealth = await waitHealth(3021);
    const sepoliaHealth = await waitHealth(3022);
    if (localHealth.chainEnv !== 'local') throw new Error('local backend returned wrong chainEnv');
    if (sepoliaHealth.chainEnv !== 'sepolia') throw new Error('sepolia backend returned wrong chainEnv');
    if (localHealth.dbFile === sepoliaHealth.dbFile) throw new Error('dbFile is not isolated');
    console.log('PASS: local/sepolia backends use isolated chainEnv and dbFile');
  } finally {
    local.kill('SIGTERM');
    sepolia.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
