import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { apiGet, apiPost } from '../shared/api/api';
import { ethers } from 'ethers';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';
import { HomeIcon, LoaderIcon } from 'lucide-react';

const LISTING_STATUS_MAP = {
  available: { label: '可租', badge: 'badge-green' },
  offline: { label: '已下架', badge: 'badge-gray' },
  locked: { label: '签约锁定中', badge: 'badge-yellow' },
  rented: { label: '已出租', badge: 'badge-blue' },
  closed: { label: '已关闭', badge: 'badge-gray' },
};

const CONTRACT_ADDR_MAP = {
  sepolia: import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '',
  local: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
};

const NETWORK_OPTIONS = {
  sepolia: { chainId: 11155111, chainIdHex: '0xaa36a7' },
  local: { chainId: 31337, chainIdHex: '0x7a69' },
};

function getFirstImageUrl(item) {
  try {
    const raw = item?.image_urls;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0] || '') : '';
  } catch {
    return '';
  }
}

function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

function getPreferredNetwork() {
  const key = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  return NETWORK_OPTIONS[key] ? key : 'sepolia';
}

async function ensureWalletNetwork(provider, networkKey) {
  const target = NETWORK_OPTIONS[networkKey];
  const net = await provider.getNetwork();
  if (Number(net.chainId) === target.chainId) return;
  await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] });
}

