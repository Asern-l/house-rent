import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertCircleIcon, ArrowLeftIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, HomeIcon, LoaderIcon, MapPinIcon } from 'lucide-react';

function openMap(address) {
  const q = encodeURIComponent(address);
  // maps:// 在 macOS/iOS 直接打开 Apple Maps；其他平台降级到 Google Maps
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const url = isMac ? `maps://?q=${q}&address=${q}` : `https://maps.google.com/?q=${q}`;
  window.open(url, '_blank');
}
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';

const FEEDBACK_TYPE_OPTIONS = [
  { value: 'mismatch', label: '与描述不符' },
  { value: 'photos', label: '图片过旧' },
  { value: 'noise', label: '位置噪音大' },
  { value: 'communication', label: '沟通体验一般' },
  { value: 'other', label: '其他反馈' },
];

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

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function addMonthsLocalDate(value, months) {
  const date = parseLocalDate(value);
  if (!date) return '';
  date.setMonth(date.getMonth() + Number(months));
  return formatLocalDate(date);
}

function calculateLeaseMonths(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  for (let months = 1; months <= 12; months += 1) {
    if (endDate <= addMonthsLocalDate(startDate, months)) return months;
  }
  return 0;
}

function buildCalendarDays(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay);
  start.setDate(start.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function BookingDateRangePicker({ startDate, endDate, minLeaseMonths, onChange }) {
  const [open, setOpen] = useState(false);
  const [leftMonth, setLeftMonth] = useState(() => {
    const initial = parseLocalDate(startDate) || new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [rightMonth, setRightMonth] = useState(() => {
    const initial = parseLocalDate(endDate) || parseLocalDate(startDate) || new Date();
    return new Date(initial.getFullYear(), initial.getMonth() + (endDate ? 0 : 1), 1);
  });
  const pickerRef = useRef(null);
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const minEndDate = startDate ? addMonthsLocalDate(startDate, minLeaseMonths) : '';
  const maxEndDate = startDate ? addMonthsLocalDate(startDate, 12) : '';
  const leaseMonths = calculateLeaseMonths(startDate, endDate);

  useEffect(() => {
    const closePicker = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closePicker);
    return () => document.removeEventListener('mousedown', closePicker);
  }, []);

  const selectDate = (dateValue) => {
    if (!startDate || endDate || dateValue <= startDate) {
      onChange({ startDate: dateValue, endDate: '' });
      return;
    }
    if (dateValue < minEndDate || dateValue > maxEndDate) return;
    onChange({ startDate, endDate: dateValue });
    setOpen(false);
  };

  const renderMonth = (monthDate, setMonth) => (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-3">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => setMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))} className="rounded-full p-1 text-gray-400 transition hover:bg-slate-800 hover:text-primary-200" aria-label="上一个月">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <p className="text-center text-sm font-semibold text-gray-100">
          {monthDate.getFullYear()} 年 {monthDate.getMonth() + 1} 月
        </p>
        <button type="button" onClick={() => setMonth(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))} className="rounded-full p-1 text-gray-400 transition hover:bg-slate-800 hover:text-primary-200" aria-label="下一个月">
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-500">
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {buildCalendarDays(monthDate).map((date) => {
          const dateValue = formatLocalDate(date);
          const outsideMonth = date.getMonth() !== monthDate.getMonth();
          const isPast = date < todayDate;
          const invalidEnd = startDate && !endDate && dateValue > startDate && (dateValue < minEndDate || dateValue > maxEndDate);
          const disabled = outsideMonth || isPast || invalidEnd;
          const selectedStart = dateValue === startDate;
          const selectedEnd = dateValue === endDate;
          const inRange = startDate && endDate && dateValue > startDate && dateValue < endDate;
          return (
            <button
              key={dateValue}
              type="button"
              disabled={disabled}
              onClick={() => selectDate(dateValue)}
              className={`h-8 rounded-lg text-xs transition ${
                selectedStart || selectedEnd
                  ? 'bg-primary-500 font-semibold text-white shadow-md shadow-primary-950/40'
                  : inRange
                    ? 'bg-primary-900/55 text-primary-100'
                    : disabled
                      ? 'cursor-not-allowed text-gray-700'
                      : 'text-gray-300 hover:bg-slate-800 hover:text-primary-200'
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-600/50 bg-slate-950/55 px-4 py-2.5 text-left text-gray-100 shadow-inner shadow-black/20 transition hover:border-primary-400/70 hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span>
          {startDate
            ? `${startDate.replaceAll('-', '/')} - ${endDate ? endDate.replaceAll('-', '/') : '请选择退租日'}`
            : '请选择租赁日期区间'}
        </span>
        <CalendarDaysIcon className="h-5 w-5 text-primary-300" />
      </button>

      {open ? (
        <div role="dialog" aria-label="选择租赁日期区间" className="absolute bottom-full left-0 z-30 mb-2 w-full min-w-[38rem] rounded-2xl border border-slate-600/45 bg-slate-950/95 p-4 shadow-2xl shadow-black/45 backdrop-blur-xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-100">选择租赁日期区间</p>
              <p className="mt-1 text-xs text-gray-500">
                先选择入住日，再选择退租日。最少 {minLeaseMonths} 个月，最长 12 个月。
              </p>
            </div>
            {leaseMonths ? <span className="badge-yellow">{leaseMonths} 个月</span> : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {renderMonth(leftMonth, setLeftMonth)}
            {renderMonth(rightMonth, setRightMonth)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StackedImageCarousel({ imageUrls, alt, className = '' }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const imageKey = imageUrls.join('|');

  useEffect(() => {
    setActiveIndex(0);
  }, [imageKey]);

  useEffect(() => {
    if (imageUrls.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % imageUrls.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [imageKey, imageUrls.length]);

  return (
    <button
      type="button"
      onClick={() => setActiveIndex((current) => (current + 1) % imageUrls.length)}
      className={`relative block w-full overflow-visible bg-transparent ${className}`}
      aria-label={imageUrls.length > 1 ? '切换到下一张图片' : alt}
    >
      {imageUrls.map((url, index) => {
        const depth = (index - activeIndex + imageUrls.length) % imageUrls.length;
        const positions = [
          { x: -24, y: 0, scale: 1, rotate: 0 },
          { x: -2, y: 13, scale: 0.94, rotate: 3.5 },
          { x: -40, y: 25, scale: 0.88, rotate: -4.5 },
        ];
        const position = positions[depth] || { x: -110, y: -14, scale: 0.76, rotate: -11 };
        return (
          <img
            key={`${url}_${index}`}
            src={resolveImageUrl(url)}
            alt={`${alt}_${index + 1}`}
            className="absolute rounded-xl object-cover transition-all duration-1000"
            style={{
              inset: '12px 38px 24px 12px',
              boxShadow: depth === 0
                ? '0 22px 36px rgba(2, 6, 23, 0.42)'
                : '0 14px 26px rgba(2, 6, 23, 0.32)',
              filter: depth === 0 ? 'brightness(1)' : 'brightness(0.72)',
              opacity: depth < 3 ? 1 - (depth * 0.18) : 0,
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${position.scale}) rotate(${position.rotate}deg)`,
              transformOrigin: 'center bottom',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              zIndex: imageUrls.length - depth,
            }}
          />
        );
      })}
      {imageUrls.length > 1 ? (
        <span className="absolute bottom-8 right-16 z-10 rounded-full bg-black/55 px-2 py-1 text-[10px] text-gray-200">
          {activeIndex + 1} / {imageUrls.length}
        </span>
      ) : null}
    </button>
  );
}

