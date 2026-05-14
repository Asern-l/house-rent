/**
 * 文件说明：房源列表页
 * - 拉取并展示房源列表。
 * - 支持按标题/地址关键词筛选。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeIcon, MapPinIcon, SearchIcon, LoaderIcon } from 'lucide-react';
import { apiGet } from '../shared/api/api';

// 函数 1: 页面主组件。
export default function ListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    let mounted = true;

        // 函数 2: 加载房源列表数据。
    const load = async () => {
      try {
        const res = await apiGet('/listings');
        if (mounted) {
          setListings(res?.data || []);
        }
      } catch (error) {
        if (mounted) {
          setListings([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

    // 函数 3: 按关键词过滤房源列表。
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
        <h1 className="text-2xl font-bold text-gray-800">房源列表</h1>
        <Link to="/publish" className="btn-secondary">
          发布房源
        </Link>
      </div>

      <div className="card mb-4 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
          <SearchIcon className="h-4 w-4 text-gray-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="搜索标题或地址"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="card p-8 text-center">
          <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500">{listings.length === 0 ? '暂无房源' : '未找到匹配房源'}</p>
          {listings.length === 0 && (
            <Link to="/publish" className="btn-primary mt-4 inline-block">
              去发布第一套房源
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredListings.map((item) => (
            <Link key={item.id} to={`/listing/${item.id}`} className="card block p-4 transition-all hover:translate-y-[-2px]">
              <div className="mb-3 flex h-36 items-center justify-center rounded-lg bg-gradient-to-br from-primary-100 to-blue-100">
                <HomeIcon className="h-12 w-12 text-primary-300" />
              </div>
              <h3 className="line-clamp-1 text-base font-semibold text-gray-800">{item.title || '未命名房源'}</h3>
              <p className="mt-2 flex items-start text-sm text-gray-500">
                <MapPinIcon className="mr-1 mt-0.5 h-4 w-4" />
                <span className="line-clamp-2">{item.address || '-'}</span>
              </p>
              <p className="mt-3 text-lg font-bold text-primary-600">{item.rent_amount} ETH/月</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}








