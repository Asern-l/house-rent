import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeIcon, MapPinIcon, SearchIcon, LoaderIcon } from 'lucide-react';
import { apiGet } from '../shared/api/api';
import { getListingStatusMeta, getFirstImageUrl, resolveImageUrl } from '../shared/listingUtils';

function openMap(address) {
  const q = encodeURIComponent(address);
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const url = isMac ? `maps://?q=${q}&address=${q}` : `https://maps.google.com/?q=${q}`;
  window.open(url, '_blank');
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
        <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/30 px-3 py-2">
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
            const statusMeta = getListingStatusMeta(item.public_status || item.status);
            return (
              <Link key={item.id} to={`/listing/${item.id}`} className="card block p-4 transition-all hover:border-gray-700 hover:-translate-y-0.5">
                <div className="relative mb-3">
                  {getFirstImageUrl(item) ? (
                    <img
                      src={resolveImageUrl(getFirstImageUrl(item))}
                      alt={item.title || 'listing'}
                      className="h-36 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center rounded-lg bg-black/20 border border-white/5">
                      <HomeIcon className="h-12 w-12 text-primary-600" />
                    </div>
                  )}
                  <span className={`${statusMeta.badge} absolute bottom-2 left-2`}>
                    <span className={statusMeta.dot} />
                    {statusMeta.label}
                  </span>
                </div>
                <h3 className="line-clamp-1 text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); openMap(item.address); }}
                  className="mt-2 flex items-start text-sm text-gray-400 transition-colors hover:text-primary-400 group"
                  title="在地图中查看"
                >
                  <MapPinIcon className="mr-1 mt-0.5 h-4 w-4 shrink-0 group-hover:text-primary-400" />
                  <span className="line-clamp-1 text-left underline-offset-2 group-hover:underline">{item.address || '-'}</span>
                </button>
                <p className="mt-3 text-lg font-bold text-primary-400">{item.rent_amount} ETH/月</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
