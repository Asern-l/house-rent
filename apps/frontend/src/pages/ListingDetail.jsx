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

function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
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

  const isAvailable = listing.status === 'available';
  const isOwner = user && listing.landlord_id === user.id;
  const minLeaseMonths = Number(listing.min_lease_months || 1);
  const imageUrls = parseImageUrls(listing.image_urls);
  const maxLeaseMonths = 12;
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const maxDateObj = new Date(today);
  maxDateObj.setDate(maxDateObj.getDate() + 3);
  const maxDate = `${maxDateObj.getFullYear()}-${String(maxDateObj.getMonth() + 1).padStart(2, '0')}-${String(maxDateObj.getDate()).padStart(2, '0')}`;

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
            <span className={`${isAvailable ? 'badge-green' : 'badge-gray'} mb-2 inline-block`}>
              {isAvailable ? '可租' : '已出租'}
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
            <span className="text-gray-500">房东邮箱：</span>
            <span>{listing.landlord_email || '未提供'}</span>
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
            <p className="mb-2 text-sm font-medium text-gray-200">历史版本/操作记录</p>
            {history.length === 0 ? (
              <p className="text-xs text-gray-500">暂无历史记录</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {history.slice(0, 20).map((item) => (
                  <div key={item.id} className="rounded bg-gray-900/50 px-2 py-2 text-xs text-gray-300">
                    <p className="font-medium text-gray-200">动作：{item.action}</p>
                    <p>时间：{item.createdAt || '-'}</p>
                    {(() => {
                      const snap = item?.after?.snapshot || item?.after || null;
                      if (!snap || typeof snap !== 'object') return null;
                      return (
                        <div className="mt-1 rounded border border-gray-700 bg-gray-800/50 p-2">
                          <p>标题：{snap.title || '-'}</p>
                          <p>地址：{snap.address || '-'}{snap.district ? `（${snap.district}）` : ''}</p>
                          <p>租金：{snap.rentAmount || '-'} ETH/月</p>
                          <p>最少租期：{snap.minLeaseMonths || '-'} 个月</p>
                          <p>状态：{snap.status || '-'}</p>
                          <p className="break-all">contentHash：{snap.contentHash || '-'}</p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
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
                当前租客邮箱（提交申请后会展示给房东用于协商）：{user?.email || '未设置'}
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

          {isOwner && (
            <p className="rounded-lg bg-yellow-900/20 border border-yellow-800/50 p-3 text-sm text-yellow-400">这是您的房源。</p>
          )}

          {!user && (
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
