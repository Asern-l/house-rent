import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../utils/api';
import { HomeIcon, MapPinIcon, SearchIcon, LoaderIcon } from 'lucide-react';

export default function ListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiGet('/listings?status=available').then(d => setListings(d.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = listings.filter(l =>
    !search || l.title?.includes(search) || l.description?.includes(search) || l.address?.includes(search)
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800">房源列表</h1>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input type="text" placeholder="搜索地址、标题..." className="input-field pl-10"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><LoaderIcon className="w-8 h-8 animate-spin text-primary-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <SearchIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{listings.length === 0 ? '暂无房源' : '未找到匹配房源'}</p>
          {listings.length === 0 && <Link to="/publish" className="btn-primary mt-4 inline-block">发布房源</Link>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(item => (
            <Link key={item.id} to={`/listing/${item.id}`} className="card p-4 hover:translate-y-[-2px] transition-all">
              <div className="h-36 bg-gradient-to-br from-primary-100 to-blue-100 rounded-lg mb-3 flex items-center justify-center">
                <HomeIcon className="w-10 h-10 text-primary-300" />
              </div>
              <h3 className="font-semibold text-gray-800 truncate">{item.title}</h3>
              <p className="text-sm text-gray-500 flex items-center space-x-1 mt-1">
                <MapPinIcon className="w-3 h-3" /><span>{item.district || item.address?.slice(0, 20)}</span>
              </p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-lg font-bold text-primary-600">{item.rent_amount} <span className="text-sm font-normal">ETH/月</span></p>
                <span className="badge-green">AI {item.ai_score}分</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
