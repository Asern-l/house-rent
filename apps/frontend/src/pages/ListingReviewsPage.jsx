import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { ArrowLeftIcon, LoaderIcon, MessageSquareTextIcon, StarIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';

const FEEDBACK_TYPE_OPTIONS = [
  { value: 'mismatch', code: 1, label: '与描述不符' },
  { value: 'photos', code: 2, label: '图片过旧' },
  { value: 'noise', code: 3, label: '位置噪音大' },
  { value: 'communication', code: 4, label: '沟通体验一般' },
  { value: 'other', code: 5, label: '其他反馈' },
];

const NETWORK_OPTIONS = [
  { key: 'sepolia', chainId: 11155111, chainIdHex: '0xaa36a7' },
  { key: 'local', chainId: 31337, chainIdHex: '0x7a69' },
];

const CONTRACT_ADDR_MAP = {
  sepolia: String(import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '').trim(),
  local: String(import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '').trim(),
};

function renderStars(rating) {
  return '★'.repeat(Math.max(0, Number(rating || 0))) + '☆'.repeat(Math.max(0, 5 - Number(rating || 0)));
}

function normalizePublicComment(raw) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

function buildCommentHash(commentText) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(commentText || '')));
}

function formatDateTime(value) {
  return String(value || '').trim() || '-';
}

