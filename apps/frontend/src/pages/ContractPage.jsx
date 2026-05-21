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
      chainId: '0xaa36a7', chainName: 'Sepolia 测试网',
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

function resolveInitialAmount(content) {
  const direct = Number(content?.oneTimeAmount);
  if (Number.isFinite(direct) && direct > 0) return String(content.oneTimeAmount);
  const rent = Number(content?.rentAmount);
  const months = Number(content?.terms?.leaseMonths);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(months) || months <= 0) return '';
  return String((rent * months).toFixed(8).replace(/\.?0+$/, ''));
}

const STATUS_MAP = {
  pending:         { label: '待签署',   color: 'badge-yellow' },
  tenant_signed:   { label: '租客已签', color: 'badge-blue'   },
  pending_payment: { label: '待支付',   color: 'badge-yellow' },
  landlord_signed: { label: '房东已签', color: 'badge-blue'   },
  active:          { label: '已生效',   color: 'badge-green'  },
  ended:           { label: '已结束',   color: 'badge-gray'   },
  cancelled:       { label: '已取消',   color: 'badge-red'    },
  expired:         { label: '已过期',   color: 'badge-gray'   },
  disputed:        { label: '争议中',   color: 'badge-red'    },
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
  const [lastTxHash, setLastTxHash] = useState('');

  const initialAmount = resolveInitialAmount(content);
  const selectedNetwork = NETWORK_OPTIONS.find((x) => x.key === preferredNetwork) || NETWORK_OPTIONS[0];
  const txExplorerBase = TX_EXPLORER_BASE[selectedNetwork.key] || '';

  const loadContract = async () => {
    const d = await apiGet(`/contracts/${id}`);
    setContract(d.data);
    try {
      setContent(typeof d.data.content_json === 'string' ? JSON.parse(d.data.content_json) : d.data.content_json);
    } catch {
      setContent(d.data.content_json);
    }
    const paymentResp = await apiGet(`/contracts/${id}/payments`);
    setPayments(paymentResp?.data || []);
  };

  useEffect(() => {
    loadContract().catch(() => toast.error('加载合同失败')).finally(() => setLoading(false));
  }, [id]);

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

      const res = await apiPost(`/contracts/${id}/${type === 'tenant' ? 'sign-tenant' : 'sign-landlord'}`, { signerAddress }, { headers: { 'X-Request-Id': requestId } });

      if (type === 'landlord' && res.data?.contentHash) {
        try {
          if (!ethers.isAddress(contractAddr)) { toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`); return; }
          const network = await provider.getNetwork();
          if (Number(network.chainId) !== selected.chainId) { toast.error(`请将 MetaMask 切换到 ${selected.label}`); return; }
          if (!ethers.isAddress(res.data.tenantAddress) || !ethers.isAddress(res.data.landlordAddress)) {
            toast.error('合同绑定钱包地址无效，请双方先在个人中心绑定钱包并重新发起合同');
            return;
          }
          const signer = await provider.getSigner();
          const rContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
          const tx = await rContract.storeContract(id, contract?.listing_id || '', res.data.contentHash, res.data.tenantAddress, res.data.landlordAddress);
          await tx.wait();
          await apiPost(`/contracts/${id}/onchain`, { txHash: tx.hash }, { headers: { 'X-Request-Id': requestId } });
          setLastTxHash(tx.hash);
          toast.success('合同哈希已上链存证');
        } catch (err) {
          await reportClientFailure({ type, preferredNetwork: selected.key, message: err?.message || 'onchain_failed', apiStatus: err.response?.status || null, apiError: err.response?.data || { reason: 'onchain_failed' }, walletAddress: signerAddress, chainId: String((await provider.getNetwork())?.chainId || ''), pageUrl: window.location.href });
          if (err.code !== 'ACTION_REJECTED') {
            toast.error(`上链失败：${err?.shortMessage || err?.reason || err?.response?.data?.error || err?.message || 'unknown error'}`);
          }
        }
      }

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
    setPaying(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== selected.chainId) {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
      }
      if (!ethers.isAddress(contractAddr)) { toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`); return; }
      const signer = await provider.getSigner();
      const signerAddress = (await signer.getAddress()).toLowerCase();
      const tenantAddress = (content?.tenant?.walletAddress || '').toLowerCase();
      if (tenantAddress && tenantAddress !== signerAddress) { toast.error(`当前钱包与合同绑定地址不一致：${tenantAddress}`); return; }
      const weiAmount = ethers.parseEther(String(initialAmount));
      const orderNo = `order_${Date.now()}`;
      const rContract = new ethers.Contract(contractAddr, RentalChainABI, signer);
      const tx = await rContract.recordRentPayment(id, content?.tenant?.walletAddress || ethers.ZeroAddress, content?.landlord?.walletAddress || ethers.ZeroAddress, weiAmount, orderNo, { value: weiAmount });
      await tx.wait();
      await apiPost(`/contracts/${id}/payments/onchain`, { txHash: tx.hash, amount: String(initialAmount), payType: 'initial', period: 'initial' });
      setLastTxHash(tx.hash);
      toast.success('一次性支付成功，合同已生效');
      await loadContract();
    } catch (err) {
      toast.error(`支付失败：${err?.shortMessage || err?.response?.data?.error || err?.message || '支付失败'}`);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><LoaderIcon className="w-8 h-8 animate-spin text-primary-500" /></div>;
  }

  if (!contract) {
    return <div className="card p-8 text-center"><p className="text-gray-400">合同不存在</p></div>;
  }

  const statusInfo = STATUS_MAP[contract.status] || { label: contract.status, color: 'badge-gray' };
  const isTenant = contract.tenant_id === user?.id;
  const isLandlord = contract.landlord_id === user?.id;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center space-x-1 text-gray-400 hover:text-gray-200 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" /><span>返回</span>
      </button>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <FileTextIcon className="w-6 h-6 text-primary-400" />
            <h1 className="text-xl font-bold text-gray-100">租赁合同</h1>
          </div>
          <span className={`${statusInfo.color} text-sm`}>{statusInfo.label}</span>
        </div>

        <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm">
          <span className="text-gray-500">合同ID：</span>
          <span className="font-mono text-gray-200 break-all">{contract.id}</span>
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
              <div><p className="text-gray-500">房东</p><p className="font-medium text-gray-200">{content.landlord?.nickname || content.landlord?.phone}</p></div>
              <div><p className="text-gray-500">租客</p><p className="font-medium text-gray-200">{content.tenant?.nickname || content.tenant?.phone}</p></div>
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
                      <p>类型：{item.pay_type} ｜ 金额：{item.amount} ETH</p>
                      <p className="font-mono break-all">Tx: {item.tx_hash}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {contract.status === 'pending' && isTenant && (
            <button onClick={() => handleSign('tenant')} disabled={signing} className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '签署中...' : '租客签署'}</span>
            </button>
          )}
          {contract.status === 'tenant_signed' && isLandlord && (
            <button onClick={() => handleSign('landlord')} disabled={signing} className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '处理中...' : '房东签署'}</span>
            </button>
          )}
          {contract.status === 'pending_payment' && isTenant && (
            <button onClick={handleInitialPayment} disabled={paying} className="btn-primary w-full flex items-center justify-center space-x-2">
              {paying ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{paying ? '支付中...' : `一次性支付 ${initialAmount || ''} ETH 并激活合同`}</span>
            </button>
          )}
          {['pending', 'tenant_signed'].includes(contract.status) && (isTenant || isLandlord) && (
            <button onClick={handleCancel} className="btn-secondary w-full">取消合同</button>
          )}
        </div>
      </div>
    </div>
  );
}
