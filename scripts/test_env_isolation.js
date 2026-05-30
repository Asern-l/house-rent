const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'apps', 'backend');
const frontendEnvPath = path.join(rootDir, 'apps', 'frontend', '.env');
const deployLocalPath = path.join(rootDir, 'blockchain', 'deployments-rental-localhost.json');
const deploySepoliaPath = path.join(rootDir, 'blockchain', 'deployments-rental-sepolia.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

async function waitHealth(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const payload = await getJson(`http://127.0.0.1:${port}/api/health`);
      if (payload?.success) return payload;
    } catch {}
    await sleep(300);
  }
  throw new Error(`health timeout on ${port}`);
}

async function waitConsoleStatus(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const payload = await getJson(`http://127.0.0.1:${port}/api/console/status`);
      if (payload?.success && payload?.data) return payload.data;
    } catch {}
    await sleep(300);
  }
  throw new Error(`console status timeout on ${port}`);
}

function start(env, port) {
  return spawn('node', ['src/index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      CHAIN_ENV: env,
      PORT: String(port),
      JWT_SECRET: 'env_isolation_test_secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stop(proc) {
  if (!proc) return;
  if (proc.exitCode === null && !proc.killed) {
    try {
      proc.kill();
    } catch {}
  }
}

function readDeployment(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing deployment file: ${path.basename(filePath)}`);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const address = String(parsed.address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`invalid deployment address in ${path.basename(filePath)}`);
  }
  return address.toLowerCase();
}

function readFrontendEnv() {
  if (!fs.existsSync(frontendEnvPath)) throw new Error('missing apps/frontend/.env');
  const text = fs.readFileSync(frontendEnvPath, 'utf8');
  const pairs = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    pairs[key] = value;
  }
  return pairs;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const local = start('local', 3021);
  const sepolia = start('sepolia', 3022);

  local.stdout.on('data', (b) => process.stdout.write(`[local] ${b}`));
  local.stderr.on('data', (b) => process.stderr.write(b));
  sepolia.stdout.on('data', (b) => process.stdout.write(`[sepolia] ${b}`));
  sepolia.stderr.on('data', (b) => process.stderr.write(b));

  try {
    const [localHealth, sepoliaHealth] = await Promise.all([
      waitHealth(3021),
      waitHealth(3022),
    ]);
    const [localConsole, sepoliaConsole] = await Promise.all([
      waitConsoleStatus(3021),
      waitConsoleStatus(3022),
    ]);

    const localDeployAddress = readDeployment(deployLocalPath);
    const sepoliaDeployAddress = readDeployment(deploySepoliaPath);
    const frontendEnv = readFrontendEnv();
    const frontendLocal = String(frontendEnv.VITE_CONTRACT_ADDRESS_LOCAL || '').trim().toLowerCase();
    const frontendSepolia = String(frontendEnv.VITE_CONTRACT_ADDRESS_SEPOLIA || '').trim().toLowerCase();

    assert(localHealth.chainEnv === 'local', 'local /api/health returned wrong chainEnv');
    assert(sepoliaHealth.chainEnv === 'sepolia', 'sepolia /api/health returned wrong chainEnv');
    assert(localHealth.dbFile !== sepoliaHealth.dbFile, 'health dbFile is not isolated');

    assert(localConsole.chainEnv === 'local', 'local /api/console/status returned wrong chainEnv');
    assert(sepoliaConsole.chainEnv === 'sepolia', 'sepolia /api/console/status returned wrong chainEnv');
    assert(localConsole.dbFile !== sepoliaConsole.dbFile, 'console dbFile is not isolated');
    assert(String(localConsole.port) === '3021', 'local console port mismatch');
    assert(String(sepoliaConsole.port) === '3022', 'sepolia console port mismatch');

    assert(String(localConsole.rentalChainAddress || '').trim().toLowerCase() === localDeployAddress,
      'local backend contract address mismatches localhost deployment file');
    assert(String(sepoliaConsole.rentalChainAddress || '').trim().toLowerCase() === sepoliaDeployAddress,
      'sepolia backend contract address mismatches sepolia deployment file');

    assert(frontendLocal === localDeployAddress,
      'frontend VITE_CONTRACT_ADDRESS_LOCAL mismatches localhost deployment file');
    assert(frontendSepolia === sepoliaDeployAddress,
      'frontend VITE_CONTRACT_ADDRESS_SEPOLIA mismatches sepolia deployment file');

    console.log('PASS: env isolation checks passed');
    console.log(JSON.stringify({
      local: {
        chainEnv: localConsole.chainEnv,
        dbFile: localConsole.dbFile,
        contractAddress: localConsole.rentalChainAddress,
      },
      sepolia: {
        chainEnv: sepoliaConsole.chainEnv,
        dbFile: sepoliaConsole.dbFile,
        contractAddress: sepoliaConsole.rentalChainAddress,
      },
    }, null, 2));
  } finally {
    stop(local);
    stop(sepolia);
  }
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
