import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FileTextIcon, LoaderIcon, RefreshCwIcon, SearchIcon, StarIcon, XIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';

const STATUS_MAP = {
  pending: { label: '待签署', color: 'badge-yellow' },
  tenant_signed: { label: '租客已签', color: 'badge-blue' },
  pending_payment: { label: '待支付', color: 'badge-yellow' },
  active: { label: '已生效', color: 'badge-green' },
  ended: { label: '已结束', color: 'badge-gray' },
  cancelled_before_payment: { label: '已取消', color: 'badge-red' },
  terminated_early: { label: '提前解约', color: 'badge-red' },
  expired: { label: '已过期', color: 'badge-gray' },
};

const NETWORK_OPTIONS = [
  { key: 'sepolia', chainId: 11155111, chainIdHex: '0xaa36a7' },
  { key: 'local', chainId: 31337, chainIdHex: '0x7a69' },
];

const CONTRACT_ADDR_MAP = {
  sepolia: String(import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '').trim(),
  local: String(import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '').trim(),
};

function parseContent(contract) {
  try {
    if (typeof contract?.content_json === 'string') return JSON.parse(contract.content_json || '{}');
    return contract?.content_json && typeof contract.content_json === 'object' ? contract.content_json : {};
  } catch { return {}; }
}

function resolveContractStartAtMs(contract) {
  const content = parseContent(contract);
  const exactStartAtMs = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exactStartAtMs) && exactStartAtMs > 0) return exactStartAtMs;
  const startDate = String(content?.terms?.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 0;
  const d = new Date(`${startDate}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveStatusMeta(contract) {
  const status = String(contract?.status || '').trim();
  if (status === 'active') {
    const startAtMs = resolveContractStartAtMs(contract);
    if (String(contract?.parent_contract_id || '').trim() && startAtMs > Date.now()) {
      return { label: '已支付待接续', color: 'badge-blue' };
    }
  }
  return STATUS_MAP[status] || { label: status || '未知状态', color: 'badge-gray' };
}

function formatCnDateTime(value) {
  if (!value) return '-';
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(`${text}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

// ── 续租弹窗 ──────────────────────────────────────────────
function RenewalDialog({ contract, onClose, onSuccess }) {
  const [leaseMonths, setLeaseMonths] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiPost(`/contracts/${contract.id}/renewals`, { leaseMonths });
      toast.success('续约合同已创建，请按正常流程签署');
      onSuccess(res?.data?.contractId);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || '续约失败');
    } finally {
      setSubmitting(false);
    }
  }

  const content = parseContent(contract);
  const endDate = content?.terms?.endDate || '-';
  const rentAmount = content?.rentAmount || '-';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative w-full max-w-md p-6">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-gray-500 hover:text-gray-200">
          <XIcon className="h-5 w-5" />
        </button>
        <div className="mb-5 flex items-center gap-2">
          <RefreshCwIcon className="h-5 w-5 text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-100">申请续租</h2>
        </div>

        <div className="mb-5 space-y-2 rounded-2xl bg-black/30 p-3 text-sm">
          <p className="text-gray-400">房源：<span className="text-gray-100">{contract.listing_title || '-'}</span></p>
          <p className="text-gray-400">原合同到期：<span className="text-gray-100">{endDate}</span></p>
          <p className="text-gray-400">月租金：<span className="text-primary-400 font-semibold">{rentAmount} ETH</span></p>
          <p className="text-xs text-gray-500 mt-1">续约将以原合同到期日为起始，月租金沿用原合同。</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">续租期限</label>
            <select
              value={leaseMonths}
              onChange={(e) => setLeaseMonths(Number(e.target.value))}
              className="w-full rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-gray-100 outline-none"
            >
              {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                <option key={m} value={m}>{m} 个月</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-primary-800/30 bg-primary-900/20 p-3 text-sm">
            <p className="text-gray-300">续租总额：
              <span className="ml-1 font-semibold text-primary-300">
                {rentAmount !== '-' ? (parseFloat(rentAmount) * leaseMonths).toFixed(4) : '-'} ETH
              </span>
            </p>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-white/15 py-2 text-sm text-gray-400 hover:text-gray-200">
              取消
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {submitting && <LoaderIcon className="h-4 w-4 animate-spin" />}
              {submitting ? '提交中...' : '提交续约申请'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 评价弹窗 ──────────────────────────────────────────────
function ReviewDialog({ contract, preferredNetwork, onClose, onSuccess }) {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) { toast.error('请填写评价内容'); return; }

    setSubmitting(true);
    try {
      // 1. 客户端哈希评价内容
      const commentHash = ethers.keccak256(ethers.toUtf8Bytes(text));

      // 2. 向后端申请 prepare-onchain（需要 IPFS）
      const prepareRes = await apiPost(`/contracts/${contract.id}/review/prepare-onchain`, {
        rating,
        commentText: text,
        commentHash,
      });
      const { commentCid, permit } = prepareRes?.data || {};
      if (!commentCid || !permit) throw new Error('prepare-onchain 返回数据无效');

      // 3. 连接钱包，提交链上评价
      if (!window.ethereum) throw new Error('请安装 MetaMask');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const networkKey = String(preferredNetwork || 'sepolia').toLowerCase();
      const networkOpt = NETWORK_OPTIONS.find((n) => n.key === networkKey) || NETWORK_OPTIONS[0];
      const chainIdHex = networkOpt.chainIdHex;
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });

      const signer = await provider.getSigner();
      const contractAddr = CONTRACT_ADDR_MAP[networkKey];
      if (!contractAddr) throw new Error('合约地址未配置');
      const rentalContract = new ethers.Contract(contractAddr, RentalChainABI, signer);

      const tx = await rentalContract.submitRentalReview(
        contract.id,
        commentHash,
        rating,
        commentCid,
        permit.nonce,
        permit.deadlineMs,
        permit.signature,
      );
      await tx.wait();

      // 4. 回写后端
      await apiPost(`/contracts/${contract.id}/review/onchain`, {
        txHash: tx.hash,
        rating,
        commentText: text,
        commentHash,
        commentCid,
      });

      toast.success('评价已提交并上链！');
      onSuccess();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || '提交失败';
      if (msg.includes('IPFS')) {
        toast.error('IPFS 未启用，请先在系统设置中配置 IPFS 节点后再提交评价');
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative w-full max-w-md p-6">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-gray-500 hover:text-gray-200">
          <XIcon className="h-5 w-5" />
        </button>
        <div className="mb-5 flex items-center gap-2">
          <StarIcon className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-gray-100">提交租后评价</h2>
        </div>

        <p className="mb-4 text-sm text-gray-400">
          房源：<span className="text-gray-100">{contract.listing_title || '-'}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 星级 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">评分</label>
            <div className="flex gap-1">
              {[1,2,3,4,5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(s)}
                  className="text-2xl transition-transform hover:scale-110"
                >
                  <span className={(hoverRating || rating) >= s ? 'text-amber-400' : 'text-gray-600'}>★</span>
                </button>
              ))}
              <span className="ml-2 self-center text-sm text-gray-400">{rating} / 5</span>
            </div>
          </div>

          {/* 评价内容 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              评价内容 <span className="text-gray-500">（最多 500 字）</span>
            </label>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value.slice(0, 500))}
              rows={4}
              className="w-full resize-none rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-primary-700"
              placeholder="描述你的真实租房体验..."
            />
            <p className="mt-1 text-right text-xs text-gray-500">{commentText.length} / 500</p>
          </div>

          <p className="text-xs text-gray-500">
            评价将上链存证（需要 IPFS 和 MetaMask）。每份合同只能提交一次。
          </p>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-white/15 py-2 text-sm text-gray-400 hover:text-gray-200">
              取消
            </button>
            <button type="submit" disabled={submitting || !commentText.trim()} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
              {submitting && <LoaderIcon className="h-4 w-4 animate-spin" />}
              {submitting ? '上链中...' : '提交评价'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────
export default function MyContracts() {
  const { user, preferredNetwork } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renewalTarget, setRenewalTarget] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);

  const loadContracts = async () => {
    if (!user) { setLoading(false); return; }
    try {
      const res = await apiGet('/contracts');
      setContracts(res?.data || []);
    } catch {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!user) { setLoading(false); return; }
      try {
        const res = await apiGet('/contracts');
        if (mounted) setContracts(res?.data || []);
      } catch {
        if (mounted) setContracts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [user]);

  if (!user) {
    return (
      <div className="card p-8 text-center">
        <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
        <p className="text-gray-400">请先登录后查看合同</p>
        <Link to="/login" className="btn-primary mt-3 inline-block">登录</Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="mb-4 text-2xl font-bold text-gray-100">我的合同</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="card p-8 text-center">
          <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="mb-3 text-gray-400">暂无合同</p>
          {user.role === 'tenant' ? (
            <Link to="/listings" className="btn-primary inline-flex items-center gap-2">
              <SearchIcon className="h-4 w-4" /><span>浏览房源</span>
            </Link>
          ) : (
            <p className="text-sm text-gray-500">等待租客发起签约申请</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const status = resolveStatusMeta(contract);
            const rawStatus = String(contract.status || '');
            const isRenewal = !!String(contract.parent_contract_id || '').trim();
            const isTenant = user.role === 'tenant';

            // 续租：租客 + 合同 active + 尚未有续租子合同
            const canRenew = isTenant && rawStatus === 'active' && !contract.renewal_child_contract;

            // 评价：租客 + 合同 ended + 评价窗口内 + 尚未提交
            const canReview = isTenant && rawStatus === 'ended'
              && contract.review_window_open
              && !contract.has_review;

            return (
              <div key={contract.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/contract/${contract.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-100 hover:text-primary-300 transition-colors">
                        {contract.listing_title || '房源合同'}
                      </h3>
                      {isRenewal && <span className="badge-blue shrink-0">续约合同</span>}
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{contract.listing_address || '-'}</p>
                    <p className="mt-1 text-xs text-gray-500">合同ID：{contract.id}</p>
                    {isRenewal && <p className="mt-1 text-xs text-gray-500">父合同ID：{contract.parent_contract_id}</p>}
                  </Link>
                  <div className="shrink-0 text-right">
                    <span className={status.color}>{status.label}</span>
                    <p className="mt-1 text-xs text-gray-500">{formatCnDateTime(contract.created_at)}</p>
                  </div>
                </div>

                {/* 操作按钮行 */}
                {(canRenew || canReview) && (
                  <div className="mt-3 flex gap-2 border-t border-white/5 pt-3">
                    {canRenew && (
                      <button
                        type="button"
                        onClick={() => setRenewalTarget(contract)}
                        className="flex items-center gap-1.5 rounded-2xl border border-primary-700/40 bg-primary-900/30 px-3 py-1.5 text-sm font-medium text-primary-300 transition-colors hover:bg-primary-900/50"
                      >
                        <RefreshCwIcon className="h-3.5 w-3.5" />
                        申请续租
                      </button>
                    )}
                    {canReview && (
                      <button
                        type="button"
                        onClick={() => setReviewTarget(contract)}
                        className="flex items-center gap-1.5 rounded-2xl border border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-900/30"
                      >
                        <StarIcon className="h-3.5 w-3.5" />
                        提交评价
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 续租弹窗 */}
      {renewalTarget && (
        <RenewalDialog
          contract={renewalTarget}
          onClose={() => setRenewalTarget(null)}
          onSuccess={(newContractId) => {
            setRenewalTarget(null);
            if (newContractId) navigate(`/contract/${newContractId}`);
            else loadContracts();
          }}
        />
      )}

      {/* 评价弹窗 */}
      {reviewTarget && (
        <ReviewDialog
          contract={reviewTarget}
          preferredNetwork={preferredNetwork}
          onClose={() => setReviewTarget(null)}
          onSuccess={() => {
            setReviewTarget(null);
            loadContracts();
          }}
        />
      )}
    </div>
  );
}
