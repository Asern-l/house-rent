import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiGet, apiPost, apiPut } from '../shared/api/api';
import { HomeIcon, LoaderIcon } from 'lucide-react';

const LISTING_STATUS_MAP = {
  available: { label: '可租',     badge: 'badge-green'  },
  offline:   { label: '已下架',   badge: 'badge-gray'   },
  locked:    { label: '签约锁定中', badge: 'badge-yellow' },
  rented:    { label: '已出租',   badge: 'badge-blue'   },
  closed:    { label: '已关闭',   badge: 'badge-gray'   },
};

function getFirstImageUrl(item) {
  try {
    const raw = item?.image_urls;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0] || '') : '';
  } catch { return ''; }
}

function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadMyListings = async () => {
      try {
        const res = await apiGet('/listings/my');
        if (mounted) setListings(res?.data || []);
      } catch {
        if (mounted) setListings([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadMyListings();
    return () => { mounted = false; };
  }, []);

  const updateStatus = async (id, status) => {
    try {
      await apiPut(`/listings/${id}/status`, { status });
      toast.success(status === 'available' ? '房源已重新上架' : '房源已下架');
      setListings((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '操作失败');
    }
  };

  const updatePrice = async (item) => {
    const rentAmount = prompt('请输入新的月租金（ETH）', item.rent_amount || '');
    if (!rentAmount) return;
    try {
      const res = await apiPut(`/listings/${item.id}/price`, { rentAmount, reason: 'landlord_update' });
      toast.success('改价成功');
      setListings((prev) => prev.map((x) => (x.id === item.id ? { ...x, rent_amount: res.data.rentAmount } : x)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '改价失败');
    }
  };

  const rescore = async (id) => {
    try {
      const res = await apiPost(`/listings/${id}/score`, {});
      toast.success(`评分完成：${res.data.score}`);
      setListings((prev) => prev.map((x) => (x.id === id ? { ...x, ai_score: res.data.score, ai_risk_tags: res.data.riskTags } : x)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '评分失败');
    }
  };

  const retryOnchain = async (id) => {
    try {
      const res = await apiPost(`/listings/${id}/onchain/retry`, {});
      toast.success('房源上链成功');
      setListings((prev) => prev.map((x) => (x.id === id ? { ...x, tx_hash: res.data.txHash, onchain_status: 'confirmed' } : x)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '房源上链失败');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">我的房源</h1>
        <Link to="/publish" className="btn-primary">发布新房源</Link>
      </div>

      {listings.length === 0 ? (
        <div className="card p-8 text-center">
          <HomeIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">暂无已发布房源</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((item) => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {getFirstImageUrl(item) ? (
                    <img src={resolveImageUrl(getFirstImageUrl(item))} alt={item.title || 'listing'} className="h-20 w-28 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="flex h-20 w-28 flex-shrink-0 items-center justify-center rounded-md bg-gray-800">
                      <HomeIcon className="h-6 w-6 text-gray-600" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                    <p className="mt-1 text-sm text-gray-400">{item.address || '-'}</p>
                    <p className="mt-2 text-primary-400 font-medium">{item.rent_amount} ETH/月</p>
                    <p className="mt-1 text-xs text-gray-500">AI评分: {item.ai_score ?? '-'} ｜ 上链: {item.tx_hash ? '已上链' : (item.onchain_status || '未上链')}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).badge}>
                    {(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).label}
                  </span>
                  <div className="mt-2">
                    {item.status === 'available' ? (
                      <div className="flex flex-col gap-2">
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateStatus(item.id, 'offline')}>下架</button>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updatePrice(item)}>改价</button>
                      </div>
                    ) : item.status === 'offline' ? (
                      <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateStatus(item.id, 'available')}>重新上架</button>
                    ) : (
                      <span className="text-xs text-gray-500">流程中不可操作</span>
                    )}
                    <div className="mt-2 flex flex-col gap-2">
                      <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => rescore(item.id)}>重新评分</button>
                      {!item.tx_hash && <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => retryOnchain(item.id)}>重试上链</button>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