function getListingStatusMeta(listing) {
  const status = String(listing?.public_status || listing?.status || '').trim().toLowerCase();
  if (status === 'signing') return { key: 'signing', label: '签署中', className: 'badge-yellow' };
  if (status === 'rented') return { key: 'rented', label: '已租出', className: 'badge-gray' };
  if (status === 'offline') return { key: 'offline', label: '已下架', className: 'badge-gray' };
  if (status === 'closed') return { key: 'closed', label: '已关闭', className: 'badge-red' };
  return { key: 'available', label: '可租', className: 'badge-green' };
}

function renderStars(rating) {
  return '★'.repeat(Math.max(0, Number(rating || 0))) + '☆'.repeat(Math.max(0, 5 - Number(rating || 0)));
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
  ].includes(String(action || '').trim().toLowerCase());
}

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          const initialStartDate = `${yyyy}-${mm}-${dd}`;
          setStartDate(initialStartDate);
          setEndDate(addMonthsLocalDate(initialStartDate, minLease));
        }
      } catch (error) {
        toast.error(error?.response?.data?.error || '房源加载失败，请稍后重试');
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
    const leaseMonths = calculateLeaseMonths(startDate, endDate);
    if (!leaseMonths) { toast.error('请选择完整的租赁日期区间'); return; }
    setApplying(true);
    try {
      const res = await apiPost('/contracts', { listingId: id, startDate, endDate });
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
  const selectedLeaseMonths = calculateLeaseMonths(startDate, endDate);
  const selectedHistory = history.find((item) => item.id === selectedHistoryId) || null;
  const selectedSnapshot = normalizeHistorySnapshot(selectedHistory);
  const selectedBinding = normalizeHistoryBinding(selectedHistory);
  const selectedImages = selectedSnapshot?.imageUrls || [];
  const selectedHistoryIsOnchain = isOnchainHistoryAction(selectedHistory?.action);
  const feedbacks = Array.isArray(listing.feedbacks) ? listing.feedbacks : [];
  const tenantReviews = Array.isArray(listing.tenant_reviews) ? listing.tenant_reviews : [];
  const reviewSummary = listing.review_summary || {};

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center space-x-1 text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <span>返回</span>
      </button>

      <div className="space-y-10">
        <div className="grid grid-cols-1 items-stretch gap-6 pb-16 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:pb-20">
        <div className="flex h-full min-h-72">
          {imageUrls.length > 0 ? (
            <div className="min-h-0 w-full">
              <StackedImageCarousel imageUrls={imageUrls} alt={listing.title || 'listing'} className="h-full min-h-64" />
            </div>
          ) : (
            <div className="flex min-h-64 w-full items-center justify-center bg-gradient-to-br from-primary-900/30 to-blue-900/30">
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

          <button
            type="button"
            onClick={() => openMap(listing.address)}
            className="flex items-start space-x-2 text-gray-400 transition-colors hover:text-primary-400 group"
            title="在地图中查看"
          >
            <MapPinIcon className="mt-0.5 h-4 w-4 flex-shrink-0 transition-colors group-hover:text-primary-400" />
            <span className="text-left underline-offset-2 group-hover:underline">
              {listing.address}{listing.district ? `（${listing.district}）` : ''}
            </span>
          </button>

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
        </div>
        </div>

        <div className="space-y-4">
          <p className="leading-relaxed text-gray-300">{listing.description || '暂无描述'}</p>

          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <p className="mb-2 text-sm font-medium text-gray-200">历史版本</p>
            {history.length === 0 ? (
              <p className="text-xs text-gray-500">暂无历史记录</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="min-w-0 max-h-72 space-y-2 overflow-y-auto pr-1">
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

                <div className="min-w-0 rounded border border-gray-700 bg-gray-900/40 p-3 text-xs text-gray-300">
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
                              <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
                                {selectedImages.map((url, idx) => (
                                  <img
                                    key={`${url}_${idx}`}
                                    src={resolveImageUrl(url)}
                                    alt={`version_${idx + 1}`}
                                    className="h-28 min-w-full snap-center rounded object-cover"
                                  />
                                ))}
                              </div>
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
                          {selectedHistoryIsOnchain ? (
                            <div className="mt-2 rounded border border-gray-700 bg-gray-900/70 p-2">
                              <p className="font-medium text-gray-200">防篡改绑定</p>
                              <p className={`mt-1 ${selectedHistory?.bindingVerified ? 'text-emerald-400' : 'text-yellow-300'}`}>
                                绑定校验：{selectedHistory?.bindingVerified ? '通过' : '未通过/缺失'}
                              </p>
                              <p className="break-all">公开快照哈希：{selectedHistory?.expectedSnapshotHash || '-'}</p>
                              <p className="break-all">绑定快照哈希：{selectedBinding?.snapshotHash || '-'}</p>
                              <p>链上版本号：{selectedBinding?.chainVersion || '-'}</p>
                              <p>链上操作序号：{selectedBinding?.chainNonce || '-'}</p>
                              <p>事件：{selectedBinding?.eventName || '-'}</p>
                              <p>区块号：{selectedBinding?.blockNumber || '-'}</p>
                              <p className="break-all">交易哈希：{selectedBinding?.txHash || '-'}</p>
                            </div>
                          ) : (
                            <div className="mt-2 rounded border border-blue-800/50 bg-blue-900/20 p-2 text-blue-200">
                              <p className="font-medium">链下模板更新</p>
                              <p className="mt-1">
                                该操作只更新合同草稿默认附加条款，不写入房源链上状态，因此不参与链上防篡改绑定校验。
                              </p>
                              <p className="mt-2 break-all text-blue-100">公开快照哈希：{selectedHistory?.expectedSnapshotHash || '-'}</p>
                              {selectedHistory?.note ? (
                                <p className="mt-1 text-blue-100">说明：{selectedHistory.note}</p>
                              ) : null}
                            </div>
                          )}
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

          <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-gray-100">真实租客评价</p>
                <p className="mt-1 text-xs text-gray-500">仅展示最近 3 条真实租客评价。完整评论区与平均分请进入专页查看。</p>
              </div>
              <div className="text-right">
                {reviewSummary.average_visible ? (
                  <>
                    <p className="text-2xl font-bold text-primary-300">{Number(reviewSummary.weighted_average || 0).toFixed(1)}</p>
                    <p className="text-xs text-gray-500">{reviewSummary.review_count || 0} 条真实租客评价</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-300">样本不足</p>
                    <p className="text-xs text-gray-500">至少 {reviewSummary.sample_threshold || 3} 条后公开平均分</p>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {tenantReviews.length === 0 ? (
                <p className="text-sm text-gray-500">暂无真实租客评价</p>
              ) : tenantReviews.slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-800 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-primary-300">{renderStars(item.rating)} <span className="ml-2 text-gray-400">权重 {item.weight}</span></p>
                      <p className="mt-1 text-xs text-gray-500">地址：{item.tenant_wallet ? `${item.tenant_wallet.slice(0, 6)}...${item.tenant_wallet.slice(-4)}` : '未知地址'}</p>
                    </div>
                    <p className="text-xs text-gray-500">{item.created_at || '-'}</p>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-200">{item.comment_text}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Link to={`/listing/${id}/reviews`} className="text-sm font-medium text-primary-300 hover:text-primary-200">查看全部评价</Link>
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
            <p className="text-base font-semibold text-gray-100">房源反馈</p>
            <p className="mt-1 text-xs text-gray-500">公开展示最近 3 条看房或意向阶段反馈，不计入正式星级。</p>

            <div className="mt-4 space-y-3">
              {feedbacks.length === 0 ? (
                <p className="text-sm text-gray-500">暂无房源反馈</p>
              ) : feedbacks.slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-800 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="badge-gray">{FEEDBACK_TYPE_OPTIONS.find((opt) => opt.value === item.feedback_type)?.label || item.feedback_type}</span>
                      <span className="text-xs text-gray-500">地址：{item.author_wallet ? `${item.author_wallet.slice(0, 6)}...${item.author_wallet.slice(-4)}` : '未知地址'}</span>
                    </div>
                    <p className="text-xs text-gray-500">{item.created_at || '-'}</p>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-200">{item.comment_text}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Link to={`/listing/${id}/reviews`} className="text-sm font-medium text-primary-300 hover:text-primary-200">查看全部评价与提交反馈</Link>
            </div>
          </div>

          {isAvailable && user?.role === 'tenant' && (
            <div className="space-y-3 rounded-lg border border-gray-700 p-4">
              <p className="text-sm font-medium text-gray-200">签约前设置</p>
              <p className="text-xs text-gray-400">
                当前租客钱包（提交申请后会展示给房东）：{user?.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : '未连接'}
              </p>
              <div>
                <label className="mb-1 block text-sm text-gray-400">租赁日期区间</label>
                <BookingDateRangePicker
                  startDate={startDate}
                  endDate={endDate}
                  minLeaseMonths={minLeaseMonths}
                  onChange={({ startDate: nextStartDate, endDate: nextEndDate }) => {
                    setStartDate(nextStartDate);
                    setEndDate(nextEndDate);
                  }}
                />
              </div>
              <p className="text-xs text-gray-500">
                该房源最少租期：{minLeaseMonths}个月，最长12个月。
                {selectedLeaseMonths ? ` 当前区间按 ${selectedLeaseMonths} 个月计费。` : ' 请依次选择入住日和退租日。'}
              </p>
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
