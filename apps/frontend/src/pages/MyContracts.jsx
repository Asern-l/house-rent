/**
 * 文件说明：我的合同列表页
 * - 展示当前用户关联的合同列表。
 * - 租客无合同时引导去看房源，房东无合同时提示等待申请。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet } from '../shared/api/api';
import { FileTextIcon, LoaderIcon, SearchIcon } from 'lucide-react';

const STATUS_MAP = {
  pending: { label: '待签署', color: 'badge-yellow' },
  tenant_signed: { label: '租客已签', color: 'badge-blue' },
  pending_payment: { label: '待支付', color: 'badge-yellow' },
  landlord_signed: { label: '房东已签', color: 'badge-blue' },
  active: { label: '已生效', color: 'badge-green' },
  ended: { label: '已到期', color: 'badge-gray' },
  cancelled: { label: '已取消', color: 'badge-red' },
  expired: { label: '已过期', color: 'badge-gray' },
};

// 函数 1: 页面主组件。
export default function MyContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

        // 函数 2: 加载当前用户合同列表。
    const loadContracts = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const res = await apiGet('/contracts');
        if (mounted) {
          setContracts(res?.data || []);
        }
      } catch (error) {
        if (mounted) {
          setContracts([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadContracts();
    return () => {
      mounted = false;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="card p-8 text-center">
        <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <p className="text-gray-500">请先登录后查看合同</p>
        <Link to="/login" className="btn-primary mt-3 inline-block">
          登录
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="mb-4 text-2xl font-bold text-gray-800">我的合同</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="card p-8 text-center">
          <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="mb-3 text-gray-500">暂无合同</p>
          {user.role === 'tenant' ? (
            <Link to="/listings" className="btn-primary inline-flex items-center space-x-2">
              <SearchIcon className="h-4 w-4" />
              <span>浏览房源</span>
            </Link>
          ) : (
            <p className="text-sm text-gray-400">等待租客发起签约申请</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const status = STATUS_MAP[contract.status] || {
              label: contract.status || '未知状态',
              color: 'badge-gray',
            };

            return (
              <Link
                key={contract.id}
                to={`/contract/${contract.id}`}
                className="card block p-4 transition-all hover:translate-y-[-2px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{contract.listing_title || '房源'}</h3>
                    <p className="mt-1 text-sm text-gray-500">{contract.listing_address || '-'}</p>
                    <p className="mt-1 text-xs text-gray-400">合同ID: {contract.id}</p>
                  </div>
                  <div className="text-right">
                    <span className={status.color}>{status.label}</span>
                    <p className="mt-1 text-xs text-gray-400">
                      {contract.created_at ? String(contract.created_at).slice(0, 10) : '-'}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}







