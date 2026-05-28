import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileTextIcon, LoaderIcon, SearchIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet } from '../shared/api/api';

const STATUS_MAP = {
  pending: { label: '待签署', color: 'badge-yellow' },
  tenant_signed: { label: '租客已签', color: 'badge-blue' },
  pending_payment: { label: '待支付', color: 'badge-yellow' },
  active: { label: '已生效', color: 'badge-green' },
  ended: { label: '已结束', color: 'badge-gray' },
  cancelled: { label: '已取消', color: 'badge-red' },
  expired: { label: '已过期', color: 'badge-gray' },
};

function parseContent(contract) {
  try {
    if (typeof contract?.content_json === 'string') return JSON.parse(contract.content_json || '{}');
    return contract?.content_json && typeof contract.content_json === 'object' ? contract.content_json : {};
  } catch {
    return {};
  }
}

function resolveContractStartAtMs(contract) {
  const content = parseContent(contract);
  const exactStartAtMs = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exactStartAtMs) && exactStartAtMs > 0) return exactStartAtMs;
  const startDate = String(content?.terms?.startDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 0;
  const d = new Date(`${startDate}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveStatusMeta(contract) {
  const status = String(contract?.status || '').trim();
  if (status === 'active') {
    const startAtMs = resolveContractStartAtMs(contract);
    if (String(contract?.parent_contract_id || '').trim() && startAtMs > Date.now()) {
      return { label: '已支付待接续', color: 'badge-blue' };
    }
  }
  return STATUS_MAP[status] || { label: status || '未知状态', color: 'badge-gray' };
}

function formatCnDateTime(value) {
  if (!value) return '-';
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(`${text}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export default function MyContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadContracts = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiGet('/contracts');
        if (mounted) setContracts(res?.data || []);
      } catch {
        if (mounted) setContracts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadContracts();
    return () => { mounted = false; };
  }, [user]);

  if (!user) {
    return (
      <div className="card p-8 text-center">
        <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
        <p className="text-gray-400">请先登录后查看合同</p>
        <Link to="/login" className="btn-primary mt-3 inline-block">登录</Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="mb-4 text-2xl font-bold text-gray-100">我的合同</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="card p-8 text-center">
          <FileTextIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="mb-3 text-gray-400">暂无合同</p>
          {user.role === 'tenant' ? (
            <Link to="/listings" className="btn-primary inline-flex items-center space-x-2">
              <SearchIcon className="h-4 w-4" />
              <span>浏览房源</span>
            </Link>
          ) : (
            <p className="text-sm text-gray-500">等待租客发起签约申请</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const status = resolveStatusMeta(contract);
            const isRenewal = !!String(contract.parent_contract_id || '').trim();
            return (
              <Link
                key={contract.id}
                to={`/contract/${contract.id}`}
                className="card block p-4 transition-all hover:-translate-y-0.5 hover:border-gray-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-100">{contract.listing_title || '房源合同'}</h3>
                      {isRenewal && <span className="badge-blue">续约合同</span>}
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{contract.listing_address || '-'}</p>
                    <p className="mt-1 text-xs text-gray-500">合同ID：{contract.id}</p>
                    {isRenewal && <p className="mt-1 text-xs text-gray-500">父合同ID：{contract.parent_contract_id}</p>}
                  </div>
                  <div className="text-right">
                    <span className={status.color}>{status.label}</span>
                    <p className="mt-1 text-xs text-gray-500">{formatCnDateTime(contract.created_at)}</p>
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
