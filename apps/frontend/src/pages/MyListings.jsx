import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ethers } from 'ethers';
import { HomeIcon, LoaderIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import { apiGet, apiPost } from '../shared/api/api';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';

const MAX_IMAGE_COUNT = 12;
const LISTING_STATUS_MAP = {
  available: { label: '可申请', badge: 'badge-green' },
  signing: { label: '签约中', badge: 'badge-yellow' },
  rented: { label: '已租出', badge: 'badge-blue' },
  offline: { label: '已下架', badge: 'badge-gray' },
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

function getPreferredNetwork() {
  const key = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  return NETWORK_OPTIONS[key] ? key : 'sepolia';
}

async function ensureWalletNetwork(provider, networkKey) {
  const target = NETWORK_OPTIONS[networkKey];
  const net = await provider.getNetwork();
  if (Number(net.chainId) === target.chainId) return;
  try {
    await Promise.resolve(window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] }));
  } catch {
    if (networkKey === 'local') {
      await Promise.resolve(window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x7a69',
          chainName: 'Local EVM (31337)',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8545'],
        }],
      }));
      await Promise.resolve(window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] }));
      return;
    }
    await Promise.resolve(window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0xaa36a7',
        chainName: 'Sepolia Testnet',
        nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
      }],
    }));
    await Promise.resolve(window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] }));
  }
}

function getFirstImageUrl(item) {
  const arr = parseImageUrls(item?.image_urls);
  return arr[0] || '';
}

function isHex32(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || ''));
}

function getDisplayStatus(item) {
  const rawStatus = String(item?.status || '').trim().toLowerCase();
  const publicStatus = String(item?.public_status || rawStatus).trim().toLowerCase();
  return LISTING_STATUS_MAP[publicStatus] || LISTING_STATUS_MAP.offline;
}

