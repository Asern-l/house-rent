const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const artifactPath = path.join(root, 'blockchain', 'artifacts', 'contracts', 'RentalChain.sol', 'RentalChain.json');
const abiTargetPath = path.join(root, 'apps', 'frontend', 'src', 'shared', 'blockchain', 'RentalChainABI.json');
const frontendEnvPath = path.join(root, 'apps', 'frontend', '.env');

const mode = process.argv.includes('--write') ? 'write' : 'check';

function stable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function updateEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, 'm').test(text)) {
    return text.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  }
  return `${text.trimEnd()}\n${line}\n`;
}

if (!fs.existsSync(artifactPath)) {
  console.error(`ABI source not found: ${artifactPath}`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const expectedAbi = stable(artifact.abi);
const currentAbi = fs.existsSync(abiTargetPath) ? fs.readFileSync(abiTargetPath, 'utf8') : '';
const abiMatches = currentAbi.trim() === expectedAbi.trim();

if (!abiMatches && mode === 'check') {
  console.error('ABI drift detected. Run npm run sync:abi.');
  process.exit(1);
}

if (!abiMatches && mode === 'write') {
  fs.writeFileSync(abiTargetPath, expectedAbi);
  console.log(`Synced ABI -> ${abiTargetPath}`);
}

if (mode === 'write' && fs.existsSync(frontendEnvPath)) {
  let envText = fs.readFileSync(frontendEnvPath, 'utf8');
  const deploymentMap = [
    ['LOCAL', path.join(root, 'blockchain', 'deployments-rental-localhost.json')],
    ['SEPOLIA', path.join(root, 'blockchain', 'deployments-rental-sepolia.json')],
  ];
  for (const [key, file] of deploymentMap) {
    if (!fs.existsSync(file)) continue;
    const deployment = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^0x[a-fA-F0-9]{40}$/.test(String(deployment.address || ''))) {
      envText = updateEnvValue(envText, `VITE_CONTRACT_ADDRESS_${key}`, deployment.address);
    }
  }
  fs.writeFileSync(frontendEnvPath, envText);
  console.log(`Checked deployment addresses -> ${frontendEnvPath}`);
}

console.log(abiMatches ? 'ABI is in sync.' : 'ABI synced.');
