/**
 * 文件说明：房源详情页
 * - 展示单个房源详情信息。
 * - 租客可在房源可租时发起签约申请。
 * - 未登录与房东查看自身房源时给出对应提示。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  HomeIcon,
  LoaderIcon,
  MapPinIcon,
} from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';

// 函数 0: 解析房源图片数组。
function parseImageUrls(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// 函数 0-1: 按当前网络修正图片 URL 代理前缀。
function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

// 函数 1: 页面主组件。
export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [leaseMonths, setLeaseMonths] = useState(1);

  // 加载房源详情
  useEffect(() => {
    let mounted = true;

        // 函数 2: 加载指定房源详情。
    const loadListing = async () => {
      setLoading(true);
      try {
        const res = await apiGet(`/listings/${id}`);
        if (mounted) {
          setListing(res?.data || null);
          const minLease = Number(res?.data?.min_lease_months || 1);
          setLeaseMonths(minLease >= 1 && minLease <= 12 ? minLease : 1);
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          setStartDate(`${yyyy}-${mm}-${dd}`);
        }
      } catch (error) {
        toast.error('房源不存在或已下架');
        navigate('/listings');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadListing();
    return () => {
      mounted = false;
    };
  }, [id, navigate]);

  // 租客申请签约
    // 函数 3: 租客发起签约申请。
  const handleApply = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }

    if (user.role !== 'tenant') {
      toast.error('仅租客可以申请签约');
      return;
    }

    setApplying(true);
    try {
      const payload = {
        listingId: id,
        startDate,
        leaseMonths,
      };
      const res = await apiPost('/contracts', payload);
      const contractId = res?.data?.contractId;
      toast.success('申请成功，请等待房东确认');
      if (contractId) {
        navigate(`/contract/${contractId}`);
      } else {
        navigate('/my-contracts');
      }
    } catch (error) {
      const message = error?.response?.data?.error || '申请失败，请稍后重试';
      toast.error(message);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!listing) {
    return null;
  }

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
        className="mb-4 flex items-center space-x-1 text-gray-500 hover:text-gray-700"
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
            <div className="flex h-64 items-center justify-center bg-gradient-to-br from-primary-100 to-blue-100">
              <HomeIcon className="h-20 w-20 text-primary-300" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <span className={`${isAvailable ? 'badge-green' : 'badge-gray'} mb-2 inline-block`}>
              {isAvailable ? '可租' : '已出租'}
            </span>
            <h1 className="mt-2 text-2xl font-bold text-gray-800">{listing.title}</h1>
          </div>

          <p className="text-3xl font-bold text-primary-600">
            {listing.rent_amount} <span className="text-lg font-normal">ETH/月</span>
          </p>

          <div className="flex items-start space-x-2 text-gray-500">
            <MapPinIcon className="mt-1 h-4 w-4" />
            <span>{listing.address}{listing.district ? `（${listing.district}）` : ''}</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-700">{listing.bedrooms || '-'}</p>
              <p className="text-xs text-gray-500">室</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-700">{listing.livingrooms || '-'}</p>
              <p className="text-xs text-gray-500">厅</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-700">{listing.area || '-'}</p>
              <p className="text-xs text-gray-500">㎡</p>
            </div>
          </div>

          <p className="leading-relaxed text-gray-600">{listing.description || '暂无描述'}</p>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            <p className="mb-1 font-medium">法律提示</p>
            <p>合同哈希可上链存证，链上记录一经确认不可篡改，请在签署前核对条款。</p>
          </div>

          {isAvailable && user?.role === 'tenant' && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-700">签约前设置</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-600">生效日期（今天至未来3天）</label>
                  <input
                    type="date"
                    min={minDate}
                    max={maxDate}
                    className="input-field"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">租期（月）</label>
                  <select
                    className="input-field"
                    value={leaseMonths}
                    onChange={(e) => setLeaseMonths(parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: maxLeaseMonths - minLeaseMonths + 1 }, (_, i) => minLeaseMonths + i).map((m) => (
                      <option key={m} value={m}>{m}个月</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500">该房源最少租期：{minLeaseMonths}个月，最长12个月。</p>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className="btn-primary flex w-full items-center justify-center space-x-2 py-3"
              >
                {applying ? <LoaderIcon className="h-5 w-5 animate-spin" /> : null}
                <span>{applying ? '申请中...' : '申请签约'}</span>
              </button>
            </div>
          )}

          {isOwner && (
            <p className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-700">这是您的房源。</p>
          )}

          {!user && (
            <div className="flex items-start rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <AlertCircleIcon className="mr-2 mt-0.5 h-4 w-4" />
              <p>
                请先
                <a href="/login" className="px-1 text-primary-600 underline">
                  登录
                </a>
                后再申请签约。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}