export default function ListingReviewsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, preferredNetwork } = useAuth();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackType, setFeedbackType] = useState('mismatch');
  const [feedbackText, setFeedbackText] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const loadListing = async () => {
    const res = await apiGet(`/listings/${id}`);
    setListing(res?.data || null);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      try {
        const res = await apiGet(`/listings/${id}`);
        if (mounted) setListing(res?.data || null);
      } catch {
        toast.error('房源不存在');
        navigate('/listings');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => { mounted = false; };
  }, [id, navigate]);

  const handleSubmitFeedback = async () => {
    if (!user) {
      toast.error('请先登录后再提交房源反馈');
      return;
    }
    if (!window.ethereum) {
      toast.error('请先安装 MetaMask 钱包');
      return;
    }
    if (listing?.landlord_id === user.id) {
      toast.error('房东不能给自己的房源提交反馈');
      return;
    }
    const normalizedComment = normalizePublicComment(feedbackText);
    if (!normalizedComment || normalizedComment.length > 300) {
      toast.error('反馈内容不能为空且不能超过 300 字');
      return;
    }
    const option = FEEDBACK_TYPE_OPTIONS.find((item) => item.value === feedbackType);
    if (!option) {
      toast.error('反馈类型不合法');
      return;
    }

    const selected = NETWORK_OPTIONS.find((item) => item.key === preferredNetwork) || NETWORK_OPTIONS[0];
    const contractAddress = String(CONTRACT_ADDR_MAP[selected.key] || '').trim();
    if (!ethers.isAddress(contractAddress)) {
      toast.error(`VITE_CONTRACT_ADDRESS_${selected.key.toUpperCase()} 未配置或格式无效`);
      return;
    }

    setSubmittingFeedback(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== selected.chainId) {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: selected.chainIdHex }] });
      }
      const signer = await provider.getSigner();
      const signerAddress = String((await signer.getAddress()) || '').trim().toLowerCase();
      const boundAddress = String(user.walletAddress || '').trim().toLowerCase();
      if (!boundAddress || signerAddress !== boundAddress) {
        toast.error(`当前钱包与登录地址不一致：${boundAddress || '未绑定地址'}`);
        return;
      }

      const contract = new ethers.Contract(contractAddress, RentalChainABI, signer);
      const commentHash = buildCommentHash(normalizedComment);
      const prepare = await apiPost(`/listings/${id}/feedbacks/prepare-onchain`, {
        feedbackType,
        commentText: normalizedComment,
        commentHash,
      });
      const commentCid = String(prepare?.data?.commentCid || '').trim();
      if (!commentCid) {
        throw new Error('反馈 commentCid 生成失败');
      }
      await contract.submitListingFeedback.staticCall(id, option.code, commentHash, commentCid);
      const estimatedGas = await contract.submitListingFeedback.estimateGas(id, option.code, commentHash, commentCid);
      const tx = await contract.submitListingFeedback(id, option.code, commentHash, commentCid, {
        gasLimit: (estimatedGas * 120n) / 100n,
      });
      await tx.wait();

      await apiPost(`/listings/${id}/feedbacks`, {
        txHash: String(tx.hash || ''),
        feedbackType,
        commentText: normalizedComment,
        commentHash,
        commentCid,
      });

      toast.success('房源反馈已提交');
      setFeedbackText('');
      await loadListing();
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || '房源反馈提交失败');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!listing) return null;

  const tenantReviews = Array.isArray(listing.tenant_reviews) ? listing.tenant_reviews : [];
  const feedbacks = Array.isArray(listing.feedbacks) ? listing.feedbacks : [];
  const reviewSummary = listing.review_summary || {};
  const isOwner = user && listing.landlord_id === user.id;

  return (
    <div className="mx-auto max-w-5xl animate-fade-in space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate(`/listing/${id}`)}
          className="flex items-center space-x-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span>返回房源详情</span>
        </button>
        <Link to={`/listing/${id}`} className="text-sm text-primary-300 hover:text-primary-200">
          查看房源正文
        </Link>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Reviews</p>
            <h1 className="mt-2 text-3xl font-bold text-white">{listing.title || '房源评价'}</h1>
            <p className="mt-2 text-sm text-slate-400">{listing.address}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
            {reviewSummary.average_visible ? (
              <>
                <p className="text-3xl font-bold text-amber-300">{Number(reviewSummary.weighted_average || 0).toFixed(1)}</p>
                <p className="mt-1 text-xs text-slate-400">{reviewSummary.review_count || 0} 条真实租客评价，按租期加权</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-200">样本不足</p>
                <p className="mt-1 text-xs text-slate-400">至少 {reviewSummary.sample_threshold || 3} 条真实租客评价后公开平均分</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
              <StarIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">真实租客评价</h2>
              <p className="text-sm text-slate-400">仅来自真实结束合同的租客评价。按地址公开展示，单合同仅一条。</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {tenantReviews.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">暂无真实租客评价</p>
            ) : tenantReviews.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium text-amber-300">{renderStars(item.rating)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">真实租客评价</span>
                      <span className="font-mono">地址：{item.tenant_wallet || '未知地址'}</span>
                      <span>权重：{item.weight}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.comment_text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
              <MessageSquareTextIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">链上房源反馈</h2>
              <p className="text-sm text-slate-400">公开展示，按地址发起。可重复提交，不计入正式星级。</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {feedbacks.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">暂无房源反馈</p>
            ) : feedbacks.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="badge-gray">{FEEDBACK_TYPE_OPTIONS.find((opt) => opt.value === item.feedback_type)?.label || item.feedback_type}</span>
                    <span className="font-mono">地址：{item.author_wallet || '未知地址'}</span>
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.comment_text}</p>
              </article>
            ))}
          </div>

          {!isOwner && user && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm font-medium text-white">提交链上房源反馈</p>
              <p className="mt-1 text-xs text-slate-400">公开按地址展示。允许重复提交，是否灌水由链上 gas 成本自然约束。</p>
              <div className="mt-4 grid gap-3">
                <select className="input-field" value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
                  {FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <textarea
                  className="input-field min-h-[120px]"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="公开反馈房源与描述、图片、噪音、沟通等实际情况。"
                />
                <div className="flex justify-end">
                  <button type="button" onClick={handleSubmitFeedback} disabled={submittingFeedback} className="btn-primary">
                    {submittingFeedback ? '提交中...' : '提交链上反馈'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
