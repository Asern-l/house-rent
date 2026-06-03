import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuitIcon, HomeIcon, LoaderIcon, MapPinIcon, SearchIcon, SparklesIcon, XIcon } from 'lucide-react';
import { apiGet, apiPost } from '../shared/api/api';
import { getFirstImageUrl, getListingStatusMeta, resolveImageUrl } from '../shared/listingUtils';

function openMap(address) {
  const q = encodeURIComponent(address);
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  window.open(isMac ? `maps://?q=${q}&address=${q}` : `https://maps.google.com/?q=${q}`, '_blank');
}

const BEDROOM_OPTIONS = [
  { value: 0, label: '不限室型' },
  { value: 1, label: '1 室' },
  { value: 2, label: '2 室' },
  { value: 3, label: '3 室' },
  { value: 4, label: '4 室+' },
];

export default function ListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allListings, setAllListings] = useState([]);

  // 筛选状态
  const [aiQuery, setAiQuery] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiEngine, setAiEngine] = useState(null); // 'deepseek' | 'regex' | null
  const [filters, setFilters] = useState({ keyword: '', district: '', minRent: 0, maxRent: 0, bedrooms: 0 });
  const [activeChips, setActiveChips] = useState({});
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState(''); // 'rent_asc'|'rent_desc'|'area_desc'|'area_asc'|'newest'

  const SORT_LABELS = {
    rent_asc:  '价格从低到高',
    rent_desc: '价格从高到低',
    area_desc: '面积从大到小',
    area_asc:  '面积从小到大',
    newest:    '最新上架',
  };

  // 初始加载全量（用于地区下拉列表）
  useEffect(() => {
    let mounted = true;
    apiGet('/listings').then((res) => {
      if (!mounted) return;
      const data = res?.data || [];
      setAllListings(data);
      setListings(data);
    }).catch(() => {
      if (mounted) { setAllListings([]); setListings([]); }
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  // 所有不重复地区（从全量缓存中提取，不随筛选变化）
  const allDistricts = useMemo(() => {
    const set = new Set();
    allListings.forEach((item) => {
      const d = String(item.district || '').trim();
      if (d) set.add(d);
    });
    return Array.from(set).sort();
  }, [allListings]);

  // 服务端过滤：组装查询参数
  async function fetchWithFilters(f, kw) {
    const params = new URLSearchParams();
    const kTrim = (kw ?? filters.keyword ?? '').trim();
    if (kTrim) params.set('keyword', kTrim);
    if (f.district) params.set('district', f.district);
    if (f.minRent > 0) params.set('minRent', f.minRent);
    if (f.maxRent > 0) params.set('maxRent', f.maxRent);
    if (f.bedrooms > 0) params.set('bedrooms', f.bedrooms);
    const qs = params.toString();
    const res = await apiGet(`/listings${qs ? `?${qs}` : ''}`);
    return res?.data || [];
  }

  // AI 解析 + 服务端过滤
  async function handleAiSearch(e) {
    e?.preventDefault();
    const q = aiQuery.trim();
    if (!q) return;
    setAiParsing(true);
    try {
      const res = await apiPost('/listings/parse-search', { query: q });
      const parsed = res?.data || {};
      const engine = res?.engine || null;
      const chips = {};
      if (parsed.district) chips.district = parsed.district;
      if (parsed.minRent > 0) chips.minRent = parsed.minRent;
      if (parsed.maxRent > 0) chips.maxRent = parsed.maxRent;
      if (parsed.bedrooms > 0) chips.bedrooms = parsed.bedrooms;
      const nextFilters = {
        keyword: parsed.keyword || '',
        district: parsed.district || '',
        minRent: parsed.minRent || 0,
        maxRent: parsed.maxRent || 0,
        bedrooms: parsed.bedrooms || 0,
      };
      if (parsed.sortBy) chips.sortBy = parsed.sortBy;
      setActiveChips(chips);
      setFilters(nextFilters);
      setKeyword(parsed.keyword || '');
      setAiEngine(engine);
      setSortBy(parsed.sortBy || '');
      // 用服务端过滤刷新结果
      setLoading(true);
      const data = await fetchWithFilters(nextFilters, parsed.keyword);
      setListings(data);
    } catch {
      // ignore
    } finally {
      setAiParsing(false);
      setLoading(false);
    }
  }

  function removeChip(key) {
    const next = { ...activeChips };
    delete next[key];
    setActiveChips(next);
    if (key === 'sortBy') { setSortBy(''); return; }
    const nextFilters = { ...filters, [key]: key === 'district' ? '' : 0 };
    setFilters(nextFilters);
    fetchWithFilters(nextFilters, keyword).then((data) => setListings(data)).catch(() => {});
  }

  function clearAll() {
    setActiveChips({});
    const reset = { keyword: '', district: '', minRent: 0, maxRent: 0, bedrooms: 0 };
    setFilters(reset);
    setKeyword('');
    setAiQuery('');
    setAiEngine(null);
    setSortBy('');
    setListings(allListings);
  }

  const hasActiveFilters = Object.keys(activeChips).length > 0
    || filters.district || filters.minRent > 0 || filters.maxRent > 0 || filters.bedrooms > 0;

  const filteredListings = useMemo(() => {
    const kw = (filters.keyword || keyword).trim().toLowerCase();
    let result = listings.filter((item) => {
      if (kw) {
        const hit = ['title', 'address', 'description'].some((f) =>
          String(item[f] || '').toLowerCase().includes(kw)
        );
        if (!hit) return false;
      }
      if (filters.district) {
        const inD = String(item.district || '').includes(filters.district);
        const inA = String(item.address || '').includes(filters.district);
        if (!inD && !inA) return false;
      }
      const rent = parseFloat(item.rent_amount) || 0;
      if (filters.minRent > 0 && rent < filters.minRent) return false;
      if (filters.maxRent > 0 && rent > filters.maxRent) return false;
      if (filters.bedrooms > 0) {
        const b = parseInt(item.bedrooms, 10) || 0;
        if (filters.bedrooms === 4 ? b < 4 : b !== filters.bedrooms) return false;
      }
      return true;
    });
    if (sortBy) {
      result = [...result].sort((a, b) => {
        if (sortBy === 'rent_asc')  return (parseFloat(a.rent_amount) || 0) - (parseFloat(b.rent_amount) || 0);
        if (sortBy === 'rent_desc') return (parseFloat(b.rent_amount) || 0) - (parseFloat(a.rent_amount) || 0);
        if (sortBy === 'area_desc') return (parseFloat(b.area) || 0) - (parseFloat(a.area) || 0);
        if (sortBy === 'area_asc')  return (parseFloat(a.area) || 0) - (parseFloat(b.area) || 0);
        if (sortBy === 'newest')    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        return 0;
      });
    }
    return result;
  }, [listings, filters, keyword, sortBy]);

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-100">
          房源列表
          {!loading && (
            <span className="ml-2 text-sm font-normal text-gray-500">共 {filteredListings.length} 套</span>
          )}
        </h1>
      </div>

      {/* ── AI 智能搜索 ── */}
      <div className="card mb-3 p-4" style={{ background: 'rgba(164,120,100,0.06)', borderColor: 'rgba(164,120,100,0.2)' }}>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-primary-500/70">
          <SparklesIcon className="h-3.5 w-3.5" />
          智能搜索
        </p>
        <form onSubmit={handleAiSearch} className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-primary-800/40 bg-black/30 px-3 py-2">
            <SparklesIcon className="h-4 w-4 shrink-0 text-primary-500/50" />
            <input
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
              placeholder={'例如"西城区月租0.3以内一室一厅"'}
            />
          </div>
          <button
            type="submit"
            disabled={aiParsing || !aiQuery.trim()}
            className="btn-primary flex items-center gap-1.5 px-4 text-sm disabled:opacity-40"
          >
            {aiParsing
              ? <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              : <SparklesIcon className="h-3.5 w-3.5" />}
            解析
          </button>
        </form>

        {Object.keys(activeChips).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">解析结果：</span>
            {aiEngine === 'deepseek' && (
              <span className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                <BrainCircuitIcon className="h-2.5 w-2.5" />
                DeepSeek AI
              </span>
            )}
            {aiEngine === 'regex' && (
              <span className="flex items-center gap-1 rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-400">
                正则解析
              </span>
            )}
            {activeChips.district && (
              <span className="badge-yellow flex items-center gap-1">
                地区：{activeChips.district}
                <button type="button" onClick={() => removeChip('district')}><XIcon className="h-3 w-3" /></button>
              </span>
            )}
            {activeChips.maxRent > 0 && (
              <span className="badge-green flex items-center gap-1">
                ≤ {activeChips.maxRent} ETH
                <button type="button" onClick={() => removeChip('maxRent')}><XIcon className="h-3 w-3" /></button>
              </span>
            )}
            {activeChips.minRent > 0 && (
              <span className="badge-green flex items-center gap-1">
                ≥ {activeChips.minRent} ETH
                <button type="button" onClick={() => removeChip('minRent')}><XIcon className="h-3 w-3" /></button>
              </span>
            )}
            {activeChips.bedrooms > 0 && (
              <span className="badge-blue flex items-center gap-1">
                {activeChips.bedrooms === 4 ? '4室+' : `${activeChips.bedrooms}室`}
                <button type="button" onClick={() => removeChip('bedrooms')}><XIcon className="h-3 w-3" /></button>
              </span>
            )}
            {activeChips.sortBy && (
              <span className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                ↕ {SORT_LABELS[activeChips.sortBy] || activeChips.sortBy}
                <button type="button" onClick={() => removeChip('sortBy')}><XIcon className="h-3 w-3" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 普通搜索 + 筛选行 ── */}
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-black/30 px-3 py-2">
            <SearchIcon className="h-4 w-4 shrink-0 text-gray-500" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
              placeholder="搜索标题或地址"
            />
          </div>

          <select
            value={filters.district}
            onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))}
            className="rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 outline-none"
          >
            <option value="">全部地区</option>
            {allDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            value={filters.bedrooms}
            onChange={(e) => setFilters((f) => ({ ...f, bedrooms: Number(e.target.value) }))}
            className="rounded-2xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 outline-none"
          >
            {BEDROOM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div className="flex items-center gap-1">
            <input
              type="number" min="0" step="0.01"
              value={filters.minRent || ''}
              onChange={(e) => setFilters((f) => ({ ...f, minRent: parseFloat(e.target.value) || 0 }))}
              className="w-20 rounded-2xl border border-white/15 bg-black/40 px-2 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-500"
              placeholder="最低"
            />
            <span className="text-xs text-gray-500">–</span>
            <input
              type="number" min="0" step="0.01"
              value={filters.maxRent || ''}
              onChange={(e) => setFilters((f) => ({ ...f, maxRent: parseFloat(e.target.value) || 0 }))}
              className="w-20 rounded-2xl border border-white/15 bg-black/40 px-2 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-500"
              placeholder="最高"
            />
            <span className="text-xs text-gray-500">ETH</span>
          </div>

          {hasActiveFilters && (
            <button
              type="button" onClick={clearAll}
              className="flex items-center gap-1 rounded-2xl px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              <XIcon className="h-3.5 w-3.5" />清除
            </button>
          )}
        </div>
      </div>

      {/* ── 卡片列表 ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="card p-8 text-center">
          <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">{listings.length === 0 ? '暂无房源' : '未找到匹配房源'}</p>
          {listings.length === 0 && (
            <Link to="/publish" className="btn-primary mt-4 inline-block">去发布第一套房源</Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredListings.map((item) => {
            const statusMeta = getListingStatusMeta(item.public_status || item.status);
            return (
              <Link
                key={item.id}
                to={`/listing/${item.id}`}
                className="card block p-4 transition-all hover:border-gray-700 hover:-translate-y-0.5"
              >
                <div className="relative mb-3">
                  {getFirstImageUrl(item) ? (
                    <img
                      src={resolveImageUrl(getFirstImageUrl(item))}
                      alt={item.title || 'listing'}
                      className="h-36 w-full rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center rounded-2xl border border-white/5 bg-black/20">
                      <HomeIcon className="h-12 w-12 text-primary-600" />
                    </div>
                  )}
                  <span className={`${statusMeta.badge} absolute bottom-2 left-2`}>
                    <span className={statusMeta.dot} />
                    {statusMeta.label}
                  </span>
                </div>
                <h3 className="line-clamp-1 text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                {item.district && (
                  <p className="mt-1 text-xs text-primary-500/80">{item.district}</p>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); openMap(item.address); }}
                  className="group mt-1 flex items-start text-sm text-gray-400 transition-colors hover:text-primary-400"
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