export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState('');
  const [submittingId, setSubmittingId] = useState('');
  const [editForm, setEditForm] = useState({ rentAmount: '', minLeaseMonths: 1 });
  const [currentImageUrls, setCurrentImageUrls] = useState([]);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [newImagePreviews, setNewImagePreviews] = useState([]);
  const previewsRef = useRef([]);

  const reportClientError = async (payload = {}) => {
    try {
      await apiPost('/listings/client-report', { page: 'MyListings', ...payload });
    } catch {
      // best effort
    }
  };

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

  useEffect(() => () => {
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = [];
  }, []);

  useEffect(() => {
    const onError = (event) => {
      reportClientError({
        stage: 'runtime.window.error',
        message: event?.message || 'window.error',
        stack: event?.error?.stack || '',
        extra: {
          source: event?.filename || '',
          line: event?.lineno || 0,
          column: event?.colno || 0,
        },
      });
    };
    const onUnhandledRejection = (event) => {
      const reason = event?.reason;
      reportClientError({
        stage: 'runtime.unhandledrejection',
        message: reason?.message || String(reason || 'unknown rejection'),
        stack: reason?.stack || '',
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  const getContractAndState = async (listingId) => {
    const networkKey = getPreferredNetwork();
    const contractAddress = String(CONTRACT_ADDR_MAP[networkKey] || '').trim();
    if (!ethers.isAddress(contractAddress)) {
      throw new Error(`未配置合约地址: VITE_CONTRACT_ADDRESS_${networkKey.toUpperCase()}`);
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await ensureWalletNetwork(provider, networkKey);
    await Promise.resolve(window.ethereum.request({ method: 'eth_requestAccounts' }));
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(contractAddress, RentalChainABI, signer);
    const chainState = await contract.getListing(listingId);
    return { contract, chainState };
  };

  const resetEditingState = () => {
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = [];
    setEditingId('');
    setEditForm({ rentAmount: '', minLeaseMonths: 1 });
    setCurrentImageUrls([]);
    setNewImageFiles([]);
    setNewImagePreviews([]);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      rentAmount: String(item.rent_amount || ''),
      minLeaseMonths: Number(item.min_lease_months || 1),
    });
    setCurrentImageUrls(parseImageUrls(item.image_urls));
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = [];
    setNewImageFiles([]);
    setNewImagePreviews([]);
  };

  const removeCurrentImage = (index) => {
    setCurrentImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index) => {
    setNewImageFiles((prev) => prev.filter((_, i) => i !== index));
    setNewImagePreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target);
      const next = prev.filter((_, i) => i !== index);
      previewsRef.current = next;
      return next;
    });
  };

  const handleSelectNewImages = (e) => {
    const files = Array.from(e.target.files || []);
    const remain = MAX_IMAGE_COUNT - currentImageUrls.length - newImageFiles.length;
    if (files.length > remain) {
      toast.error(`最多保留 ${MAX_IMAGE_COUNT} 张图片`);
      e.target.value = '';
      return;
    }
    const previews = files.map((f) => URL.createObjectURL(f));
    setNewImageFiles((prev) => [...prev, ...files]);
    setNewImagePreviews((prev) => {
      const next = [...prev, ...previews];
      previewsRef.current = next;
      return next;
    });
    e.target.value = '';
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

  const updateStatusOnchain = async (id, status) => {
    if (!window.ethereum) {
      await reportClientError({ listingId: id, stage: 'wallet.missing', message: 'window.ethereum is missing', extra: { status } });
      toast.error('请先安装 MetaMask 钱包');
      return;
    }
    setSubmittingId(id);
    try {
      const prepare = await apiPost(`/listings/${id}/status/prepare`, { status });
      const prepared = prepare?.data;
      const { contract, chainState } = await getContractAndState(id);
      const expectedVersion = chainState[7];
      const expectedNonce = chainState[8];
      const tx = await contract.setListingStatus(id, Number(prepared.toStatusEnum), expectedVersion, expectedNonce);
      await tx.wait();
      await apiPost(`/listings/${id}/status/commit`, {
        status,
        txHash: tx.hash,
        operationId: `op_status_${id}_${status}_${String(tx.hash || '').toLowerCase()}`,
      });
      setListings((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
      toast.success(status === 'closed' ? '房源已销毁' : '状态更新成功');
    } catch (error) {
      await reportClientError({
        listingId: id,
        stage: 'status.error',
        message: error?.message || 'updateStatusOnchain failed',
        stack: error?.stack || '',
        extra: { status, apiError: error?.response?.data || null },
      });
      toast.error(error?.response?.data?.error || error?.message || '状态更新失败');
    } finally {
      setSubmittingId('');
    }
  };

  const submitEditTerms = async (item) => {
    if (!window.ethereum) {
      await reportClientError({ listingId: item?.id, stage: 'wallet.missing', message: 'window.ethereum is missing' });
      toast.error('请先安装 MetaMask 钱包');
      return;
    }
    setSubmittingId(item.id);
    try {
      let uploadedUrls = [];
      if (newImageFiles.length > 0) {
        const images = [];
        for (const file of newImageFiles) {
          images.push({ dataUrl: await readFileAsDataUrl(file) });
        }
        const uploadRes = await apiPost('/listings/upload-images', { images });
        uploadedUrls = Array.isArray(uploadRes?.data?.images) ? uploadRes.data.images.map((x) => x.url).filter(Boolean) : [];
      }

      const mergedImageUrls = [...currentImageUrls, ...uploadedUrls];
      const prepare = await apiPost(`/listings/${item.id}/terms/prepare`, {
        rentAmount: editForm.rentAmount,
        minLeaseMonths: Number(editForm.minLeaseMonths),
        imageUrls: mergedImageUrls,
      });
      const prepared = prepare?.data;
      const chainAnchor = prepared?.chainAnchor;
      const { contract, chainState } = await getContractAndState(item.id);
      const expectedVersion = chainState?.version ?? chainState?.[7];
      const expectedNonce = chainState?.nonce ?? chainState?.[8];

      const listingIdArg = String(item.id || '').trim();
      const contentHashArg = String(chainAnchor?.contentHash || '').trim();
      const rentAmountWeiArg = String(chainAnchor?.rentAmountWei || '').trim();
      const minLeaseMonthsArg = Number(chainAnchor?.minLeaseMonths);
      const imageRootHashArg = String(chainAnchor?.imageRootHash || '').trim();

      if (!listingIdArg) throw new Error('上链参数缺失: listingId');
      if (!isHex32(contentHashArg)) throw new Error('上链参数非法: contentHash');
      if (!/^\d+$/.test(rentAmountWeiArg) || BigInt(rentAmountWeiArg) <= 0n) throw new Error('上链参数非法: rentAmountWei');
      if (!Number.isInteger(minLeaseMonthsArg) || minLeaseMonthsArg <= 0) throw new Error('上链参数非法: minLeaseMonths');
      if (!isHex32(imageRootHashArg)) throw new Error('上链参数非法: imageRootHash');
      if (expectedVersion === undefined || expectedVersion === null) throw new Error('上链参数缺失: expectedVersion');
      if (expectedNonce === undefined || expectedNonce === null) throw new Error('上链参数缺失: expectedNonce');

      const tx = await contract.updateListingTerms(
        listingIdArg,
        contentHashArg,
        rentAmountWeiArg,
        minLeaseMonthsArg,
        imageRootHashArg,
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
        operationId: `op_terms_${item.id}_${String(tx.hash || '').toLowerCase()}`,
      });
      const next = commit?.data || {};
      setListings((prev) => prev.map((x) => (x.id === item.id ? {
        ...x,
        rent_amount: next.rentAmount ?? x.rent_amount,
        min_lease_months: next.minLeaseMonths ?? x.min_lease_months,
        image_urls: JSON.stringify(next.imageUrls ?? mergedImageUrls),
      } : x)));
      toast.success('条款更新成功（已上链）');
      resetEditingState();
    } catch (error) {
      await reportClientError({
        listingId: item?.id,
        stage: 'terms.error',
        message: error?.message || 'submitEditTerms failed',
        stack: error?.stack || '',
        extra: { apiError: error?.response?.data || null },
      });
      toast.error(error?.response?.data?.error || error?.message || '条款更新失败');
    } finally {
      setSubmittingId('');
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
          {listings.map((item) => {
            const rawStatus = String(item.status || '').trim().toLowerCase();
            const isEditable = ['available', 'offline'].includes(rawStatus);
            const isEditing = editingId === item.id;
            const allPreviewUrls = [...currentImageUrls, ...newImagePreviews];
            const displayStatus = getDisplayStatus(item);
            return (
              <div key={item.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {getFirstImageUrl(item) ? (
                      <img src={resolveImageUrl(getFirstImageUrl(item))} alt={item.title || 'listing'} className="h-20 w-28 flex-shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-20 w-28 flex-shrink-0 items-center justify-center rounded-md bg-gray-800">
                        <HomeIcon className="h-6 w-6 text-gray-600" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-base font-semibold text-gray-100">{item.title || '未命名房源'}</h3>
                      <p className="mt-1 text-sm text-gray-400">{item.address || '-'}</p>
                      <p className="mt-2 font-medium text-primary-400">{item.rent_amount} ETH/月</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className={displayStatus.badge}>{displayStatus.label}</span>
                    <div className="mt-2 flex flex-col gap-2">
                      {rawStatus === 'available' && (
                        <>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => updateStatusOnchain(item.id, 'offline')}>下架（钱包签名）</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item)}>编辑条款</button>
                          <button
                            disabled={submittingId === item.id}
                            className="btn-secondary px-3 py-1.5 text-sm"
                            onClick={() => {
                              if (confirm('确认销毁该房源吗？销毁后不可恢复。')) {
                                updateStatusOnchain(item.id, 'closed');
                              }
                            }}
                          >
                            销毁（钱包签名）
                          </button>
                        </>
                      )}
                      {rawStatus === 'offline' && (
                        <>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => updateStatusOnchain(item.id, 'available')}>重新上架（钱包签名）</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item)}>编辑条款</button>
                          <button
                            disabled={submittingId === item.id}
                            className="btn-secondary px-3 py-1.5 text-sm"
                            onClick={() => {
                              if (confirm('确认销毁该房源吗？销毁后不可恢复。')) {
                                updateStatusOnchain(item.id, 'closed');
                              }
                            }}
                          >
                            销毁（钱包签名）
                          </button>
                        </>
                      )}
                      {!isEditable && <span className="text-xs text-gray-500">当前流程中不可操作</span>}
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-xl border border-gray-700 bg-gray-900/40 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                        <PencilIcon className="h-4 w-4" />
                        编辑条款
                      </p>
                      <button type="button" className="text-gray-400 hover:text-gray-200" onClick={resetEditingState}>
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="text-xs text-gray-400">
                        租金（ETH）
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="input-field mt-1"
                          value={editForm.rentAmount}
                          onChange={(e) => setEditForm((p) => ({ ...p, rentAmount: e.target.value }))}
                        />
                      </label>
                      <label className="text-xs text-gray-400">
                        最少租期（月）
                        <select
                          className="input-field mt-1"
                          value={editForm.minLeaseMonths}
                          onChange={(e) => setEditForm((p) => ({ ...p, minLeaseMonths: Number(e.target.value) }))}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}个月</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                      <p className="text-xs text-gray-500">content 固定不可改（以下字段仅展示）</p>
                      <p className="mt-1 text-sm text-gray-400">标题：{item.title || '-'}</p>
                      <p className="text-sm text-gray-400">地址：{item.address || '-'}</p>
                      <p className="text-sm text-gray-400">描述：{item.description || '-'}</p>
                    </div>

                    <div className="mt-3">
                      <p className="text-xs text-gray-400">图片（可增删，最多 {MAX_IMAGE_COUNT} 张）</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-5">
                        {currentImageUrls.map((url, idx) => (
                          <div key={`cur_${url}_${idx}`} className="group relative overflow-hidden rounded border border-gray-700">
                            <img src={resolveImageUrl(url)} alt={`cur_${idx}`} className="h-20 w-full object-cover" />
                            <button type="button" onClick={() => removeCurrentImage(idx)} className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white">
                              <Trash2Icon className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {newImagePreviews.map((url, idx) => (
                          <div key={`new_${url}_${idx}`} className="group relative overflow-hidden rounded border border-blue-700">
                            <img src={url} alt={`new_${idx}`} className="h-20 w-full object-cover" />
                            <button type="button" onClick={() => removeNewImage(idx)} className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white">
                              <Trash2Icon className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <input
                        type="file"
                        className="mt-2 block w-full text-xs text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#f5f0e8]"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={handleSelectNewImages}
                      />
                      <p className="mt-1 text-xs text-gray-500">当前总数：{allPreviewUrls.length}</p>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        className="btn-primary px-4 py-2 text-sm"
                        disabled={submittingId === item.id}
                        onClick={() => submitEditTerms(item)}
                      >
                        {submittingId === item.id ? '提交中...' : '提交修改（钱包签名）'}
                      </button>
                      <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={resetEditingState}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
