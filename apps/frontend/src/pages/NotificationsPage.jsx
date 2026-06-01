import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, CheckCheckIcon, CheckIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../app/providers/AuthContext';
import { apiGet, apiPost } from '../shared/api/api';

function formatCnDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
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

function kindLabel(kind) {
  const map = {
    'contract.applied': '新签约申请',
    'contract.clauses_submitted': '条款申请',
    'contract.clauses_approved': '条款确认',
    'contract.clauses_rejected': '条款退回',
    'contract.tenant_signed': '租客签署',
    'contract.pending_payment': '待支付',
    'contract.payment_confirmed': '支付确认',
    'contract.gas_refund_ready': 'Gas 预付取回',
    'contract.cancelled_by_party': '合同取消',
    'contract.payment_timeout_cancelled': '支付超时取消',
    'contract.sign_timeout_expired': '签约超时关闭',
    'contract.ended_by_time': '合同结束',
    'listing.feedback_submitted': '房源反馈',
    'contract.review_submitted': '租后评价',
  };
  return map[String(kind || '').trim()] || String(kind || '通知');
}

function buildNotificationTargets(item) {
  const entityType = String(item?.entity_type || '').trim();
  const entityId = String(item?.entity_id || '').trim();
  const metadata = item?.metadata_json && typeof item.metadata_json === 'object'
    ? item.metadata_json
    : {};
  const contractId = String(metadata.contractId || '').trim();
  const listingId = String(metadata.listingId || '').trim();
  const targets = [];

  if (entityType === 'contract' && entityId) {
    targets.push({ key: `contract:${entityId}`, label: '查看合同', to: `/contract/${entityId}` });
  } else if (contractId) {
    targets.push({ key: `contract:${contractId}`, label: '查看合同', to: `/contract/${contractId}` });
  }

  if (entityType === 'listing' && entityId) {
    targets.push({ key: `listing:${entityId}`, label: '查看房源', to: `/listing/${entityId}` });
  } else if (listingId) {
    targets.push({ key: `listing:${listingId}`, label: '查看房源', to: `/listing/${listingId}` });
  }

  return targets.filter((target, index, arr) => arr.findIndex((item) => item.key === target.key) === index);
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = useMemo(
    () => items.filter((item) => !String(item.read_at || '').trim()).length,
    [items]
  );

  const emitChanged = () => {
    window.dispatchEvent(new CustomEvent('notifications-changed'));
  };

  const loadItems = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiGet('/notifications?limit=100');
      setItems(Array.isArray(res?.data) ? res.data : []);
    } catch (error) {
      toast.error(error?.response?.data?.error || '加载通知失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [user]);

  const markOneRead = async (id) => {
    if (!id) return;
    setActingId(id);
    try {
      await apiPost(`/notifications/${id}/read`, {});
      setItems((prev) => prev.map((item) => (
        item.id === id
          ? { ...item, read_at: item.read_at || new Date().toISOString() }
          : item
      )));
      emitChanged();
    } catch (error) {
      toast.error(error?.response?.data?.error || '标记已读失败');
    } finally {
      setActingId('');
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiPost('/notifications/read-all', {});
      setItems((prev) => prev.map((item) => (
        String(item.read_at || '').trim() ? item : { ...item, read_at: new Date().toISOString() }
      )));
      emitChanged();
    } catch (error) {
      toast.error(error?.response?.data?.error || '全部已读失败');
    } finally {
      setMarkingAll(false);
    }
  };

  if (!user) {
    return (
      <div className="card p-6 text-sm text-slate-300">
        请先登录后查看通知。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-400/12 text-sky-300">
            <BellIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">通知</h1>
            <p className="text-sm text-slate-400">查看合同、房源与自动状态变化的站内通知。</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300">
            未读 {unreadCount}
          </div>
          <button
            type="button"
            disabled={markingAll || unreadCount === 0}
            onClick={markAllRead}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCheckIcon className="h-4 w-4" />
            全部已读
          </button>
        </div>
      </div>

      <div className="card p-5">
        {loading ? (
          <div className="text-sm text-slate-400">加载中...</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
            暂无通知
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const isUnread = !String(item.read_at || '').trim();
              const targets = buildNotificationTargets(item);
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    isUnread
                      ? 'border-sky-400/25 bg-sky-400/8'
                      : 'border-white/10 bg-white/3'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                          {kindLabel(item.kind)}
                        </span>
                        {isUnread ? (
                          <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-xs text-sky-200">
                            未读
                          </span>
                        ) : (
                          <span className="rounded-full border border-white/10 bg-slate-900/50 px-2.5 py-1 text-xs text-slate-400">
                            已读
                          </span>
                        )}
                      </div>
                      <h2 className="text-base font-semibold text-slate-100">{item.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{item.body}</p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>实体：{item.entity_type} / {item.entity_id}</span>
                        <span>时间：中国时间 {formatCnDateTime(item.created_at)}</span>
                      </div>
                      {targets.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {targets.map((target) => (
                            <button
                              key={target.key}
                              type="button"
                              onClick={() => navigate(target.to)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10"
                            >
                              {target.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {isUnread && (
                        <button
                          type="button"
                          disabled={actingId === item.id}
                          onClick={() => markOneRead(item.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                          标记已读
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
