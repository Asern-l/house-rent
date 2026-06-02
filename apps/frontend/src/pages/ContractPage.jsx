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
const API_BASE_MAP = {
  sepolia: import.meta.env.VITE_API_BASE_SEPOLIA || '/api',
  local: import.meta.env.VITE_API_BASE_LOCAL || '/api-local',
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
const LISTING_CHAIN_STATUS_MAP = {
  0: { key: 'active', label: '链上可用' },
  1: { key: 'offline', label: '链上下架' },
  2: { key: 'closed', label: '链上关闭' },
};

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

function resolveLandlordOnchainErrorMessage(error, listingChainState) {
  const message = getErrorMessage(error);
  if (listingChainState?.key === 'offline') return '当前房源已链上下架，合同不可上链。';
  if (listingChainState?.key === 'closed') return '当前房源已链上关闭，合同不可上链。';
  if (listingChainState?.key === 'missing') return '当前房源尚未链上发布，合同不可上链。';
  if (message.includes('listing not active')) return '当前房源不是链上可用状态，合同不可上链。';
  if (message.includes('listing not found')) return '当前房源尚未链上发布，合同不可上链。';
  return resolveGasAuthErrorMessage(error);
}

function hasGasCompRevokedLog(receipt, contractInterface) {
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === 'GasCompRevoked') return true;
    } catch {
      // ignore unrelated logs
    }
  }
  return false;
}

function resolveInitialAmount(content) {
  const direct = Number(content?.oneTimeAmount);
  if (Number.isFinite(direct) && direct > 0) return String(content.oneTimeAmount);
  const rent = Number(content?.rentAmount);
  const months = Number(content?.terms?.leaseMonths);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(months) || months <= 0) return '';
  return String((rent * months).toFixed(8).replace(/\.?0+$/, ''));
}

function resolvePlatformFeeAmount(content) {
  const direct = Number(content?.platformFeeAmount);
  if (Number.isFinite(direct) && direct >= 0) return String(content.platformFeeAmount);
  const gross = Number(resolveInitialAmount(content));
  if (!Number.isFinite(gross) || gross <= 0) return '';
  return String((gross * 0.001).toFixed(8).replace(/\.?0+$/, ''));
}

