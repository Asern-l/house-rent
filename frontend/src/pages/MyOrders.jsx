import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { ShoppingBagIcon, LoaderIcon, TruckIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, MessageCircleIcon } from 'lucide-react';
import { ORDER_STATUS_MAP } from '../utils/contractConfig';

export default function MyOrders() {
  const { contract, account } = useWeb3();
  const [tab, setTab] = useState('buy');
  const [buyOrders, setBuyOrders] = useState([]);
  const [sellOrders, setSellOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    if (contract && account) {
      loadOrders();
    } else {
      setLoading(false);
    }
  }, [contract, account]);

  const loadOrders = async () => {
    try {
      const [buyList, sellList] = await Promise.all([
        contract.getOrdersByBuyer(account),
        contract.getOrdersBySeller(account),
      ]);

      const formatOrders = (orders) => orders.map(o => ({
        id: Number(o.id),
        productId: Number(o.productId),
        buyer: o.buyer,
        seller: o.seller,
        price: ethers.formatEther(o.price),
        status: Number(o.status),
        shippingInfo: o.shippingInfo,
        disputeReason: o.disputeReason,
        createdAt: Number(o.createdAt),
        updatedAt: Number(o.updatedAt),
      }));

      setBuyOrders(formatOrders(buyList));
      setSellOrders(formatOrders(sellList));
    } catch (err) {
      console.error('加载订单失败:', err);
      toast.error('加载订单失败');
    } finally {
      setLoading(false);
    }
  };

  const handleShip = async (orderId, shippingInfo) => {
    if (!shippingInfo) {
      toast.error('请输入物流信息');
      return;
    }
    setActionLoading(orderId);
    try {
      const tx = await contract.shipOrder(orderId, shippingInfo);
      toast.loading('处理中...', { id: `ship-${orderId}` });
      await tx.wait();
      toast.success('已标记发货！', { id: `ship-${orderId}` });
      loadOrders();
    } catch (err) {
      toast.error(err.reason || '操作失败', { id: `ship-${orderId}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirm = async (orderId) => {
    setActionLoading(orderId);
    try {
      const tx = await contract.confirmReceived(orderId);
      toast.loading('处理中...', { id: `confirm-${orderId}` });
      await tx.wait();
      toast.success('确认收货成功！款项已释放给卖家', { id: `confirm-${orderId}` });
      loadOrders();
    } catch (err) {
      toast.error(err.reason || '操作失败', { id: `confirm-${orderId}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (orderId) => {
    setActionLoading(orderId);
    try {
      const tx = await contract.cancelOrder(orderId);
      toast.loading('处理中...', { id: `cancel-${orderId}` });
      await tx.wait();
      toast.success('订单已取消', { id: `cancel-${orderId}` });
      loadOrders();
    } catch (err) {
      toast.error(err.reason || '操作失败', { id: `cancel-${orderId}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDispute = async (orderId, reason) => {
    if (!reason) {
      toast.error('请输入纠纷原因');
      return;
    }
    setActionLoading(orderId);
    try {
      const tx = await contract.disputeOrder(orderId, reason);
      toast.loading('处理中...', { id: `dispute-${orderId}` });
      await tx.wait();
      toast.success('已发起纠纷，等待管理员处理', { id: `dispute-${orderId}` });
      loadOrders();
    } catch (err) {
      toast.error(err.reason || '操作失败', { id: `dispute-${orderId}` });
    } finally {
      setActionLoading(null);
    }
  };

  const renderOrderCard = (order, isBuy) => {
    const statusInfo = ORDER_STATUS_MAP[order.status];
    return (
      <div key={order.id} className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700">
              {isBuy ? '向' : '来自'} {order.seller.slice(0, 6)}...{order.seller.slice(-4)}
            </span>
          </div>
          <span className={statusInfo.color}>{statusInfo.label}</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">订单 #{order.id}</p>
            <p className="text-sm text-gray-500">商品 #{order.productId}</p>
          </div>
          <p className="text-lg font-bold text-primary-600">{order.price} SepoliaETH</p>
        </div>

        {order.shippingInfo && (
          <div className="bg-gray-50 rounded p-2 text-sm text-gray-600">
            <span className="font-medium">物流信息：</span>{order.shippingInfo}
          </div>
        )}

        {order.disputeReason && (
          <div className="bg-red-50 rounded p-2 text-sm text-red-600">
            <span className="font-medium">纠纷原因：</span>{order.disputeReason}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {/* 买家操作 */}
          {isBuy && order.status === 1 && (
            <>
              <button
                onClick={() => {
                  const info = prompt('请输入物流信息（快递公司+单号）：');
                  if (info) handleShip(order.id, info);
                }}
                disabled={actionLoading === order.id}
                className="btn-primary text-sm flex items-center space-x-1"
              >
                <TruckIcon className="w-4 h-4" />
                <span>发货</span>
              </button>
              <button
                onClick={() => handleCancel(order.id)}
                disabled={actionLoading === order.id}
                className="btn-secondary text-sm"
              >
                取消订单
              </button>
            </>
          )}

          {/* 卖家操作：发货 */}
          {!isBuy && order.status === 1 && (
            <button
              onClick={() => {
                const info = prompt('请输入物流信息（快递公司+单号）：');
                if (info) handleShip(order.id, info);
              }}
              disabled={actionLoading === order.id}
              className="btn-primary text-sm flex items-center space-x-1"
            >
              <TruckIcon className="w-4 h-4" />
              <span>标记发货</span>
            </button>
          )}

          {/* 买家操作：确认收货 */}
          {isBuy && order.status === 2 && (
            <button
              onClick={() => {
                if (window.confirm('确认已收到商品？资金将释放给卖家。')) {
                  handleConfirm(order.id);
                }
              }}
              disabled={actionLoading === order.id}
              className="btn-primary text-sm flex items-center space-x-1"
            >
              <CheckCircleIcon className="w-4 h-4" />
              <span>确认收货</span>
            </button>
          )}

          {/* 纠纷按钮（已支付或已发货状态） */}
          {(order.status === 1 || order.status === 2) && (
            <button
              onClick={() => {
                const reason = prompt('请输入纠纷原因：');
                if (reason) handleDispute(order.id, reason);
              }}
              disabled={actionLoading === order.id}
              className="btn-danger text-sm flex items-center space-x-1"
            >
              <AlertTriangleIcon className="w-4 h-4" />
              <span>发起纠纷</span>
            </button>
          )}

          {actionLoading === order.id && (
            <LoaderIcon className="w-4 h-4 animate-spin text-primary-600" />
          )}
        </div>
      </div>
    );
  };

  const currentOrders = tab === 'buy' ? buyOrders : sellOrders;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">我的订单</h1>

      {!account ? (
        <div className="card p-12 text-center">
          <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600">请先连接钱包</h3>
        </div>
      ) : (
        <>
          {/* Tab 切换 */}
          <div className="flex space-x-1 bg-gray-100 rounded-xl p-1 mb-6">
            <button
              onClick={() => setTab('buy')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'buy' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              购买记录 ({buyOrders.length})
            </button>
            <button
              onClick={() => setTab('sell')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'sell' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              出售记录 ({sellOrders.length})
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : currentOrders.length === 0 ? (
            <div className="card p-12 text-center">
              <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-600">暂无订单</h3>
              <p className="text-sm text-gray-400">
                {tab === 'buy' ? '去市场逛逛，发现好物！' : '发布商品，等待买家下单'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {currentOrders.map(order => renderOrderCard(order, tab === 'buy'))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