export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadMyListings = async () => {
      try {
        const res = await apiGet('/listings/my');
        if (mounted) setListings(res?.data || []);
      } catch {
        if (mounted) setListings([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadMyListings();
    return () => { mounted = false; };
  }, []);

  const getContractAndState = async (listingId) => {
    const networkKey = getPreferredNetwork();
    const contractAddress = String(CONTRACT_ADDR_MAP[networkKey] || '').trim();
    if (!ethers.isAddress(contractAddress)) {
      throw new Error(`未配置合约地址: VITE_CONTRACT_ADDRESS_${networkKey.toUpperCase()}`);
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await ensureWalletNetwork(provider, networkKey);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(contractAddress, RentalChainABI, signer);
    const chainState = await contract.getListing(listingId);
    return { contract, chainState };
  };

  const updateStatusOnchain = async (id, status) => {
    if (!window.ethereum) {
      toast.error('请先安装 MetaMask 钱包');
      return;
    }
    try {
      const prepare = await apiPost(`/listings/${id}/status/prepare`, { status });
      const prepared = prepare?.data;
      const { contract, chainState } = await getContractAndState(id);
      const expectedVersion = chainState[7];
      const expectedNonce = chainState[8];
      const tx = await contract.setListingStatus(id, Number(prepared.toStatusEnum), expectedVersion, expectedNonce);
      await tx.wait();
      await apiPost(`/listings/${id}/status/commit`, { status, txHash: tx.hash });
      setListings((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
      toast.success(status === 'closed' ? '房源已销毁' : '状态更新成功');
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || '状态更新失败');
    }
  };

  const updateTermsOnchain = async (item) => {
    if (!window.ethereum) {
      toast.error('请先安装 MetaMask 钱包');
      return;
    }
    const rentAmount = prompt('请输入新的月租金（ETH）', String(item.rent_amount || ''));
    if (!rentAmount) return;
    const minLeaseMonths = prompt('请输入新的最少租期（月）', String(item.min_lease_months || 1));
    if (!minLeaseMonths) return;

    try {
      const parsedImageUrls = (() => {
        try {
          const arr = Array.isArray(item.image_urls) ? item.image_urls : JSON.parse(item.image_urls || '[]');
          return Array.isArray(arr) ? arr : [];
        } catch {
          return [];
        }
      })();

      const prepare = await apiPost(`/listings/${item.id}/terms/prepare`, {
        rentAmount,
        minLeaseMonths: Number(minLeaseMonths),
        imageUrls: parsedImageUrls,
      });
      const prepared = prepare?.data;
      const chainAnchor = prepared?.chainAnchor;
      const { contract, chainState } = await getContractAndState(item.id);
      const expectedVersion = chainState[7];
      const expectedNonce = chainState[8];

      const tx = await contract.updateListingTerms(
        item.id,
        chainAnchor.contentHash,
        chainAnchor.rentAmountWei,
        Number(chainAnchor.minLeaseMonths),
        chainAnchor.imageRootHash,
        expectedVersion,
        expectedNonce
      );
      await tx.wait();

      const commit = await apiPost(`/listings/${item.id}/terms/commit`, {
        rentAmount: prepared.rentAmount,
        minLeaseMonths: prepared.minLeaseMonths,
        imageUrls: prepared.imageUrls,
        chainAnchor,
        txHash: tx.hash,
      });

      const next = commit?.data || {};
      setListings((prev) => prev.map((x) => (x.id === item.id ? {
        ...x,
        rent_amount: next.rentAmount ?? x.rent_amount,
        min_lease_months: next.minLeaseMonths ?? x.min_lease_months,
        image_urls: JSON.stringify(next.imageUrls ?? parsedImageUrls),
      } : x)));
      toast.success('条款链上更新成功');
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || '条款更新失败');
    }
  };

  const rescore = async (id) => {
    try {
      const res = await apiPost(`/listings/${id}/score`, {});
      toast.success(`评分完成：${res.data.score}`);
      setListings((prev) => prev.map((x) => (x.id === id ? { ...x, ai_score: res.data.score, ai_risk_tags: res.data.riskTags } : x)));
    } catch (error) {
      toast.error(error?.response?.data?.error || '评分失败');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoaderIcon className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">我的房源</h1>
        <Link to="/publish" className="btn-primary">发布新房源</Link>
      </div>

      {listings.length === 0 ? (
        <div className="card p-8 text-center">
          <HomeIcon className="mx-auto mb-3 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">暂无已发布房源</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((item) => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {getFirstImageUrl(item) ? (
                    <img src={resolveImageUrl(getFirstImageUrl(item))} alt={item.title || 'listing'} className="h-20 w-28 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="flex h-20 w-28 flex-shrink-0 items-center justify-center rounded-md bg-gray-800">
                      <HomeIcon className="h-6 w-6 text-gray-600" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                    <p className="mt-1 text-sm text-gray-400">{item.address || '-'}</p>
                    <p className="mt-2 text-primary-400 font-medium">{item.rent_amount} ETH/月</p>
                    <p className="mt-1 text-xs text-gray-500">AI评分: {item.ai_score ?? '-'}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).badge}>
                    {(LISTING_STATUS_MAP[item.status] || LISTING_STATUS_MAP.offline).label}
                  </span>
                  <div className="mt-2 flex flex-col gap-2">
                    {item.status === 'available' && (
                      <>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateStatusOnchain(item.id, 'offline')}>下架（钱包签名）</button>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateTermsOnchain(item)}>修改条款（钱包签名）</button>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => {
                          if (confirm('确认销毁该房源吗？销毁后不可恢复。')) updateStatusOnchain(item.id, 'closed');
                        }}>销毁（钱包签名）</button>
                      </>
                    )}
                    {item.status === 'offline' && (
                      <>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateStatusOnchain(item.id, 'available')}>重新上架（钱包签名）</button>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => updateTermsOnchain(item)}>修改条款（钱包签名）</button>
                        <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => {
                          if (confirm('确认销毁该房源吗？销毁后不可恢复。')) updateStatusOnchain(item.id, 'closed');
                        }}>销毁（钱包签名）</button>
                      </>
                    )}
                    {!['available', 'offline'].includes(item.status) && (
                      <span className="text-xs text-gray-500">流程中不可操作</span>
                    )}
                    <button className="btn-secondary text-sm px-3 py-1.5" onClick={() => rescore(item.id)}>重新评分</button>
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
