/**
 * 文件说明：我的房源页
 * - 房东查看自己发布的房源。
 * - 支持房源上下架状态切换。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiGet, apiPut } from '../shared/api/api';
import { HomeIcon, LoaderIcon } from 'lucide-react';

const LISTING_STATUS_MAP = {
  available: { label: '可租', badge: 'badge-green' },
  offline: { label: '已下架', badge: 'badge-gray' },
  locked: { label: '签约锁定中', badge: 'badge-yellow' },
  rented: { label: '已出租', badge: 'badge-blue' },
  closed: { label: '已关闭', badge: 'badge-gray' },
};

// 函数 1: 页面主组件。
export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

        // 函数 2: 加载房东名下房源列表。
    const loadMyListings = async () => {
      try {
        const res = await apiGet('/listings/my');
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

    loadMyListings();
    return () => {
      mounted = false;
    };
  }, []);

    // 函数 3: 更新房源上下架状态。
  const updateStatus = async (id, status) => {
    try {
      await apiPut(`/listings/${id}/status`, { status });
      toast.success(status === 'available' ? '房源已重新上架' : '房源已下架');
      setListings((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '操作失败');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">我的房源</h1>
        <Link to="/publish" className="btn-primary">
          发布新房源
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="card p-8 text-center">
          <HomeIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500">暂无已发布房源</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((item) => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{item.title || '未命名房源'}</h3>
                  <p className="mt-1 text-sm text-gray-500">{item.address || '-'}</p>
                  <p className="mt-2 text-primary-600">{item.rent_amount} ETH/月</p>
                </div>
                <div className="text-right">
                  <span className={(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).badge}>
                    {(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).label}
                  </span>
                  <div className="mt-2">
                    {item.status === 'available' ? (
                      <button className="btn-secondary" onClick={() => updateStatus(item.id, 'offline')}>
                        下架
                      </button>
                    ) : item.status === 'offline' ? (
                      <button className="btn-secondary" onClick={() => updateStatus(item.id, 'available')}>
                        重新上架
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">流程中不可操作</span>
                    )}
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








