import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeIcon, LoaderIcon, MapPinIcon, SearchIcon } from 'lucide-react';
import { apiGet } from '../shared/api/api';

function getFirstImageUrl(item) {
  try {
    const raw = item?.image_urls;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0] || '') : '';
  } catch {
    return '';
  }
}

function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

function getListingStatusMeta(item) {
  const status = String(item?.public_status || item?.status || '').trim().toLowerCase();
  if (status === 'signing') {
    return { label: '签约中', className: 'border-yellow-700/60 bg-yellow-900/30 text-yellow-300' };
  }
  if (status === 'rented') {
    return { label: '已租出', className: 'border-gray-600 bg-gray-800 text-gray-300' };
  }
  if (status === 'offline') {
    return { label: '已下架', className: 'border-slate-700/60 bg-slate-900/40 text-slate-300' };
  }
  if (status === 'closed') {
    return { label: '已关闭', className: 'border-red-800/50 bg-red-950/30 text-red-300' };
  }
  return { label: '可申请', className: 'border-emerald-700/60 bg-emerald-900/30 text-emerald-300' };
}

export default function ListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await apiGet('/listings');
        if (mounted) setListings(res?.data || []);
      } catch {
        if (mounted) setListings([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const filteredListings = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((item) => {
      const title = String(item.title || '').toLowerCase();
      const address = String(item.address || '').toLowerCase();
      return title.includes(q) || address.includes(q);
    });
  }, [keyword, listings]);

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-100">房源列表</h1>
      </div>

      <div className="card mb-4 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
          <SearchIcon className="h-4 w-4 text-gray-500" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
            placeholder="搜索标题或地址"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="card p-8 text-center">
          <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">{listings.length === 0 ? '暂无房源' : '未找到匹配房源'}</p>
          {listings.length === 0 && (
            <Link to="/publish" className="btn-primary mt-4 inline-block">
              去发布第一套房源
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredListings.map((item) => {
            const statusMeta = getListingStatusMeta(item);
            const firstImage = getFirstImageUrl(item);
            return (
              <Link key={item.id} to={`/listing/${item.id}`} className="card block p-4 transition-all hover:-translate-y-0.5 hover:border-gray-700">
                <div className="relative mb-3">
                  {firstImage ? (
                    <img
                      src={resolveImageUrl(firstImage)}
                      alt={item.title || 'listing'}
                      className="h-36 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center rounded-lg bg-gradient-to-br from-primary-900/30 to-blue-900/30">
                      <HomeIcon className="h-12 w-12 text-primary-600" />
                    </div>
                  )}
                  <span className={`absolute left-2 top-2 rounded-md border px-2 py-1 text-xs font-semibold ${statusMeta.className}`}>
                    {statusMeta.label}
                  </span>
                </div>

                <h3 className="line-clamp-1 text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                <p className="mt-2 flex items-start text-sm text-gray-400">
                  <MapPinIcon className="mr-1 mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span className="line-clamp-2">{item.address || '-'}</span>
                </p>
                <p className="mt-3 text-lg font-bold text-primary-400">{item.rent_amount} ETH/月</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