function resolveLandlordNetAmount(content) {
  const direct = Number(content?.landlordNetAmount);
  if (Number.isFinite(direct) && direct >= 0) return String(content.landlordNetAmount);
  const gross = Number(resolveInitialAmount(content));
  if (!Number.isFinite(gross) || gross <= 0) return '';
  const fee = Number(resolvePlatformFeeAmount(content) || 0);
  return String((gross - fee).toFixed(8).replace(/\.?0+$/, ''));
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

function normalizePublicComment(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function buildReviewCommentHash(text) {
  return ethers.keccak256(ethers.toUtf8Bytes(normalizePublicComment(text)));
}

function renderStars(rating) {
  return '★'.repeat(Math.max(0, Number(rating || 0))) + '☆'.repeat(Math.max(0, 5 - Number(rating || 0)));
}

function getPdfAckStorageKey(contractId) {
  return `contract_pdf_saved:${contractId}`;
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

function getNegotiationDisplayState({ contract, content, versions, user }) {
  const isLocked = !!contract?.tenant_signed_at || !!contract?.landlord_signed_at || contract?.status !== 'pending';
  const latestDraft = versions.find((item) => item.status === 'draft' && item.proposer_id === user?.id);
  const openProposal = versions.find((item) => item.status === 'proposed');
  const latestRejected = versions.find((item) => item.status === 'rejected');
  const reviewAction = String(content?.negotiation?.reviewAction || '').trim();

  if (isLocked) {
    return { label: '协商已冻结', tone: 'text-gray-200', note: '任一方开始签署后，条款协商立即冻结。' };
  }
  if (latestDraft) {
    return { label: '租客草稿', tone: 'text-gray-200', note: '这是租客尚未提交给房东审核的草稿版本。' };
  }
  if (openProposal) {
    return { label: '待房东审核', tone: 'text-yellow-300', note: '当前存在租客提议，等待房东处理。' };
  }
  if (reviewAction === 'approved_with_edits') {
    return { label: '房东修改后确认', tone: 'text-emerald-300', note: content?.negotiation?.note || '房东已在租客提议基础上修改并确认当前版本。' };
  }
  if (reviewAction === 'approved_as_is') {
    return { label: '房东确认', tone: 'text-emerald-300', note: content?.negotiation?.note || '房东已确认租客提议为当前版本。' };
  }
  if (latestRejected) {
    return { label: '已退回修改', tone: 'text-rose-300', note: latestRejected.change_note || '房东已退回上一版提议，租客可继续修改并重新提交。' };
  }
  return { label: '默认版本', tone: 'text-gray-200', note: '当前为默认条款版本，租客可发起第一版提议。' };
}

export default function ContractPage() {
  const { id } = useParams();
  const { user, preferredNetwork } = useAuth();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [payments, setPayments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [lastTxHash, setLastTxHash] = useState('');
  const [clausesText, setClausesText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [proposing, setProposing] = useState(false);
  const [listingChainState, setListingChainState] = useState(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showPdfNotice, setShowPdfNotice] = useState(false);
  const [pdfDownloadedThisSession, setPdfDownloadedThisSession] = useState(false);

  const initialAmount = resolveInitialAmount(content);
  const platformFeeAmount = resolvePlatformFeeAmount(content);
  const landlordNetAmount = resolveLandlordNetAmount(content);
  const selectedNetwork = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
  const txExplorerBase = TX_EXPLORER_BASE[selectedNetwork.key] || '';
  const isActionBusy = signing || paying || proposing || cancelling;

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

  const loadListingChainState = async (contractData) => {
    const listingId = String(contractData?.listing_id || '').trim();
    const contractAddr = String(CONTRACT_ADDR_MAP[selectedNetwork.key] || '').trim();
    const rpcUrl = selectedNetwork?.addParams?.rpcUrls?.[0] || '';
    if (!listingId || !ethers.isAddress(contractAddr) || !rpcUrl) {
      setListingChainState(null);
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const readContract = new ethers.Contract(contractAddr, RentalChainABI, provider);
      const record = await readContract.getListing(listingId);
      if (!record?.exists) {
        setListingChainState({ key: 'missing', label: '房源未上链' });
        return;
      }
      const numericStatus = Number(record.status ?? -1);
      const mapped = LISTING_CHAIN_STATUS_MAP[numericStatus] || { key: 'unknown', label: '链上状态未知' };
      setListingChainState(mapped);
    } catch {
      setListingChainState(null);
    }
  };

  useEffect(() => {
    loadContract().catch(() => toast.error('加载合同失败')).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!contract) return;
    if (!['pending', 'tenant_signed'].includes(String(contract.status || '').trim())) {
      setListingChainState(null);
      return;
    }
    loadListingChainState(contract).catch(() => setListingChainState(null));
  }, [contract?.id, contract?.listing_id, contract?.status, preferredNetwork]);

  useEffect(() => {
    const latestProposal = versions.find((item) => item.status === 'proposed');
    const latestDraft = versions.find((item) => item.status === 'draft' && item.proposer_id === user?.id);
    const target = latestProposal || latestDraft;
    if (!target) return;
    try {
      const targetContent = typeof target.content_json === 'string'
        ? JSON.parse(target.content_json)
        : target.content_json;
      const targetClauses = Array.isArray(targetContent?.clauses) ? targetContent.clauses : [];
      setClausesText(targetClauses.join('\n'));
    } catch {
      // ignore invalid content_json
    }
  }, [versions, user?.id]);

  useEffect(() => {
    if (!contract?.id) return;
    if (String(contract.status || '').trim() !== 'active') return;
    const acknowledged = localStorage.getItem(getPdfAckStorageKey(contract.id)) === '1';
    if (!acknowledged) {
      setShowPdfNotice(true);
    }
  }, [contract?.id, contract?.status]);

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
          const listingRecord = await chainContract.getListing(String(contract?.listing_id || ''));
          if (!listingRecord?.exists) {
            setListingChainState({ key: 'missing', label: '房源未上链' });
            toast.error('当前房源尚未链上发布，合同不可上链。');
            return;
          }
          const currentListingChainState = LISTING_CHAIN_STATUS_MAP[Number(listingRecord.status ?? -1)] || { key: 'unknown', label: '链上状态未知' };
          setListingChainState(currentListingChainState);
          if (currentListingChainState.key !== 'active') {
            toast.error(`当前房源${currentListingChainState.label}，合同不可上链。`);
            return;
          }
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
          const permitResp = await apiPost(`/contracts/${id}/create-onchain-permit`, {
            signerAddress,
            message,
            signature,
          });
          const createParams = permitResp?.data?.createParams;
          const permit = permitResp?.data?.permit;
          if (!createParams || !permit?.signature || !permit?.nonce) {
            throw new Error('合同上链 permit 缺失');
          }
          await chainContract.createContractRecord.staticCall(
            createParams,
            permit.nonce,
            permit.deadlineMs,
            permit.signature
          );
          const estimatedGas = await chainContract.createContractRecord.estimateGas(
            createParams,
            permit.nonce,
            permit.deadlineMs,
            permit.signature
          );
          const gasLimit = (estimatedGas * 120n) / 100n;
          const onchainTx = await chainContract.createContractRecord(
            createParams,
            permit.nonce,
            permit.deadlineMs,
            permit.signature,
            { gasLimit }
          );
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
          toast.error(`房东上链失败：${resolveLandlordOnchainErrorMessage(landlordOnchainErr, listingChainState)}`);
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
    if (!confirm(canRefundExpiredGas ? '确认要取回这份已结束合同的 gas 预付吗？' : '确认要取消这份合同吗？')) return;
    setCancelling(true);
    try {
      let gasRefundConfirmed = contract?.gas_auth?.status !== 'active';
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
          const nonce = String(contract.gas_auth.nonce || '');
          const revokeTx = isTenant
            ? await tenantContract.revokeGasCompensationAuthorization(id, tenantAddress, nonce)
            : await tenantContract.cancelPendingGasAuthorization(id, tenantAddress, nonce);
          const revokeReceipt = await revokeTx.wait();
          const hasRevokedEvent = hasGasCompRevokedLog(revokeReceipt, tenantContract.interface);
          gasRefundConfirmed = hasRevokedEvent;
          if (hasRevokedEvent) {
            await apiPost(`/contracts/${id}/gas-authorization/revoke`, { txHash: String(revokeTx.hash || '') });
          }
          setLastTxHash(String(revokeTx.hash || ''));
          if (!hasRevokedEvent) {
            toast(canRefundExpiredGas ? '链上授权未产生撤销事件，当前未取回 gas 预付' : '链上授权未产生撤销事件，按当前状态继续取消合同', { icon: 'ℹ️' });
          }
        } catch (revokeErr) {
          const revokeMsg = getErrorMessage(revokeErr);
          const revokeCode = String(revokeErr?.response?.data?.code || '').trim();
          if (
            revokeCode !== 'GAS_AUTH_REVOKE_EVENT_MISSING'
            && revokeCode !== 'GAS_AUTH_REVOKE_METHOD_MISMATCH'
            && !revokeMsg.includes('only active authorization can revoke')
            && !revokeMsg.includes('authorization not found')
          ) {
            throw revokeErr;
          }
        }
      }
      if (canRefundExpiredGas) {
        toast.success('gas 预付已处理');
        await loadContract();
      } else {
        await apiPost(`/contracts/${id}/cancel`);
        if (gasRefundConfirmed) {
          toast.success('合同已取消');
          navigate('/contracts');
        } else {
          toast.success('合同已取消，请继续取回 gas 预付');
          await loadContract();
        }
      }
    } catch (err) {
      const requestId = genRequestId();
      await apiPost(`/contracts/${id}/sign-client-report`, { type: canRefundExpiredGas ? 'refund_gas' : 'cancel', preferredNetwork, message: err?.message || (canRefundExpiredGas ? '取回 gas 预付失败' : '取消合同失败'), apiStatus: err.response?.status || null, apiError: err.response?.data || null, walletAddress: '', chainId: '', pageUrl: window.location.href }, { headers: { 'X-Request-Id': requestId } }).catch(() => {});
      toast.error(err.response?.data?.error || (canRefundExpiredGas ? '取回 gas 预付失败' : '取消失败'));
    } finally {
      setCancelling(false);
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
      const prepareResp = await apiGet(`/contracts/${id}/payments/prepare-onchain`);
      const preparedPayment = prepareResp?.data || {};
      const permit = preparedPayment?.permit;
      if (!permit?.signature || !permit?.nonce) throw new Error('支付 permit 缺失');
      const weiAmount = BigInt(String(preparedPayment.amountWei || '0'));
      const orderNo = String(preparedPayment.orderNo || '').trim();
      const landlordAddress = String(preparedPayment.landlord || '').trim();
      if (!orderNo || !ethers.isAddress(landlordAddress) || weiAmount <= 0n) {
        throw new Error('支付链上参数无效');
      }
      const rContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
      try {
        await rContract.recordInitialRentPayment.staticCall(
          id,
          landlordAddress,
          orderNo,
          permit.nonce,
          permit.deadlineMs,
          permit.signature,
          { value: weiAmount }
        );
        await rContract.recordInitialRentPayment.estimateGas(
          id,
          landlordAddress,
          orderNo,
          permit.nonce,
          permit.deadlineMs,
          permit.signature,
          { value: weiAmount }
        );
      } catch (precheckErr) {
        precheckErr.phase = 'payment_precheck';
        throw precheckErr;
      }
      const tx = await rContract.recordInitialRentPayment(
        id,
        landlordAddress,
        orderNo,
        permit.nonce,
        permit.deadlineMs,
        permit.signature,
        { value: weiAmount }
      );
      await tx.wait();
      const paymentResp = await apiPost(`/contracts/${id}/payments/onchain`, { txHash: tx.hash, amount: String(initialAmount), payType: 'initial', period: 'initial' });
      setLastTxHash(tx.hash);
      const paymentData = paymentResp?.data || {};
      const feeText = paymentData.platformFeeAmount || preparedPayment.platformFeeAmount || platformFeeAmount;
      toast.success(
        paymentResp?.data?.isFutureRenewalStart
          ? `续约合同已支付，待父合同结束后接续生效${feeText ? `（平台手续费 ${feeText} ETH）` : ''}`
          : `一次性支付成功，合同已生效${feeText ? `（平台手续费 ${feeText} ETH）` : ''}`
      );
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

  const handleSubmitRentalReview = async () => {
    if (!window.ethereum) { toast.error('请先安装 MetaMask 钱包'); return; }
    if (!reviewRating || reviewRating < 1 || reviewRating > 5) { toast.error('请选择 1 到 5 星评分'); return; }
    const normalizedComment = normalizePublicComment(reviewComment);
    if (!normalizedComment) { toast.error('请填写评价内容'); return; }
    const selected = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
    const contractAddr = String(CONTRACT_ADDR_MAP[selected.key] || '').trim();
    if (!ethers.isAddress(contractAddr)) {
      toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`);
      return;
    }
    setSubmittingReview(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== selected.chainId) {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
      }
      const signer = await provider.getSigner();
      const signerAddress = String((await signer.getAddress()) || '').trim();
      const boundAddress = expectedWallet('tenant');
      if (boundAddress && signerAddress.toLowerCase() !== boundAddress) {
        toast.error(`当前钱包与合同绑定租客地址不一致：${boundAddress}`);
        return;
      }
      const chainContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
      const commentHash = buildReviewCommentHash(normalizedComment);
      const prepare = await apiPost(`/contracts/${id}/review/prepare-onchain`, {
        rating: reviewRating,
        commentText: normalizedComment,
        commentHash,
      });
      const commentCid = String(prepare?.data?.commentCid || '').trim();
      const permit = prepare?.data?.permit;
      if (!commentCid) {
        throw new Error('评价 commentCid 生成失败');
      }
      if (!permit?.signature || !permit?.nonce) throw new Error('评价 permit 缺失');
      await chainContract.submitRentalReview.staticCall(
        id,
        commentHash,
        reviewRating,
        commentCid,
        permit.nonce,
        permit.deadlineMs,
        permit.signature
      );
      const estimatedGas = await chainContract.submitRentalReview.estimateGas(
        id,
        commentHash,
        reviewRating,
        commentCid,
        permit.nonce,
        permit.deadlineMs,
        permit.signature
      );
      const tx = await chainContract.submitRentalReview(id, commentHash, reviewRating, commentCid, permit.nonce, permit.deadlineMs, permit.signature, {
        gasLimit: (estimatedGas * 120n) / 100n,
      });
      await tx.wait();
      setLastTxHash(String(tx.hash || ''));
      await apiPost(`/contracts/${id}/review/onchain`, {
        txHash: String(tx.hash || ''),
        rating: reviewRating,
        commentText: normalizedComment,
        commentHash,
        commentCid,
      });
      toast.success('租后评价已提交');
      setReviewRating(0);
      setReviewComment('');
      await loadContract();
    } catch (err) {
      toast.error(err?.response?.data?.error || getErrorMessage(err) || '租后评价提交失败');
    } finally {
      setSubmittingReview(false);
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
        note: reviewReason,
        clauses: decision === 'approve' ? parseClausesFromText(clausesText) : undefined,
      });
      toast.success(decision === 'approve' ? '房东已确认当前条款版本' : '房东已退回该提议');
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
    const apiBase = API_BASE_MAP[preferredNetwork] || API_BASE_MAP.sepolia;
    const res = await fetch(`${apiBase}/contracts/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      toast.error('PDF 下载失败');
      return;
    }
    const disposition = String(res.headers.get('Content-Disposition') || '');
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const filename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : `${id}.pdf`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPdfDownloadedThisSession(true);
  };

  const acknowledgePdfSaved = () => {
    localStorage.setItem(getPdfAckStorageKey(id), '1');
    setShowPdfNotice(false);
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
  const isNegotiationLocked = !!contract.tenant_signed_at || !!contract.landlord_signed_at || contract.status !== 'pending';
  const canNegotiate = !isNegotiationLocked && (isTenant || isLandlord);
  const openProposal = versions.find((item) => item.status === 'proposed');
  const clausesPreview = Array.isArray(content?.clauses) ? content.clauses : [];
  const tenantCanEditClauses = isTenant && !isNegotiationLocked;
  const negotiationDisplay = getNegotiationDisplayState({ contract, content, versions, user });
  const canCancelContract = ['pending', 'tenant_signed'].includes(contract.status) && (isTenant || isLandlord);
  const canRefundExpiredGas = ['expired', 'cancelled'].includes(contract.status)
    && contract?.gas_auth?.status === 'active'
    && !contract?.landlord_signed_at
    && (isTenant || isLandlord);
  const rentalReview = contract?.rental_review || null;
  const reviewState = contract?.review_state || {};
  const canSubmitRentalReview = !!(isTenant && reviewState.can_review_as_current_user);
  const cancelActionLabel = canRefundExpiredGas ? '取回 gas 预付' : '取消合同';
  const cancelBusyLabel = canRefundExpiredGas ? '正在取回 gas 预付...' : '正在撤销授权并取消合同...';
  const shouldWarnListingChainBlocked = ['pending', 'tenant_signed'].includes(String(contract?.status || '').trim())
    && listingChainState
    && listingChainState.key !== 'active';

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      {showPdfNotice && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                <FileTextIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">请保存合同 PDF</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  合同已生效。请立即下载并自行保存合同 PDF，后续服务器不可用时，可通过本地 PDF 独立验真合同。
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={handleDownloadPdf} className="btn-primary flex-1">
                下载合同 PDF
              </button>
              <button
                type="button"
                onClick={acknowledgePdfSaved}
                disabled={!pdfDownloadedThisSession}
                className="btn-secondary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                我已保存，继续
              </button>
            </div>
            {!pdfDownloadedThisSession && (
              <p className="mt-3 text-xs text-slate-400">请先点击“下载合同 PDF”，再确认已保存。</p>
            )}
          </div>
        </div>
      )}
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

        {shouldWarnListingChainBlocked && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            当前房源{listingChainState.label}，这份合同目前不可上链。你仍可保留合同文本，但房东签署并上链会被拒绝。
          </div>
        )}

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
            <p className={`font-medium ${negotiationDisplay.tone}`}>{negotiationDisplay.label}</p>
            <p className="mt-1 text-xs text-gray-500">{negotiationDisplay.note}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            <p className="text-gray-500">合同版本</p>
            <p className="font-medium text-gray-200">v{contract.version || 1}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            <p className="text-gray-500">上链状态</p>
            <p className="font-medium text-gray-200">{contract.onchain_state === 'confirmed' ? '已确认' : contract.onchain_state === 'failed' ? '待重试' : contract.onchain_state === 'pending' ? '处理中' : '未开始'}</p>
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
              <div><p className="text-gray-500">平台手续费</p><p className="font-medium text-gray-200">{platformFeeAmount || '-'} ETH</p></div>
              <div><p className="text-gray-500">房东实收</p><p className="font-medium text-gray-200">{landlordNetAmount || '-'} ETH</p></div>
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
              <p className="mt-1 text-xs text-gray-500">流程：租客可反复提议；房东仅在存在租客提议时处理，可修改后确认或退回；任一方开始签署后立即冻结。</p>
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

            <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <p className="mb-2 text-xs text-gray-500">最新协商结果</p>
              {(() => {
                const latestRejected = versions.find((item) => item.status === 'rejected');
                if (openProposal) {
                  return (
                    <div className="text-sm text-yellow-300">
                      <p className="font-medium">待房东审核</p>
                      <p className="mt-1 text-xs text-gray-400">提议版本：v{openProposal.version}</p>
                      <p className="mt-1 text-xs text-gray-400">备注：{openProposal.change_note || '无'}</p>
                    </div>
                  );
                }
                if (String(content?.negotiation?.reviewAction || '') === 'approved_with_edits') {
                  return (
                    <div className="text-sm text-emerald-300">
                      <p className="font-medium">房东修改后确认</p>
                      <p className="mt-1 text-xs text-gray-400">当前正文已切到房东确认版</p>
                      <p className="mt-1 text-xs text-gray-400">备注：{content?.negotiation?.note || '无'}</p>
                    </div>
                  );
                }
                if (String(content?.negotiation?.reviewAction || '') === 'approved_as_is') {
                  return (
                    <div className="text-sm text-emerald-300">
                      <p className="font-medium">房东确认</p>
                      <p className="mt-1 text-xs text-gray-400">当前正文已切到房东确认版</p>
                      <p className="mt-1 text-xs text-gray-400">备注：{content?.negotiation?.note || '无'}</p>
                    </div>
                  );
                }
                if (latestRejected) {
                  return (
                    <div className="text-sm text-rose-300">
                      <p className="font-medium">已退回修改</p>
                      <p className="mt-1 text-xs text-gray-400">提议版本：v{latestRejected.version}</p>
                      <p className="mt-1 text-xs text-gray-400">备注：{latestRejected.change_note || '无'}</p>
                    </div>
                  );
                }
                return <p className="text-sm text-gray-400">当前为默认条款版本，尚无已提交的租客提议</p>;
              })()}
            </div>

            {tenantCanEditClauses && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">条款（每行一条）</label>
                    <textarea
                      className="input-field min-h-[120px]"
                      value={clausesText}
                      onChange={(e) => setClausesText(e.target.value)}
                      disabled={isActionBusy}
                      placeholder={'示例：\n禁养宠物\n物业费由房东承担'}
                    />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">提议备注（可选）</label>
                    <input
                      className="input-field"
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      disabled={isActionBusy}
                      placeholder="例如：补充了物业费与噪音约束"
                    />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <button type="button" onClick={handleSaveDraft} disabled={isActionBusy} className="btn-secondary">
                    {proposing ? '处理中...' : cancelling ? '取消中...' : '保存租客草稿'}
                  </button>
                  <button type="button" onClick={handleSubmitClauses} disabled={isActionBusy} className="btn-primary">
                    {proposing ? '处理中...' : cancelling ? '取消中...' : '提交租客提议'}
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
                  <label className="mb-1 block text-xs text-yellow-100/80">房东确认版条款（可在租客提议基础上修改）</label>
                  <textarea
                    className="input-field min-h-[120px]"
                    value={clausesText}
                    onChange={(e) => setClausesText(e.target.value)}
                    disabled={isActionBusy}
                    placeholder={'示例：\n禁养宠物\n物业费由房东承担'}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <button type="button" onClick={() => handleReviewClauses('approve')} disabled={isActionBusy} className="btn-primary">
                    {proposing ? '处理中...' : cancelling ? '取消中...' : '房东确认当前版本'}
                  </button>
                  <button type="button" onClick={() => handleReviewClauses('reject')} disabled={isActionBusy} className="btn-secondary">
                    {proposing ? '处理中...' : cancelling ? '取消中...' : '房东退回修改'}
                  </button>
                </div>
                <div className="mt-2">
                  <label className="mb-1 block text-xs text-yellow-100/80">房东处理备注（确认或退回都支持；退回时必填）</label>
                  <input
                    className="input-field"
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    disabled={isActionBusy}
                    placeholder="例如：第2条约束过宽，请细化"
                  />
                </div>
              </div>
            )}

          </div>
        )}

          <div className="space-y-3">
            <button onClick={handleDownloadPdf} className="btn-secondary w-full">下载合同 PDF</button>
            {contract.status === 'pending' && contract.negotiation_status !== 'proposed' && isTenant && (
              <button onClick={() => handleSign('tenant')} disabled={isActionBusy} className="btn-primary w-full flex items-center justify-center space-x-2">
                {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '签署中...' : cancelling ? '取消中...' : '租客签署'}</span>
            </button>
          )}
            {contract.status === 'tenant_signed' && isLandlord && !contract.landlord_signed_at && (
              <button onClick={() => handleSign('landlord')} disabled={isActionBusy} className="btn-primary w-full flex items-center justify-center space-x-2">
                {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
                <span>{signing ? '签署并上链中...' : cancelling ? '取消中...' : '房东签署并上链'}</span>
              </button>
            )}
            {contract.status === 'pending_payment' && isTenant && (
              <>
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-3 text-sm text-emerald-200">
                  <p className="font-medium text-emerald-100">平台验真提示</p>
                  <p className="mt-1 leading-6">
                    平台已完成合同上链状态、合同哈希与签名一致性校验，当前未发现篡改异常。
                  </p>
                  <p className="mt-2 leading-6">
                    如需进一步独立复核，请在支付前下载合同 PDF，并使用独立验真工具再次验证合同与房源信息。
                  </p>
                  <p className="mt-2 leading-6">
                    当前首笔支付总额为 {initialAmount || '-'} ETH，其中平台手续费 {platformFeeAmount || '-'} ETH，房东实收 {landlordNetAmount || '-'} ETH。
                  </p>
                </div>
                <button onClick={handleInitialPayment} disabled={isActionBusy} className="btn-primary w-full flex items-center justify-center space-x-2">
                  {paying ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
                  <span>{paying ? '支付中...' : cancelling ? '取消中...' : `一次性支付 ${initialAmount || ''} ETH 并激活合同`}</span>
                </button>
              </>
            )}
            {contract.status === 'active' && isTenant && !hasRenewalChild && (
              <button onClick={handleCreateRenewal} disabled={isActionBusy} className="btn-secondary w-full">{cancelling ? '取消中...' : '申请续约'}</button>
            )}
          {(canCancelContract || canRefundExpiredGas) && (
            <button onClick={handleCancel} disabled={isActionBusy} className="btn-secondary w-full">
              {cancelling ? cancelBusyLabel : cancelActionLabel}
            </button>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-gray-700 bg-gray-900/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-gray-100">租后评价</p>
              <p className="mt-1 text-xs text-gray-500">仅真实租客可在合同结束后提交一次公开评价。评分公开展示，并参与房源正式加权平均分。</p>
            </div>
            {rentalReview && <span className="badge-green">已提交</span>}
          </div>

          {rentalReview ? (
            <div className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-4">
              <p className="text-lg font-medium text-primary-300">{renderStars(rentalReview.rating)} <span className="ml-2 text-sm text-gray-400">权重 {rentalReview.weight}</span></p>
              <p className="mt-2 break-all font-mono text-xs text-gray-500">地址：{rentalReview.tenant_wallet || '未知地址'}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-200">{rentalReview.comment_text}</p>
              <p className="mt-3 text-xs text-gray-500">提交时间：{rentalReview.created_at || '-'}</p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-4">
              <p className="text-sm text-gray-400">
                {canSubmitRentalReview
                  ? `当前可评价窗口截止到：${reviewState.review_window_end_at || '-'}`
                  : reviewState.review_window_end_at
                    ? `当前不可评价。评价窗口截止到：${reviewState.review_window_end_at}`
                    : '当前合同暂不满足租后评价条件。'}
              </p>

              {canSubmitRentalReview && (
                <>
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium text-gray-200">为房源打分</p>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setReviewRating(value)}
                          className={`text-3xl transition-colors ${value <= reviewRating ? 'text-amber-400' : 'text-gray-600 hover:text-amber-300'}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium text-gray-200">写几句评价（公开）</label>
                    <textarea
                      className="input-field min-h-[140px]"
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="公开描述房源实际情况、居住体验和沟通体验。"
                      disabled={submittingReview}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSubmitRentalReview}
                    disabled={submittingReview}
                    className="btn-primary mt-4 w-full"
                  >
                    {submittingReview ? '提交中...' : '提交评价'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
