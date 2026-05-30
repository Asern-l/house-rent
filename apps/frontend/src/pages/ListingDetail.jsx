import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertCircleIcon, ArrowLeftIcon, HomeIcon, LoaderIcon, MapPinIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';

function parseImageUrls(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function parseClauses(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

function getListingStatusMeta(listing) {
  const status = String(listing?.public_status || listing?.status || '').trim().toLowerCase();
  if (status === 'signing') return { key: 'signing', label: '签署中', className: 'badge-yellow' };
  if (status === 'rented') return { key: 'rented', label: '已租出', className: 'badge-gray' };
  if (status === 'offline') return { key: 'offline', label: '已下架', className: 'badge-gray' };
  if (status === 'closed') return { key: 'closed', label: '已关闭', className: 'badge-red' };
  return { key: 'available', label: '可租', className: 'badge-green' };
}

function normalizeHistorySnapshot(item) {
  const raw = item?.after?.snapshot || item?.after || null;
  if (!raw || typeof raw !== 'object') return null;
  const urls = Array.isArray(raw.imageUrls) ? raw.imageUrls.filter(Boolean).map((x) => String(x)) : [];
  return {
    title: raw.title || '',
    description: raw.description || '',
    address: raw.address || '',
    district: raw.district || '',
    rentAmount: raw.rentAmount || '',
    minLeaseMonths: raw.minLeaseMonths || '',
    status: raw.status || '',
    contentHash: raw.contentHash || '',
    imageUrls: urls,
  };
}

function normalizeHistoryBinding(item) {
  const binding = item?.binding || item?.after?.binding || null;
  if (!binding || typeof binding !== 'object') return null;
  return {
    snapshotHash: binding.snapshotHash || '',
    chainVersion: binding.chainVersion || 0,
    chainNonce: binding.chainNonce || 0,
    txHash: binding.txHash || '',
    eventName: binding.eventName || '',
    blockNumber: binding.blockNumber || 0,
    blockTime: binding.blockTime || 0,
  };
}

function isOnchainHistoryAction(action) {
  return [
    'create_listing_onchain_commit',
    'update_status_onchain_commit',
    'update_terms_onchain_commit',
  ].includes(String(action || '').trim());
}

function getHistoryBindingMeta(item) {
  const requiresBinding = isOnchainHistoryAction(item?.action);
  if (!requiresBinding) {
    return {
      title: '防篡改绑定',
      statusText: '不适用（本次变更未上链）',
      statusClassName: 'text-gray-400',
    };
  }
  return {
    title: '防篡改绑定',
    statusText: item?.bindingVerified ? '通过' : '未通过/缺失',
    statusClassName: item?.bindingVerified ? 'text-emerald-400' : 'text-yellow-300',
  };
}

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [leaseMonths, setLeaseMonths] = useState(1);
  const [history, setHistory] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadListing = async () => {
      setLoading(true);
      try {
        const res = await apiGet(`/listings/${id}`);
        const historyRes = await apiGet(`/listings/${id}/history`).catch(() => ({ data: { history: [] } }));
        if (mounted) {
          setListing(res?.data || null);
          setHistory(Array.isArray(historyRes?.data?.history) ? historyRes.data.history : []);
          const firstHistory = Array.isArray(historyRes?.data?.history) ? historyRes.data.history[0] : null;
          setSelectedHistoryId(firstHistory?.id || '');
          const minLease = Number(res?.data?.min_lease_months || 1);
          setLeaseMonths(minLease >= 1 && minLease <= 12 ? minLease : 1);
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          setStartDate(`${yyyy}-${mm}-${dd}`);
        }
      } catch {
        toast.error('房源不存在或已下架');
        navigate('/listings');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadListing();
    return () => { mounted = false; };
  }, [id, navigate]);

  const handleApply = async () => {
    if (!user) { toast.error('请先登录'); return; }
    if (user.role !== 'tenant') { toast.error('仅租客可以申请签约'); return; }
    setApplying(true);
    try {
      const res = await apiPost('/contracts', { listingId: id, startDate, leaseMonths });
      const contractId = res?.data?.contractId;
      toast.success('申请成功，请等待房东确认');
      navigate(contractId ? `/contract/${contractId}` : '/contracts');
    } catch (error) {
      toast.error(error?.response?.data?.error || '申请失败，请稍后重试');
    } finally {
      setApplying(false);
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

  const statusMeta = getListingStatusMeta(listing);
  const isAvailable = statusMeta.key === 'available';
  const isOwner = user && listing.landlord_id === user.id;
  const minLeaseMonths = Number(listing.min_lease_months || 1);
  const imageUrls = parseImageUrls(listing.image_urls);
  const clauses = parseClauses(listing.clauses_template_json);
  const maxLeaseMonths = 12;
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const maxDateObj = new Date(today);
  maxDateObj.setDate(maxDateObj.getDate() + 3);
  const maxDate = `${maxDateObj.getFullYear()}-${String(maxDateObj.getMonth() + 1).padStart(2, '0')}-${String(maxDateObj.getDate()).padStart(2, '0')}`;
  const selectedHistory = history.find((item) => item.id === selectedHistoryId) || null;
  const selectedSnapshot = normalizeHistorySnapshot(selectedHistory);
  const selectedBinding = normalizeHistoryBinding(selectedHistory);
  const selectedImages = selectedSnapshot?.imageUrls || [];
  const selectedBindingMeta = getHistoryBindingMeta(selectedHistory);

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center space-x-1 text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <span>返回</span>
      </button>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card">
          {imageUrls.length > 0 ? (
            <div className="p-3">
              <img src={resolveImageUrl(imageUrls[0])} alt={listing.title || 'listing'} className="h-64 w-full rounded-lg object-cover" />
              {imageUrls.length > 1 && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {imageUrls.slice(1, 5).map((url, idx) => (
                    <img key={`${url}_${idx}`} src={resolveImageUrl(url)} alt={`listing_${idx}`} className="h-16 w-full rounded-md object-cover" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center bg-gradient-to-br from-primary-900/30 to-blue-900/30">
              <HomeIcon className="h-20 w-20 text-primary-600" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <span className={`${statusMeta.className} mb-2 inline-block`}>
              {statusMeta.label}
            </span>
            <h1 className="mt-2 text-2xl font-bold text-gray-100">{listing.title}</h1>
          </div>

          <p className="text-3xl font-bold text-primary-400">
            {listing.rent_amount} <span className="text-lg font-normal text-gray-400">ETH/月</span>
          </p>

          <div className="flex items-start space-x-2 text-gray-400">
            <MapPinIcon className="mt-1 h-4 w-4 flex-shrink-0" />
            <span>{listing.address}{listing.district ? `（${listing.district}）` : ''}</span>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-sm text-gray-300">
            <span className="text-gray-500">房源ID：</span>
            <span className="font-mono break-all">{listing.id || id}</span>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-sm text-gray-300">
            <span className="text-gray-500">房东：</span>
            <span>{listing.landlord_name || '未提供'}</span>
            {listing.landlord_phone && (
              <span className="ml-3 text-gray-500">📞 {listing.landlord_phone}</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-gray-800 p-3">
              <p className="text-lg font-bold text-gray-200">{listing.bedrooms || '-'}</p>
              <p className="text-xs text-gray-500">室</p>
            </div>
            <div className="rounded-lg bg-gray-800 p-3">
              <p className="text-lg font-bold text-gray-200">{listing.livingrooms || '-'}</p>
              <p className="text-xs text-gray-500">厅</p>
            </div>
            <div className="rounded-lg bg-gray-800 p-3">
              <p className="text-lg font-bold text-gray-200">{listing.area || '-'}</p>
              <p className="text-xs text-gray-500">㎡</p>
            </div>
          </div>

          <p className="leading-relaxed text-gray-300">{listing.description || '暂无描述'}</p>

          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <p className="mb-2 text-sm font-medium text-gray-200">附加条款</p>
            {clauses.length > 0 ? (
              <div className="space-y-2 text-sm text-gray-300">
                {clauses.map((clause, idx) => (
                  <p key={`${idx}_${clause}`} className="rounded bg-gray-900/50 px-3 py-2">
                    {idx + 1}. {clause}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">当前未设置附加条款</p>
            )}
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <p className="mb-2 text-sm font-medium text-gray-200">历史版本</p>
            {history.length === 0 ? (
              <p className="text-xs text-gray-500">暂无历史记录</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {history.slice(0, 30).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedHistoryId(item.id)}
                      className={`w-full rounded border px-2 py-2 text-left text-xs transition-colors ${
                        selectedHistoryId === item.id
                          ? 'border-primary-500 bg-primary-900/25 text-gray-100'
                          : 'border-gray-700 bg-gray-900/40 text-gray-300 hover:bg-gray-900/60'
                      }`}
                    >
                      <p className="font-medium">{item.action}</p>
                      <p className="mt-1 text-gray-400">{item.createdAt || '-'}</p>
                    </button>
                  ))}
                </div>

                <div className="rounded border border-gray-700 bg-gray-900/40 p-3 text-xs text-gray-300">
                  {!selectedHistory ? (
                    <p className="text-gray-500">请选择一个历史版本</p>
                  ) : (
                    <>
                      <p className="font-medium text-gray-100">动作：{selectedHistory.action}</p>
                      <p className="mt-1 text-gray-400">时间：{selectedHistory.createdAt || '-'}</p>
                      {!selectedSnapshot ? (
                        <p className="mt-3 rounded border border-yellow-700/60 bg-yellow-900/20 px-2 py-2 text-yellow-300">
                          该历史记录没有可渲染快照（旧记录或日志字段缺失）。
                        </p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {selectedImages.length > 0 ? (
                            <div className="rounded bg-gray-950/70 p-2">
                              <img
                                src={resolveImageUrl(selectedImages[0])}
                                alt="version"
                                className="h-28 w-full rounded object-cover"
                              />
                              {selectedImages.length > 1 && (
                                <div className="mt-2 grid grid-cols-4 gap-1">
                                  {selectedImages.slice(1, 5).map((url, idx) => (
                                    <img key={`${url}_${idx}`} src={resolveImageUrl(url)} alt={`v_${idx}`} className="h-10 w-full rounded object-cover" />
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex h-20 items-center justify-center rounded bg-gray-950/70 text-gray-500">
                              无图片
                            </div>
                          )}
                          <p>标题：{selectedSnapshot.title || '-'}</p>
                          <p>地址：{selectedSnapshot.address || '-'}{selectedSnapshot.district ? `（${selectedSnapshot.district}）` : ''}</p>
                          <p>租金：{selectedSnapshot.rentAmount || '-'} ETH/月</p>
                          <p>最少租期：{selectedSnapshot.minLeaseMonths || '-'} 个月</p>
                          <p>状态：{selectedSnapshot.status || '-'}</p>
                          <p className="break-all">contentHash：{selectedSnapshot.contentHash || '-'}</p>
                          <p className="text-gray-400">{selectedSnapshot.description || '无描述'}</p>
                          <div className="mt-2 rounded border border-gray-700 bg-gray-900/70 p-2">
                            <p className="font-medium text-gray-200">{selectedBindingMeta.title}</p>
                            <p className={`mt-1 ${selectedBindingMeta.statusClassName}`}>
                              绑定校验：{selectedBindingMeta.statusText}
                            </p>
                            <p className="break-all">本地快照哈希：{selectedHistory?.expectedSnapshotHash || '-'}</p>
                            <p className="break-all">绑定快照哈希：{selectedBinding?.snapshotHash || '-'}</p>
                            <p>链上版本号：{selectedBinding?.chainVersion || '-'}</p>
                            <p>链上操作序号：{selectedBinding?.chainNonce || '-'}</p>
                            <p>事件：{selectedBinding?.eventName || '-'}</p>
                            <p>区块号：{selectedBinding?.blockNumber || '-'}</p>
                            <p className="break-all">交易哈希：{selectedBinding?.txHash || '-'}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-blue-800/50 bg-blue-900/20 p-3 text-sm text-blue-300">
            <p className="mb-1 font-medium">法律提示</p>
            <p>合同哈希可上链存证，链上记录一经确认不可篡改，请在签署前核对条款。</p>
          </div>

          {isAvailable && user?.role === 'tenant' && (
            <div className="space-y-3 rounded-lg border border-gray-700 p-4">
              <p className="text-sm font-medium text-gray-200">签约前设置</p>
              <p className="text-xs text-gray-400">
                当前租客钱包（提交申请后会展示给房东）：{user?.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : '未连接'}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">生效日期（今天至未来3天）</label>
                  <input type="date" min={minDate} max={maxDate} className="input-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">租期（月）</label>
                  <select className="input-field" value={leaseMonths} onChange={(e) => setLeaseMonths(parseInt(e.target.value, 10))}>
                    {Array.from({ length: maxLeaseMonths - minLeaseMonths + 1 }, (_, i) => minLeaseMonths + i).map((m) => (
                      <option key={m} value={m}>{m}个月</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500">该房源最少租期：{minLeaseMonths}个月，最长12个月。</p>
              <button type="button" onClick={handleApply} disabled={applying} className="btn-primary flex w-full items-center justify-center space-x-2 py-3">
                {applying ? <LoaderIcon className="h-5 w-5 animate-spin" /> : null}
                <span>{applying ? '申请中...' : '申请签约'}</span>
              </button>
            </div>
          )}

          {statusMeta.key === 'signing' && (
            <p className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
              该房源已有合同在签署流程中，暂不能发起新的签约申请。
            </p>
          )}

          {statusMeta.key === 'rented' && (
            <p className="rounded-lg border border-gray-700 bg-gray-800/70 p-3 text-sm text-gray-300">
              该房源已租出，可查看房源信息和链上存证，暂不能发起新的普通签约申请。
            </p>
          )}

          {isOwner && (
            <p className="rounded-lg bg-yellow-900/20 border border-yellow-800/50 p-3 text-sm text-yellow-400">这是您的房源。</p>
          )}

          {!user && isAvailable && (
            <div className="flex items-start rounded-lg bg-gray-800 p-3 text-sm text-gray-300">
              <AlertCircleIcon className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                请先
                <a href="/login" className="px-1 text-primary-400 underline">登录</a>
                后再申请签约。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
