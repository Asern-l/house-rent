import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ethers } from 'ethers';
import { HomeIcon, LoaderIcon, MapPinIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import { apiGet, apiPost } from '../shared/api/api';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';

const MAX_IMAGE_COUNT = 12;
const LISTING_STATUS_MAP = {
  available: { label: '\u53ef\u7533\u8bf7', badge: 'badge-green' },
  signing: { label: '\u7b7e\u7ea6\u4e2d', badge: 'badge-yellow' },
  rented: { label: '\u5df2\u79df\u51fa', badge: 'badge-blue' },
  offline: { label: '\u5df2\u4e0b\u67b6', badge: 'badge-gray' },
  closed: { label: '\u5df2\u5173\u95ed', badge: 'badge-gray' },
};

const CONTRACT_ADDR_MAP = {
  sepolia: import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '',
  local: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
};

const NETWORK_OPTIONS = {
  sepolia: { chainId: 11155111, chainIdHex: '0xaa36a7' },
  local: { chainId: 31337, chainIdHex: '0x7a69' },
};

function openMap(address) {
  const q = encodeURIComponent(String(address || '').trim());
  if (!q) return;
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const url = isMac ? `maps://?q=${q}&address=${q}` : `https://maps.google.com/?q=${q}`;
  window.open(url, '_blank');
}

function parseImageUrls(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function parseJsonArray(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function parseClausesText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const [editMode, setEditMode] = useState('info');
  const [submittingId, setSubmittingId] = useState('');
  const [editForm, setEditForm] = useState({ rentAmount: '', minLeaseMonths: 1 });
  const [clausesForm, setClausesForm] = useState({ clausesText: '' });
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
    setEditMode('info');
    setEditForm({ rentAmount: '', minLeaseMonths: 1 });
    setClausesForm({ clausesText: '' });
    setCurrentImageUrls([]);
    setNewImageFiles([]);
    setNewImagePreviews([]);
  };

  const startEdit = (item, mode = 'info') => {
    setEditingId(item.id);
    setEditMode(mode);
    setEditForm({
      rentAmount: String(item.rent_amount || ''),
      minLeaseMonths: Number(item.min_lease_months || 1),
    });
    setClausesForm({
      clausesText: parseJsonArray(item.clauses_template_json).join('\n'),
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
      const currentChainStatus = Number(chainState?.status ?? chainState?.[6]);
      const expectedCurrentStatus = { available: 1, offline: 0, closed: currentChainStatus }[status];
      if (currentChainStatus === 2) {
        throw new Error('链上房源已销毁，不能再下架、上架或编辑');
      }
      if (status !== 'closed' && Number.isFinite(expectedCurrentStatus) && currentChainStatus !== expectedCurrentStatus) {
        throw new Error('链上房源状态与数据库不一致，请先验真或刷新后重试');
      }
      const expectedVersion = chainState[7];
      const expectedNonce = chainState[8];
      await contract.setListingStatus.staticCall(id, Number(prepared.toStatusEnum), expectedVersion, expectedNonce);
      const estimatedGas = await contract.setListingStatus.estimateGas(
        id,
        Number(prepared.toStatusEnum),
        expectedVersion,
        expectedNonce
      );
      const gasLimit = (estimatedGas * 12n) / 10n;
      const tx = await contract.setListingStatus(
        id,
        Number(prepared.toStatusEnum),
        expectedVersion,
        expectedNonce,
        { gasLimit }
      );
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

  const submitListingUpdate = async (item) => {
    if (editMode === 'clauses') {
      setSubmittingId(item.id);
      try {
        const res = await apiPost(`/listings/${item.id}/clauses`, {
          clauses: parseClausesText(clausesForm.clausesText),
        });
        const next = res?.data || {};
        setListings((prev) => prev.map((x) => (x.id === item.id ? {
          ...x,
          clauses_template_json: JSON.stringify(next.clauses ?? parseClausesText(clausesForm.clausesText)),
        } : x)));
        toast.success('附加条款更新成功');
        resetEditingState();
      } catch (error) {
        await reportClientError({
          listingId: item?.id,
          stage: 'listing.clauses.error',
          message: error?.message || 'submitListingUpdate failed',
          stack: error?.stack || '',
          extra: { apiError: error?.response?.data || null },
        });
        toast.error(error?.response?.data?.error || error?.message || '附加条款更新失败');
      } finally {
        setSubmittingId('');
      }
      return;
    }

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
        clauses: parseJsonArray(item.clauses_template_json),
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
        clauses_template_json: JSON.stringify(next.clauses ?? parseJsonArray(item.clauses_template_json)),
        image_urls: JSON.stringify(next.imageUrls ?? mergedImageUrls),
      } : x)));
      toast.success('房源信息更新成功（已上链）');
      resetEditingState();
    } catch (error) {
      await reportClientError({
        listingId: item?.id,
        stage: 'listing.info.error',
        message: error?.message || 'submitListingUpdate failed',
        stack: error?.stack || '',
        extra: { apiError: error?.response?.data || null },
      });
      toast.error(error?.response?.data?.error || error?.message || '房源信息更新失败');
    } finally {
      setSubmittingId('');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoaderIcon className="h-8 w-8 animate-spin text-amber-200" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{'我的房源'}</h1>
          <p className="mt-1 text-sm text-slate-300/68">
            {'管理当前网络下的房源状态、链上条款更新和附加条款模板。'}
          </p>
        </div>
        <Link to="/publish" className="btn-primary">
          {'发布新房源'}
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="card p-8 text-center">
          <HomeIcon className="mx-auto mb-3 h-12 w-12 text-slate-500" />
          <p className="text-slate-300/72">{'暂无已发布房源'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((item) => {
            const rawStatus = String(item.status || '').trim().toLowerCase();
            const isEditable = ['available', 'offline'].includes(rawStatus);
            const isEditing = editingId === item.id;
            const isEditingInfo = isEditing && editMode === 'info';
            const isEditingClauses = isEditing && editMode === 'clauses';
            const allPreviewUrls = [...currentImageUrls, ...newImagePreviews];
            const displayStatus = getDisplayStatus(item);
            return (
              <div key={item.id} className="card p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    {getFirstImageUrl(item) ? (
                      <img src={resolveImageUrl(getFirstImageUrl(item))} alt={item.title || 'listing'} className="h-20 w-28 flex-shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-20 w-28 flex-shrink-0 items-center justify-center rounded-xl bg-white/6">
                        <HomeIcon className="h-6 w-6 text-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-white">{item.title || '未命名房源'}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-300/80">
                        <button
                          type="button"
                          onClick={() => openMap(item.address)}
                          className="truncate text-left underline-offset-2 hover:text-white hover:underline"
                          title={'在地图中查看'}
                        >
                          {item.address || '-'}
                        </button>
                        <MapPinIcon className="h-4 w-4 text-slate-500" />
                        <button
                          type="button"
                          onClick={() => openMap(item.address)}
                          className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-white/10"
                          title={'在地图中查看'}
                        >
                          {'查看地图'}
                        </button>
                      </div>
                      <p className="mt-2 text-lg font-semibold text-amber-200">{item.rent_amount} ETH/{'月'}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 lg:min-w-[210px]">
                    <div className="mb-2 flex justify-start lg:justify-end">
                      <span className={`${displayStatus.badge} px-2 py-0.5 text-[11px]`}>{displayStatus.label}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {rawStatus === 'available' && (
                        <>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => updateStatusOnchain(item.id, 'offline')}>{'下架（钱包签名）'}</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item, 'info')}>{'房源信息编辑'}</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item, 'clauses')}>{'附加条款编辑'}</button>
                          <button
                            disabled={submittingId === item.id}
                            className="rounded-xl border border-red-500/25 bg-red-500/12 px-3 py-1.5 text-sm font-medium text-red-200 transition hover:bg-red-500/18 disabled:opacity-60"
                            onClick={() => {
                              if (confirm('确认销毁该房源吗？销毁后不可恢复。')) {
                                updateStatusOnchain(item.id, 'closed');
                              }
                            }}
                          >
                            {'销毁（钱包签名）'}
                          </button>
                        </>
                      )}
                      {rawStatus === 'offline' && (
                        <>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => updateStatusOnchain(item.id, 'available')}>{'重新上架（钱包签名）'}</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item, 'info')}>{'房源信息编辑'}</button>
                          <button disabled={submittingId === item.id} className="btn-secondary px-3 py-1.5 text-sm" onClick={() => startEdit(item, 'clauses')}>{'附加条款编辑'}</button>
                          <button
                            disabled={submittingId === item.id}
                            className="rounded-xl border border-red-500/25 bg-red-500/12 px-3 py-1.5 text-sm font-medium text-red-200 transition hover:bg-red-500/18 disabled:opacity-60"
                            onClick={() => {
                              if (confirm('确认销毁该房源吗？销毁后不可恢复。')) {
                                updateStatusOnchain(item.id, 'closed');
                              }
                            }}
                          >
                            {'销毁（钱包签名）'}
                          </button>
                        </>
                      )}
                      {!isEditable && <span className="text-xs text-slate-500">{'当前流程中不可操作'}</span>}
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4 backdrop-blur-md">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="flex items-center gap-2 text-sm font-semibold text-white">
                        <PencilIcon className="h-4 w-4 text-amber-200" />
                        {isEditingClauses ? '附加条款编辑' : '房源信息编辑'}
                      </p>
                      <button type="button" className="rounded-full border border-white/10 bg-white/6 p-2 text-slate-300 transition hover:bg-white/12 hover:text-white" onClick={resetEditingState}>
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>

                    {isEditingInfo && (
                      <>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <label className="text-xs text-slate-400">
                            {'租金（ETH）'}
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="input-field mt-1"
                              value={editForm.rentAmount}
                              onChange={(e) => setEditForm((p) => ({ ...p, rentAmount: e.target.value }))}
                            />
                          </label>
                          <label className="text-xs text-slate-400">
                            {'最少租期（月）'}
                            <select
                              className="input-field mt-1"
                              value={editForm.minLeaseMonths}
                              onChange={(e) => setEditForm((p) => ({ ...p, minLeaseMonths: Number(e.target.value) }))}
                            >
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}{'个月'}</option>)}
                            </select>
                          </label>
                        </div>

                        <div className="mt-3 rounded-xl border border-white/8 bg-white/6 p-4 backdrop-blur-sm">
                          <p className="text-xs text-slate-500">{'以下字段仅展示，不支持编辑'}</p>
                          <p className="mt-2 text-sm text-slate-300">{'标题：'}{item.title || '-'}</p>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-slate-300">{'地址：'}{item.address || '-'}</p>
                            <button
                              type="button"
                              onClick={() => openMap(item.address)}
                              className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                              title={'在地图中查看'}
                            >
                              {'查看地图'}
                            </button>
                          </div>
                          <p className="text-sm text-slate-300">{'描述：'}{item.description || '-'}</p>
                        </div>

                        <div className="mt-3">
                          <p className="text-xs text-slate-400">{'图片（可增删，最多 '}{MAX_IMAGE_COUNT}{' 张）'}</p>
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
                            className="mt-2 block w-full text-xs text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            onChange={handleSelectNewImages}
                          />
                          <p className="mt-1 text-xs text-slate-500">{'当前总数：'}{allPreviewUrls.length}</p>
                        </div>
                      </>
                    )}

                    {isEditingClauses && (
                      <label className="block text-xs text-slate-400">
                        {'默认条款（每行一条）'}
                        <textarea
                          className="input-field mt-1 min-h-[120px] resize-y"
                          value={clausesForm.clausesText}
                          onChange={(e) => setClausesForm({ clausesText: e.target.value })}
                          placeholder={`例如：\n租金需在每月 1 日前支付\n禁止转租\n保持房屋设施完好`}
                        />
                      </label>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        className="btn-primary px-4 py-2 text-sm"
                        disabled={submittingId === item.id}
                        onClick={() => submitListingUpdate(item)}
                      >
                        {submittingId === item.id ? '提交中...' : (isEditingClauses ? '提交附加条款修改' : '提交房源信息修改（钱包签名）')}
                      </button>
                      <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={resetEditingState}>{'取消'}</button>
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
