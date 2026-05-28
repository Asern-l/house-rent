import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';
import { ethers } from 'ethers';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';
import toast from 'react-hot-toast';
import { FileTextIcon, CheckCircleIcon, LoaderIcon, ArrowLeftIcon } from 'lucide-react';

const CONTRACT_ADDR_MAP = {
  sepolia: import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '',
  local:   import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL  || '',
};

const genRequestId = () => `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const NETWORK_OPTIONS = [
  {
    key: 'sepolia', label: 'Sepolia', chainId: 11155111, chainIdHex: '0xaa36a7',
    addParams: {
      chainId: '0xaa36a7', chainName: 'Sepolia Testnet',
      nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
  {
    key: 'local', label: 'Local EVM (31337)', chainId: 31337, chainIdHex: '0x7a69',
    addParams: {
      chainId: '0x7a69', chainName: 'Local EVM (31337)',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['http://127.0.0.1:8545'],
    },
  },
];

const TX_EXPLORER_BASE = { sepolia: 'https://sepolia.etherscan.io/tx/', local: '' };

function getErrorMessage(error) {
  return String(
    error?.shortMessage
    || error?.info?.error?.message
    || error?.error?.message
    || error?.reason
    || error?.message
    || ''
  ).trim();
}

function isWalletRpcSessionError(error) {
  const message = getErrorMessage(error).toLowerCase();
  const code = Number(error?.code ?? error?.info?.error?.code ?? error?.error?.code);
  return (
    message.includes('could not coalesce error')
    || message.includes('rpc endpoint returned too many errors')
    || message.includes('internal json-rpc error')
    || message.includes('missing revert data')
    || code === -32002
    || code === -32603
  );
}

function resolvePaymentErrorMessage(error) {
  if (error?.code === 'WALLET_SESSION_MISSING' || getErrorMessage(error).includes('wallet_session_missing')) {
    return 'MetaMask 当前站点连接已断开，请重新连接钱包后再支付。';
  }
  if (isWalletRpcSessionError(error)) {
    return '钱包连接或 RPC 会话异常，请断开 MetaMask 连接后重新连接，再重试支付。若仍失败，请切换 Sepolia RPC 节点。';
  }
  const message = getErrorMessage(error);
  if (message.includes('user rejected')) return '你已取消本次钱包操作。';
  if (message.includes('insufficient funds')) return '钱包余额不足，无法完成支付和 gas 支付。';
  if (message.includes('contract runner does not support sending transactions')) return '当前钱包连接状态无效，请重新连接 MetaMask 后重试。';
  return message || error?.response?.data?.error || '支付失败';
}

function resolveGasAuthErrorMessage(error) {
  if (error?.code === 'WALLET_SESSION_MISSING' || getErrorMessage(error).includes('wallet_session_missing')) {
    return 'MetaMask 当前站点连接已断开，请重新连接钱包后再重试。';
  }
  if (isWalletRpcSessionError(error)) {
    return '钱包连接或 RPC 会话异常，请断开 MetaMask 连接后重新连接，再重试。若仍失败，请切换 Sepolia RPC 节点。';
  }
  const message = getErrorMessage(error);
  if (message.includes('user rejected')) return '你已取消本次钱包操作。';
  if (message.includes('insufficient funds')) return '钱包余额不足，无法完成 gas 锁仓或撤销。';
  return message || error?.response?.data?.error || '操作失败';
}

function resolveInitialAmount(content) {
  const direct = Number(content?.oneTimeAmount);
  if (Number.isFinite(direct) && direct > 0) return String(content.oneTimeAmount);
  const rent = Number(content?.rentAmount);
  const months = Number(content?.terms?.leaseMonths);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(months) || months <= 0) return '';
  return String((rent * months).toFixed(8).replace(/\.?0+$/, ''));
}

function createSignMessage({ contractId, contentHash, role, signerAddress, timestamp, deadline }) {
  return [
    'CCL Housing Contract Signature',
    `contractId:${contractId}`,
    `contentHash:${contentHash}`,
    `role:${role}`,
    `signer:${ethers.getAddress(signerAddress)}`,
    `timestamp:${timestamp}`,
    `deadline:${deadline}`,
  ].join('\n');
}

function buildMessageHash(message) {
  const raw = String(message || '').trim();
  return raw ? ethers.keccak256(ethers.toUtf8Bytes(raw)) : ethers.ZeroHash;
}

function resolveContractSignDeadlineMs(contract) {
  const raw = String(contract?.created_at || '').trim();
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return Date.now() + 26 * 60 * 60 * 1000;
  return d.getTime() + 26 * 60 * 60 * 1000;
}

function parseSignedAtMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveContractEndAtMs(contract) {
  const endDate = String(contract?.content_json?.terms?.endDate || contract?.content?.terms?.endDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return 0;
  const endAt = new Date(`${endDate}T23:59:59+08:00`);
  return Number.isNaN(endAt.getTime()) ? 0 : endAt.getTime();
}

function toDeadlineEpoch(value) {
  const raw = String(value || '').trim();
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  return Math.floor(d.getTime() / 1000);
}

const STATUS_MAP = {
  pending:         { label: '待签署', color: 'badge-yellow' },
  tenant_signed:   { label: '租客已签', color: 'badge-blue' },
  pending_payment: { label: '待支付', color: 'badge-yellow' },
  landlord_signed: { label: '房东已签', color: 'badge-blue' },
  active:          { label: '已生效', color: 'badge-green' },
  ended:           { label: '已结束', color: 'badge-gray' },
  cancelled:       { label: '已取消', color: 'badge-red' },
  expired:         { label: '已过期', color: 'badge-gray' },
};

export default function ContractPage() {
  const { id } = useParams();
  const { user, preferredNetwork } = useAuth();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payments, setPayments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [lastTxHash, setLastTxHash] = useState('');
  const [clausesText, setClausesText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [proposing, setProposing] = useState(false);

  const initialAmount = resolveInitialAmount(content);
  const selectedNetwork = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
  const txExplorerBase = TX_EXPLORER_BASE[selectedNetwork.key] || '';

  const loadContract = async () => {
    const d = await apiGet(`/contracts/${id}`);
    setContract(d.data);
    try {
      setContent(typeof d.data.content_json === 'string' ? JSON.parse(d.data.content_json) : d.data.content_json);
      const parsed = typeof d.data.content_json === 'string' ? JSON.parse(d.data.content_json) : d.data.content_json;
      const clauses = Array.isArray(parsed?.clauses) ? parsed.clauses : [];
      setClausesText(clauses.join('\n'));
      setChangeNote('');
    } catch {
      setContent(d.data.content_json);
    }
    const paymentResp = await apiGet(`/contracts/${id}/payments`);
    setPayments(paymentResp?.data || []);
    const versionResp = await apiGet(`/contracts/${id}/versions`);
    setVersions(versionResp?.data || []);
  };

  useEffect(() => {
    loadContract().catch(() => toast.error('加载合同失败')).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const latestProposal = versions.find((item) => item.status === 'proposed');
    if (!latestProposal) return;
    try {
      const proposalContent = typeof latestProposal.content_json === 'string'
        ? JSON.parse(latestProposal.content_json)
        : latestProposal.content_json;
      const proposalClauses = Array.isArray(proposalContent?.clauses) ? proposalContent.clauses : [];
      if (proposalClauses.length > 0) {
        setClausesText(proposalClauses.join('\n'));
      }
    } catch {
      // ignore invalid proposal content_json
    }
  }, [versions]);

  const expectedWallet = (type) => {
    const addr = type === 'tenant' ? content?.tenant?.walletAddress : content?.landlord?.walletAddress;
    return (addr || '').trim().toLowerCase();
  };

  const handleSign = async (type) => {
    if (!window.ethereum) { toast.error('请先安装 MetaMask 钱包'); return; }
    const requestId = genRequestId();
    const selected = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
    const contractAddr = String(CONTRACT_ADDR_MAP[selected.key] || '').trim();
    setSigning(true);

    const reportClientFailure = async (payload) => {
      try {
        await apiPost(`/contracts/${id}/sign-client-report`, payload, { headers: { 'X-Request-Id': requestId } });
      } catch { /* ignore */ }
    };

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== selected.chainId) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
        } catch {
          try {
            await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [selected.addParams] });
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
          } catch {
            await reportClientFailure({ type, preferredNetwork: selected.key, message: 'wallet_switchEthereumChain 调用失败', apiStatus: null, apiError: { reason: 'switch_to_sepolia_failed' }, walletAddress: '', chainId: String(net.chainId), pageUrl: window.location.href });
            toast.error(`请将 MetaMask 切换到 ${selected.label}`);
            return;
          }
        }
      }

      const accounts = await provider.send('eth_requestAccounts', []);
      const signerAddress = (accounts[0] || '').trim();
      if (!ethers.isAddress(signerAddress)) {
        await reportClientFailure({ type, preferredNetwork: selected.key, message: 'MetaMask 返回的钱包地址无效', apiStatus: null, apiError: { reason: 'invalid_wallet_address' }, walletAddress: signerAddress, chainId: String(net.chainId), pageUrl: window.location.href });
        toast.error('MetaMask 返回的钱包地址无效');
        return;
      }

      const boundAddress = expectedWallet(type);
      if (boundAddress && boundAddress !== signerAddress.toLowerCase()) {
        await reportClientFailure({ type, preferredNetwork: selected.key, message: '钱包地址不匹配', apiStatus: null, apiError: { reason: 'wallet_mismatch', boundAddress }, walletAddress: signerAddress, chainId: String(net.chainId), pageUrl: window.location.href });
        toast.error(`当前钱包与合同绑定地址不一致：${boundAddress}`);
        return;
      }

      const signer = await provider.getSigner();
      let message = '';
      let signature = '';
      let gasAuthorization = null;
      if (type === 'tenant') {
        const timestamp = Date.now();
        const deadline = resolveContractSignDeadlineMs(contract);
        message = createSignMessage({
          contractId: id,
          contentHash: contract?.content_hash || '',
          role: type,
          signerAddress,
          timestamp,
          deadline,
        });
        signature = await signer.signMessage(message);
        const gasAuthPrepare = await apiGet(`/contracts/${id}/gas-authorization/prepare`);
        const gasAuthData = gasAuthPrepare?.data || {};
        const gasAuthDigest = String(gasAuthData.digest || '').trim();
        if (!gasAuthDigest) {
          toast.error('gas 授权参数缺失，请稍后重试');
          return;
        }
        if (!ethers.isAddress(contractAddr)) {
          toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`);
          return;
        }
        const gasAuthSignature = await signer.signMessage(ethers.getBytes(gasAuthDigest));
        const tenantContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
        let lockTxHash = '';
        try {
          await tenantContract.lockGasCompensationEscrow.staticCall(
            id,
            contract?.content_hash || ethers.ZeroHash,
            signerAddress,
            String(gasAuthData.landlordAddress || '').trim(),
            BigInt(String(gasAuthData.capWei || '0')),
            BigInt(String(gasAuthData.deadline || 0)),
            String(gasAuthData.nonce || ''),
            gasAuthSignature,
            { value: BigInt(String(gasAuthData.capWei || '0')) }
          );
          await tenantContract.lockGasCompensationEscrow.estimateGas(
            id,
            contract?.content_hash || ethers.ZeroHash,
            signerAddress,
            String(gasAuthData.landlordAddress || '').trim(),
            BigInt(String(gasAuthData.capWei || '0')),
            BigInt(String(gasAuthData.deadline || 0)),
            String(gasAuthData.nonce || ''),
            gasAuthSignature,
            { value: BigInt(String(gasAuthData.capWei || '0')) }
          );
          const lockTx = await tenantContract.lockGasCompensationEscrow(
            id,
            contract?.content_hash || ethers.ZeroHash,
            signerAddress,
            String(gasAuthData.landlordAddress || '').trim(),
            BigInt(String(gasAuthData.capWei || '0')),
            BigInt(String(gasAuthData.deadline || 0)),
            String(gasAuthData.nonce || ''),
            gasAuthSignature,
            { value: BigInt(String(gasAuthData.capWei || '0')) }
          );
          await lockTx.wait();
          lockTxHash = String(lockTx.hash || '');
          setLastTxHash(lockTxHash);
        } catch (lockErr) {
          await reportClientFailure({
            type,
            preferredNetwork: selected.key,
            phase: 'gas_auth_lock',
            message: lockErr?.message || '',
            apiStatus: null,
            apiError: null,
            walletAddress: signerAddress,
            chainId: String(selected.chainId),
            contractAddress: contractAddr,
            amount: ethers.formatEther(String(gasAuthData.capWei || '0')),
            pageUrl: window.location.href,
          });
          toast.error(`gas 锁仓失败：${resolveGasAuthErrorMessage(lockErr)}`);
          return;
        }
        gasAuthorization = {
          capWei: String(gasAuthData.capWei || ''),
          deadline: Number(gasAuthData.deadline || 0),
          nonce: String(gasAuthData.nonce || ''),
          chainId: Number(gasAuthData.chainId || 0),
          contractAddress: String(gasAuthData.contractAddress || ''),
          digest: gasAuthDigest,
          signature: gasAuthSignature,
          lockTxHash,
        };
      } else {
        const timestamp = Date.now();
        const deadline = resolveContractSignDeadlineMs(contract);
        message = createSignMessage({
          contractId: id,
          contentHash: contract?.content_hash || '',
          role: type,
          signerAddress,
          timestamp,
          deadline,
        });
        signature = await signer.signMessage(message);
        const gasAuthNonce = String(contract?.gas_auth?.nonce || '').trim();
        const parentContractId = String(contract?.parent_contract_id || contract?.content_json?.parentContractId || '').trim();
        const endAtMs = resolveContractEndAtMs(contract);
        if (!/^0x[a-fA-F0-9]{64}$/.test(gasAuthNonce)) {
          toast.error('当前合同缺少有效的 gas 授权 nonce，无法完成房东签署');
          return;
        }
        if (!endAtMs || endAtMs <= Date.now()) {
          toast.error('当前合同缺少有效的结束日期，无法完成房东签署');
          return;
        }
        if (!ethers.isAddress(contractAddr)) {
          toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`);
          return;
        }
        try {
          const chainContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
          const tenantMessage = String(contract?.tenant_signature_message || '').trim();
          const tenantSignature = String(contract?.tenant_signature || '').trim();
          const tenantSignedAt = parseSignedAtMs(contract?.tenant_signed_at);
          const landlordSignedAt = Date.now();
          const startAtMs = (() => {
            const exact = Number(content?.renewal?.startAtMs || 0);
            if (Number.isFinite(exact) && exact > 0) return exact;
            const raw = String(content?.terms?.startDate || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
            const d = new Date(`${raw}T00:00:00+08:00`);
            return Number.isNaN(d.getTime()) ? 0 : d.getTime();
          })();
          const createParams = {
            contractId: id,
            listingId: String(contract?.listing_id || ''),
            parentContractId,
            tenant: content?.tenant?.walletAddress || ethers.ZeroAddress,
            landlord: signerAddress,
            contentHash: contract?.content_hash || ethers.ZeroHash,
            gasAuthNonce,
            initialAmountWei: ethers.parseEther(String(initialAmount || '0')),
            startAtMs,
            endAtMs,
            tenantMessageHash: buildMessageHash(tenantMessage),
            landlordMessageHash: buildMessageHash(message),
            tenantSignedAt,
            landlordSignedAt,
            tenantSignature,
            landlordSignature: signature,
          };
          await chainContract.createContractRecord.staticCall(createParams);
          const estimatedGas = await chainContract.createContractRecord.estimateGas(createParams);
          const gasLimit = (estimatedGas * 120n) / 100n;
          const onchainTx = await chainContract.createContractRecord(createParams, { gasLimit });
          await onchainTx.wait();
          gasAuthorization = { txHash: String(onchainTx.hash || '') };
          setLastTxHash(String(onchainTx.hash || ''));
        } catch (landlordOnchainErr) {
          await reportClientFailure({
            type,
            preferredNetwork: selected.key,
            phase: 'landlord_onchain',
            message: landlordOnchainErr?.message || '',
            apiStatus: null,
            apiError: null,
            walletAddress: signerAddress,
            chainId: String(selected.chainId),
            contractAddress: contractAddr,
            pageUrl: window.location.href,
          });
          toast.error(`房东上链失败：${resolveGasAuthErrorMessage(landlordOnchainErr)}`);
          return;
        }
      }

      const res = await apiPost(
        `/contracts/${id}/${type === 'tenant' ? 'sign-tenant' : 'sign-landlord'}`,
        { signerAddress, message, signature, gasAuthorization, txHash: type === 'landlord' ? String(gasAuthorization?.txHash || '') : '' },
        { headers: { 'X-Request-Id': requestId } }
      );

      if (type === 'landlord' && res.data?.txHash) setLastTxHash(res.data.txHash);

      toast.success(res.message || '签署成功');
      await loadContract();
    } catch (err) {
      const apiErr = err.response?.data;
      let walletAddress = '';
      let chainId = '';
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_accounts', []);
        walletAddress = (accounts[0] || '').trim();
        chainId = String((await provider.getNetwork())?.chainId || '');
      } catch { /* ignore */ }

      await reportClientFailure({ type, preferredNetwork: selected.key, message: err?.message || '', apiStatus: err.response?.status || null, apiError: apiErr || null, walletAddress, chainId, pageUrl: window.location.href });

      if (apiErr?.currentStatus) {
        try { await loadContract(); } catch { /* ignore */ }
        if (apiErr.currentStatus === 'active') toast.success('合同已生效，无需重复签署');
        else toast.error(`${apiErr.error} (server status: ${apiErr.currentStatus})`);
      } else {
        toast.error(apiErr?.error || '签署失败');
      }
    } finally {
      setSigning(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('确认要取消这份合同吗？')) return;
    try {
      if (contract?.gas_auth?.status === 'active' && contract?.gas_auth?.lock_tx_hash && !contract?.landlord_signed_at) {
        if (!window.ethereum) { toast.error('请先安装 MetaMask 钱包'); return; }
        const selected = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
        const contractAddr = String(CONTRACT_ADDR_MAP[selected.key] || '').trim();
        if (!ethers.isAddress(contractAddr)) {
          toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`);
          return;
        }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== selected.chainId) {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
        }
        const signer = await provider.getSigner();
        const signerAddress = String((await signer.getAddress()) || '').trim();
        const boundAddress = isTenant ? expectedWallet('tenant') : isLandlord ? expectedWallet('landlord') : '';
        if (boundAddress && signerAddress.toLowerCase() !== boundAddress) {
          toast.error(`当前钱包与合同绑定地址不一致：${boundAddress}`);
          return;
        }
        const tenantContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
        try {
          const tenantAddress = String(contract?.gas_auth?.tenant_address || content?.tenant?.walletAddress || '').trim();
          const revokeTx = await tenantContract.cancelPendingGasAuthorization(
            id,
            tenantAddress,
            String(contract.gas_auth.nonce || ''),
          );
          await revokeTx.wait();
          await apiPost(`/contracts/${id}/gas-authorization/revoke`, { txHash: String(revokeTx.hash || '') });
          setLastTxHash(String(revokeTx.hash || ''));
        } catch (revokeErr) {
          const revokeMsg = getErrorMessage(revokeErr);
          if (!revokeMsg.includes('only active authorization can revoke') && !revokeMsg.includes('authorization not found')) {
            throw revokeErr;
          }
        }
      }
      await apiPost(`/contracts/${id}/cancel`);
      toast.success('合同已取消');
      navigate('/contracts');
    } catch (err) {
      const requestId = genRequestId();
      await apiPost(`/contracts/${id}/sign-client-report`, { type: 'cancel', preferredNetwork, message: err?.message || '取消合同失败', apiStatus: err.response?.status || null, apiError: err.response?.data || null, walletAddress: '', chainId: '', pageUrl: window.location.href }, { headers: { 'X-Request-Id': requestId } }).catch(() => {});
      toast.error(err.response?.data?.error || '取消失败');
    }
  };

  const handleInitialPayment = async () => {
    if (!window.ethereum) { toast.error('请先安装 MetaMask 钱包'); return; }
    if (!initialAmount || Number(initialAmount) <= 0) { toast.error('合同首笔支付金额无效'); return; }
    const selected = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
    const contractAddr = String(CONTRACT_ADDR_MAP[selected.key] || '').trim();
    const requestId = genRequestId();
    setPaying(true);
    const reportClientFailure = async (payload) => {
      try {
        await apiPost(`/contracts/${id}/sign-client-report`, payload, { headers: { 'X-Request-Id': requestId } });
      } catch { /* ignore */ }
    };
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== selected.chainId) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
        } catch (switchErr) {
          await reportClientFailure({
            type: 'payment',
            preferredNetwork: selected.key,
            message: switchErr?.message || 'wallet_switchEthereumChain 调用失败',
            apiStatus: null,
            apiError: { reason: 'switch_chain_failed' },
            walletAddress: '',
            chainId: String(network.chainId),
            pageUrl: window.location.href,
          });
          throw switchErr;
        }
      }
      if (!ethers.isAddress(contractAddr)) { toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`); return; }
      const connectedAccounts = await provider.send('eth_accounts', []);
      if (!Array.isArray(connectedAccounts) || connectedAccounts.length === 0) {
        const sessionError = new Error('wallet_session_missing');
        sessionError.code = 'WALLET_SESSION_MISSING';
        throw sessionError;
      }
      const signer = await provider.getSigner();
      const signerAddress = (await signer.getAddress()).toLowerCase();
      const tenantAddress = (content?.tenant?.walletAddress || '').toLowerCase();
      if (tenantAddress && tenantAddress !== signerAddress) { toast.error(`当前钱包与合同绑定地址不一致：${tenantAddress}`); return; }
      const weiAmount = ethers.parseEther(String(initialAmount));
      const orderNo = `order_${Date.now()}`;
      const rContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
      try {
        await rContract.recordInitialRentPayment.staticCall(
          id,
          content?.landlord?.walletAddress || ethers.ZeroAddress,
          orderNo,
          { value: weiAmount }
        );
        await rContract.recordInitialRentPayment.estimateGas(
          id,
          content?.landlord?.walletAddress || ethers.ZeroAddress,
          orderNo,
          { value: weiAmount }
        );
      } catch (precheckErr) {
        precheckErr.phase = 'payment_precheck';
        throw precheckErr;
      }
      const tx = await rContract.recordInitialRentPayment(
        id,
        content?.landlord?.walletAddress || ethers.ZeroAddress,
        orderNo,
        { value: weiAmount }
      );
      await tx.wait();
      const paymentResp = await apiPost(`/contracts/${id}/payments/onchain`, { txHash: tx.hash, amount: String(initialAmount), payType: 'initial', period: 'initial' });
      setLastTxHash(tx.hash);
      toast.success(paymentResp?.data?.isFutureRenewalStart ? '续约合同已支付，待父合同结束后接续生效' : '一次性支付成功，合同已生效');
      await loadContract();
    } catch (err) {
      let walletAddress = '';
      let chainId = '';
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_accounts', []);
        walletAddress = (accounts[0] || '').trim();
        chainId = String((await provider.getNetwork())?.chainId || '');
      } catch { /* ignore */ }
      await reportClientFailure({
        type: 'payment',
        preferredNetwork: selected.key,
        message: err?.message || '',
        apiStatus: err?.response?.status || null,
        apiError: err?.response?.data || null,
        walletAddress,
        chainId,
        contractAddress: contractAddr,
        amount: String(initialAmount),
        phase: err?.phase || 'payment_send',
        pageUrl: window.location.href,
      });
      toast.error(`支付失败：${resolvePaymentErrorMessage(err)}`);
    } finally {
      setPaying(false);
    }
  };

  const parseClausesFromText = (text) => String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const handleSaveDraft = async () => {
    setProposing(true);
    try {
      await apiPost(`/contracts/${id}/clauses/draft`, {
        clauses: parseClausesFromText(clausesText),
        changeNote,
      });
      toast.success('条款草稿已保存');
      await loadContract();
    } catch (err) {
      toast.error(err.response?.data?.error || '保存草稿失败');
    } finally {
      setProposing(false);
    }
  };

  const handleSubmitClauses = async () => {
    setProposing(true);
    try {
      await apiPost(`/contracts/${id}/clauses/submit`, {
        clauses: parseClausesFromText(clausesText),
        changeNote,
      });
      toast.success('条款已提交审核');
      await loadContract();
    } catch (err) {
      toast.error(err.response?.data?.error || '提交审核失败');
    } finally {
      setProposing(false);
    }
  };

  const handleReviewClauses = async (decision) => {
    setProposing(true);
    try {
      await apiPost(`/contracts/${id}/clauses/review`, {
        decision,
        reason: decision === 'reject' ? reviewReason : '',
        clauses: decision === 'reject' ? parseClausesFromText(clausesText) : undefined,
      });
      toast.success(decision === 'approve' ? '条款已审核通过并定稿' : '房东已回传最终条款');
      setReviewReason('');
      await loadContract();
    } catch (err) {
      toast.error(err.response?.data?.error || '审核失败');
    } finally {
      setProposing(false);
    }
  };


  const handleDownloadPdf = async () => {
    const token = localStorage.getItem(`token:${preferredNetwork}`) || '';
    const res = await fetch(`/api/contracts/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      toast.error('PDF 下载失败');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleCreateRenewal = async () => {
    const leaseMonths = Number(prompt('续约时长（月）', content?.terms?.leaseMonths || 1));
    if (!Number.isInteger(leaseMonths) || leaseMonths < 1 || leaseMonths > 12) {
      toast.error('续约时长必须为 1-12 月的整数');
      return;
    }
    const changeNote = prompt('续约说明', '续约申请');
    try {
      const res = await apiPost(`/contracts/${id}/renewals`, {
        leaseMonths,
        changeNote: changeNote || '续约申请',
      });
      toast.success('续约合同已创建');
      navigate(`/contract/${res.data.contractId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || '创建续约失败');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><LoaderIcon className="w-8 h-8 animate-spin text-primary-500" /></div>;
  }

  if (!contract) {
    return <div className="card p-8 text-center"><p className="text-gray-400">合同不存在</p></div>;
  }

  const statusInfo = STATUS_MAP[contract.status] || { label: contract.status, color: 'badge-gray' };
  const contractStartAtMs = (() => {
    const raw = String(content?.terms?.startDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
    const d = new Date(`${raw}T00:00:00+08:00`);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  })();
  const derivedStatusInfo = contract.status === 'tenant_signed' && contract.landlord_signed_at
    ? { label: '待上链', color: 'badge-yellow' }
    : (contract.status === 'active' && contract.parent_contract_id && contractStartAtMs > Date.now()
      ? { label: '已支付待接续', color: 'badge-blue' }
      : statusInfo);
  const isTenant = contract.tenant_id === user?.id;
  const isLandlord = contract.landlord_id === user?.id;
  const hasRenewalChild = !!contract?.renewal_child_contract?.id;
  const canNegotiate = contract.status === 'pending' && (isTenant || isLandlord);
  const openProposal = versions.find((item) => item.status === 'proposed');
  const clausesPreview = Array.isArray(content?.clauses) ? content.clauses : [];
  const isLandlordFinal = content?.negotiation?.mode === 'landlord_final';
  const tenantCanEditClauses = isTenant && !isLandlordFinal && !contract.tenant_signed_at && !contract.landlord_signed_at;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center space-x-1 text-gray-400 hover:text-gray-200 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" /><span>返回</span>
      </button>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <FileTextIcon className="w-6 h-6 text-primary-400" />
            <div>
              <h1 className="text-xl font-bold text-gray-100">租赁合同</h1>
              {contract.parent_contract_id && <p className="text-xs text-blue-300 mt-1">续约合同</p>}
            </div>
          </div>
          <span className={`${derivedStatusInfo.color} text-sm`}>{derivedStatusInfo.label}</span>
        </div>

        <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm">
          <span className="text-gray-500">合同ID：</span>
          <span className="font-mono text-gray-200 break-all">{contract.id}</span>
        </div>
        <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm">
          <span className="text-gray-500">房源ID：</span>
          <span className="font-mono text-gray-200 break-all">{contract.listing_id || content?.listingId || '-'}</span>
        </div>
        {contract.parent_contract_id && (
          <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm">
            <span className="text-gray-500">父合同ID：</span>
            <span className="font-mono text-gray-200 break-all">{contract.parent_contract_id}</span>
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            <p className="text-gray-500">协商状态</p>
            <p className="font-medium text-gray-200">{isLandlordFinal ? '房东最终版待租客确认' : contract.negotiation_status === 'finalized' ? '已定稿' : contract.negotiation_status === 'proposed' ? '待审核' : '草稿协商中'}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            <p className="text-gray-500">合同版本</p>
            <p className="font-medium text-gray-200">v{contract.version || 1}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            <p className="text-gray-500">上链状态</p>
            <p className="font-medium text-gray-200">{contract.onchain_status === 'confirmed' ? '已确认' : contract.onchain_status === 'failed' ? '待重试' : contract.onchain_status === 'pending' ? '处理中' : '未开始'}</p>
          </div>
        </div>

        {content && (
          <div className="space-y-4 mb-6 border border-gray-700 rounded-lg p-4">
            <h2 className="font-bold text-lg text-gray-100 border-b border-gray-700 pb-2">合同详情</h2>

            {contract.tx_hash && (
              <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3 text-sm text-green-400 flex items-start space-x-2">
                <CheckCircleIcon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">合同哈希已上链</p>
                  <p className="text-xs mt-1 font-mono break-all">TxHash: {contract.tx_hash}</p>
                  <p className="text-xs mt-1">
                    {txExplorerBase
                      ? <><span>查看 </span><a href={`${txExplorerBase}${contract.tx_hash}`} target="_blank" className="underline" rel="noreferrer">区块浏览器</a></>
                      : 'Local 网络暂无区块浏览器链接'}
                  </p>
                </div>
              </div>
            )}

            {lastTxHash && (
              <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3 text-sm text-blue-400 flex items-start space-x-2">
                <CheckCircleIcon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">最新交易</p>
                  <p className="text-xs mt-1 font-mono break-all">TxHash: {lastTxHash}</p>
                  <p className="text-xs mt-1">
                    {txExplorerBase
                      ? <><span>查看 </span><a href={`${txExplorerBase}${lastTxHash}`} target="_blank" className="underline" rel="noreferrer">区块浏览器</a></>
                      : 'Local 网络暂无区块浏览器链接'}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-500">房东</p><p className="font-medium text-gray-200 font-mono text-xs">{content.landlord?.walletAddress || '-'}</p>{contract.landlord_phone && <p className="text-gray-400 text-xs mt-1">📞 {contract.landlord_phone}</p>}</div>
              <div><p className="text-gray-500">租客</p><p className="font-medium text-gray-200 font-mono text-xs">{content.tenant?.walletAddress || '-'}</p>{contract.tenant_phone && <p className="text-gray-400 text-xs mt-1">📞 {contract.tenant_phone}</p>}</div>
              <div className="col-span-2"><p className="text-gray-500">地址</p><p className="font-medium text-gray-200">{content.address}</p></div>
              <div><p className="text-gray-500">租金</p><p className="font-medium text-gray-200">{content.rentAmount} ETH / 月</p></div>
              <div><p className="text-gray-500">一次性支付总额</p><p className="font-medium text-gray-200">{initialAmount || '-'} ETH</p></div>
              <div><p className="text-gray-500">支付方式</p><p className="font-medium text-gray-200">{content.terms?.paymentMethod === 'one_time' ? '一次性支付' : '按月'}</p></div>
              <div><p className="text-gray-500">租期</p><p className="font-medium text-gray-200">{content.terms?.startDate || '待定'} 至 {content.terms?.endDate || '待定'}</p></div>
            </div>

            {payments.length > 0 && (
              <div className="rounded-lg border border-gray-700 p-3">
                <p className="text-sm font-medium text-gray-200 mb-2">支付记录</p>
                <div className="space-y-2">
                  {payments.map((item) => (
                    <div key={item.id} className="text-xs text-gray-400 rounded bg-gray-800 px-2 py-2">
                      <p>类型：{item.pay_type} | 金额：{item.amount} ETH</p>
                      <p className="font-mono break-all">Tx: {item.tx_hash}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-xs text-gray-400">
              <p>哈希算法：SHA-256（用于计算合同 content_hash）</p>
            </div>
          </div>
        )}

        {canNegotiate && (
          <div className="mb-6 rounded-lg border border-gray-700 p-4">
            <div className="mb-3">
              <p className="font-medium text-gray-200">条款协商（仅 clauses）</p>
              <p className="mt-1 text-xs text-gray-500">流程：租客起草/提交，房东审核通过或退回。</p>
            </div>

            <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <p className="mb-2 text-xs text-gray-500">当前条款预览</p>
              {clausesPreview.length > 0 ? (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-200">
                  {clausesPreview.map((clause, idx) => (
                    <li key={`${idx}_${clause}`}>{clause}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-gray-400">暂无条款</p>
              )}
            </div>

            {tenantCanEditClauses && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">条款（每行一条）</label>
                  <textarea
                    className="input-field min-h-[120px]"
                    value={clausesText}
                    onChange={(e) => setClausesText(e.target.value)}
                    placeholder={'示例：\n禁养宠物\n物业费由房东承担'}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">修改备注（可选）</label>
                  <input
                    className="input-field"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    placeholder="例如：补充了物业费与噪音约束"
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <button type="button" onClick={handleSaveDraft} disabled={proposing} className="btn-secondary">
                    {proposing ? '处理中...' : '保存草稿'}
                  </button>
                  <button type="button" onClick={handleSubmitClauses} disabled={proposing} className="btn-primary">
                    {proposing ? '处理中...' : '提交审核'}
                  </button>
                </div>
              </div>
            )}

            {isLandlord && openProposal && (
              <div className="mt-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-sm text-yellow-100">
                <p className="font-medium">v{openProposal.version} 条款待审核</p>
                <p className="mt-1 text-yellow-100/80">{openProposal.change_note || '无备注'}</p>
                <div className="mt-3 rounded-lg border border-yellow-700/40 bg-yellow-950/30 p-3">
                  <p className="mb-2 text-xs text-yellow-100/80">租客提交条款</p>
                  {(() => {
                    try {
                      const proposalContent = typeof openProposal.content_json === 'string'
                        ? JSON.parse(openProposal.content_json)
                        : openProposal.content_json;
                      const proposalClauses = Array.isArray(proposalContent?.clauses) ? proposalContent.clauses : [];
                      if (!proposalClauses.length) return <p className="text-xs text-yellow-100/70">暂无条款</p>;
                      return (
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-yellow-50">
                          {proposalClauses.map((item, idx) => <li key={`${idx}_${item}`}>{item}</li>)}
                        </ol>
                      );
                    } catch {
                      return <p className="text-xs text-yellow-100/70">提案条款解析失败</p>;
                    }
                  })()}
                </div>
                <div className="mt-2">
                  <label className="mb-1 block text-xs text-yellow-100/80">房东最终条款（退回时会以此版本回传）</label>
                  <textarea
                    className="input-field min-h-[120px]"
                    value={clausesText}
                    onChange={(e) => setClausesText(e.target.value)}
                    placeholder={'示例：\n禁养宠物\n物业费由房东承担'}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <button type="button" onClick={() => handleReviewClauses('approve')} disabled={proposing} className="btn-primary">
                    {proposing ? '处理中...' : '审核通过并定稿'}
                  </button>
                  <button type="button" onClick={() => handleReviewClauses('reject')} disabled={proposing} className="btn-secondary">
                    {proposing ? '处理中...' : '退回修改'}
                  </button>
                </div>
                <div className="mt-2">
                  <label className="mb-1 block text-xs text-yellow-100/80">退回理由（退回时建议填写）</label>
                  <input
                    className="input-field"
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    placeholder="例如：第2条约束过宽，请细化"
                  />
                </div>
              </div>
            )}

            {isTenant && isLandlordFinal && (
              <div className="mt-3 rounded-lg border border-blue-800/50 bg-blue-900/20 p-3 text-sm text-blue-100">
                房东已回传最终条款。你现在只能选择“租客签署”或“取消合同”。
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button onClick={handleDownloadPdf} className="btn-secondary w-full">下载合同 PDF</button>
          {contract.status === 'pending' && contract.negotiation_status === 'finalized' && isTenant && (
            <button onClick={() => handleSign('tenant')} disabled={signing} className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '签署中...' : '租客签署'}</span>
            </button>
          )}
          {contract.status === 'tenant_signed' && isLandlord && !contract.landlord_signed_at && (
            <button onClick={() => handleSign('landlord')} disabled={signing} className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '签署并上链中...' : '房东签署并上链'}</span>
            </button>
          )}
          {contract.status === 'pending_payment' && isTenant && (
            <button onClick={handleInitialPayment} disabled={paying} className="btn-primary w-full flex items-center justify-center space-x-2">
              {paying ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{paying ? '支付中...' : `一次性支付 ${initialAmount || ''} ETH 并激活合同`}</span>
            </button>
          )}
          {contract.status === 'active' && isTenant && !hasRenewalChild && (
            <button onClick={handleCreateRenewal} className="btn-secondary w-full">申请续约</button>
          )}
          {['pending', 'tenant_signed'].includes(contract.status) && (isTenant || isLandlord) && (
            <button onClick={handleCancel} className="btn-secondary w-full">取消合同</button>
          )}
        </div>
      </div>
    </div>
  );
}
