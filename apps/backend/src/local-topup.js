const { ethers } = require('ethers');
const { logApiError, logUserEvent } = require('./logger');

const LOCAL_TOPUP_TRIGGER_WEI = ethers.parseEther('1');
const LOCAL_TOPUP_TARGET_WEI = ethers.parseEther('50');
const LOCAL_CHAIN_ID = 31337n;
const LOCAL_TOPUP_SIGNER_INDEX = Math.max(1, Number(process.env.LOCAL_TOPUP_SIGNER_INDEX || 1));

function resolveLocalRpcUrl() {
  return String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim();
}

async function fundLocalWalletIfNeeded(walletAddress) {
  const provider = new ethers.JsonRpcProvider(resolveLocalRpcUrl());
  const network = await provider.getNetwork();
  if (network.chainId !== LOCAL_CHAIN_ID) {
    throw new Error(`local rpc chainId mismatch: expected ${LOCAL_CHAIN_ID}, got ${network.chainId}`);
  }
  const normalizedWallet = ethers.getAddress(walletAddress);
  const currentBalance = await provider.getBalance(normalizedWallet);
  if (currentBalance >= LOCAL_TOPUP_TRIGGER_WEI) {
    return {
      funded: false,
      txHash: '',
      previousBalanceWei: currentBalance.toString(),
      fundedAmountWei: '0',
      finalBalanceWei: currentBalance.toString(),
    };
  }
  const accounts = await provider.send('eth_accounts', []);
  if (!Array.isArray(accounts) || accounts.length <= LOCAL_TOPUP_SIGNER_INDEX) {
    throw new Error(`local topup signer index ${LOCAL_TOPUP_SIGNER_INDEX} unavailable`);
  }
  const signerAddress = ethers.getAddress(accounts[LOCAL_TOPUP_SIGNER_INDEX]);
  if (signerAddress.toLowerCase() === normalizedWallet.toLowerCase()) {
    throw new Error(`local topup signer index ${LOCAL_TOPUP_SIGNER_INDEX} resolves to target wallet`);
  }
  const signer = await provider.getSigner(LOCAL_TOPUP_SIGNER_INDEX);
  const fundedAmount = LOCAL_TOPUP_TARGET_WEI - currentBalance;
  const tx = await signer.sendTransaction({
    to: normalizedWallet,
    value: fundedAmount,
  });
  const receipt = await tx.wait();
  const finalBalance = await provider.getBalance(normalizedWallet);
  return {
    funded: true,
    txHash: receipt?.hash || tx.hash || '',
    signerAddress,
    previousBalanceWei: currentBalance.toString(),
    fundedAmountWei: fundedAmount.toString(),
    finalBalanceWei: finalBalance.toString(),
  };
}

async function maybeTopupLocalWallet({ preferredNetwork, userId, walletAddress, requestId, stagePrefix }) {
  if (String(preferredNetwork || '').trim().toLowerCase() !== 'local') return;
  if (!walletAddress) return;
  try {
    const topupResult = await fundLocalWalletIfNeeded(walletAddress);
    logUserEvent(`${stagePrefix}.local-topup`, {
      requestId: requestId || '',
      userId,
      walletAddress,
      funded: topupResult.funded,
      txHash: topupResult.txHash,
      previousBalanceWei: topupResult.previousBalanceWei,
      fundedAmountWei: topupResult.fundedAmountWei,
      finalBalanceWei: topupResult.finalBalanceWei,
    });
  } catch (topupError) {
    logApiError(`${stagePrefix}.local-topup.failed`, {
      requestId: requestId || '',
      userId,
      walletAddress,
      preferredNetwork,
      message: topupError?.message || 'local_topup_failed',
    });
  }
}

module.exports = {
  LOCAL_TOPUP_TRIGGER_WEI,
  LOCAL_TOPUP_TARGET_WEI,
  LOCAL_CHAIN_ID,
  LOCAL_TOPUP_SIGNER_INDEX,
  fundLocalWalletIfNeeded,
  maybeTopupLocalWallet,
};
