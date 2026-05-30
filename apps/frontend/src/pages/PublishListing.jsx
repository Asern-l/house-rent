import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useAuth } from '../app/providers/AuthContext';
import { apiPost } from '../shared/api/api';
import RentalChainABI from '../shared/blockchain/RentalChainABI.json';
import toast from 'react-hot-toast';
import { AlertCircleIcon, HomeIcon, LoaderIcon, PlusCircleIcon, XIcon } from 'lucide-react';

const MAX_IMAGE_COUNT = 12;

const CONTRACT_ADDR_MAP = {
  sepolia: import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '',
  local: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
};

const NETWORK_OPTIONS = {
  sepolia: {
    label: 'Sepolia',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    addParams: {
      chainId: '0xaa36a7',
      chainName: 'Sepolia Testnet',
      nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
  local: {
    label: 'Local EVM (31337)',
    chainId: 31337,
    chainIdHex: '0x7a69',
    addParams: {
      chainId: '0x7a69',
      chainName: 'Local EVM (31337)',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['http://127.0.0.1:8545'],
    },
  },
};

function getPreferredNetwork() {
  const key = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  return NETWORK_OPTIONS[key] ? key : 'sepolia';
}

// 函数 1: 切换钱包到当前前端所选网络。
async function ensureWalletNetwork(provider, networkKey) {
  const target = NETWORK_OPTIONS[networkKey] || NETWORK_OPTIONS.sepolia;
  const net = await provider.getNetwork();
  if (Number(net.chainId) === target.chainId) return;

  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] });
  } catch {
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [target.addParams] });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainIdHex }] });
  }
}

export default function PublishListing({ onClose }) {
  const isModal = typeof onClose === 'function';
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', description: '', address: '', district: '',
    rentAmount: '', minLeaseMonths: 1,
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const imagePreviewsRef = React.useRef([]);

  const close = () => {
    if (isModal) onClose?.();
    else navigate(-1);
  };

  // 函数 2: 读取图片为 dataURL，用于上传接口。
  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (imageFiles.length + files.length > MAX_IMAGE_COUNT) {
      toast.error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`);
      e.target.value = '';
      return;
    }
    setImageFiles((prev) => [...prev, ...files]);
    const nextPreviews = files.map((item) => URL.createObjectURL(item));
    setImagePreviews((prev) => {
      const next = [...prev, ...nextPreviews];
      imagePreviewsRef.current = next;
      return next;
    });
    e.target.value = '';
  };

  const removeImage = (index) => {
    setImageFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setImagePreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target);
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      imagePreviewsRef.current = next;
      return next;
    });
  };

  // 函数 3: 发布房源流程（先上链再入库）。
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.description || !form.address || !form.rentAmount) {
      toast.error('请填写必填项');
      return;
    }
    if (!window.ethereum) {
      toast.error('请先安装 MetaMask 钱包');
      return;
    }

    setSubmitting(true);
    try {
      let uploadedImageUrls = [];
      if (imageFiles.length > 0) {
        const images = [];
        for (const file of imageFiles) {
          const dataUrl = await readFileAsDataUrl(file);
          images.push({ dataUrl });
        }
        const uploadRes = await apiPost('/listings/upload-images', { images });
        uploadedImageUrls = Array.isArray(uploadRes?.data?.images)
          ? uploadRes.data.images.map((item) => item.url).filter(Boolean)
          : [];
      }

      const prepare = await apiPost('/listings/prepare-create', { ...form, imageUrls: uploadedImageUrls });
      const draft = prepare?.data?.draft;
      const chainAnchor = prepare?.data?.chainAnchor;
      if (!draft || !chainAnchor?.listingId) throw new Error('预创建返回数据无效');

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

      const tx = await contract.createListing(
        chainAnchor.listingId,
        chainAnchor.contentHash,
        chainAnchor.rentAmountWei,
        Number(chainAnchor.minLeaseMonths),
        chainAnchor.imageRootHash
      );
      await tx.wait();

      const commit = await apiPost('/listings/commit-create', {
        draft,
        chainAnchor,
        txHash: tx.hash,
        operationId: `op_create_${chainAnchor.listingId}_${String(tx.hash || '').toLowerCase()}`,
      });

      toast.success('房源发布成功（已上链）');
      close();
      navigate(`/listing/${commit?.data?.id || draft.listingId}`);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  React.useEffect(() => {
    return () => {
      imagePreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      imagePreviewsRef.current = [];
    };
  }, []);

  if (!user || user.role !== 'landlord') {
    if (!isModal) {
      return (
        <div className="mx-auto max-w-xl">
          <div className="card p-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-amber-200 shadow-[0_12px_30px_rgba(2,6,23,0.24)]">
              <AlertCircleIcon className="h-7 w-7 text-primary-700" />
            </div>
            <h1 className="text-2xl font-bold text-white">无法发布房源</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300/72">只有房东账号可以发布房源，请登录房东账号后重试。</p>
            <Link to="/login" className="mt-7 inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 px-6 text-base font-semibold text-slate-100 shadow-[0_6px_12px_rgba(15,23,42,0.32)]">
              去登录
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
        <div className="relative w-full max-w-[385px] rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78)_0%,rgba(10,15,28,0.82)_100%)] p-8 text-center shadow-[0_22px_55px_rgba(27,23,18,0.28)]">
          <CloseButton onClose={close} />
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-amber-200 shadow-[0_12px_30px_rgba(2,6,23,0.24)]">
            <AlertCircleIcon className="h-7 w-7 text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-white">无法发布房源</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300/72">只有房东账号可以发布房源，请登录房东账号后重试。</p>
          <Link to="/login" onClick={close} className="mt-7 flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-slate-100 shadow-[0_6px_12px_rgba(15,23,42,0.32)]">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={isModal ? 'fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-sm' : 'mx-auto w-full max-w-[720px] animate-fade-in'}>
      <div className="relative w-full max-w-[720px] rounded-[1.5rem] border border-white/10 p-6 shadow-[0_22px_55px_rgba(2,6,23,0.34)] backdrop-blur-xl animate-fade-in md:p-8" style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(10,15,28,0.86) 100%)' }}>
        {isModal && <CloseButton onClose={close} />}

        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-amber-200 shadow-[0_12px_30px_rgba(2,6,23,0.24)]">
            <HomeIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">发布房源</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-300/72">发布流程：先通过钱包完成链上存证，再写入平台数据库。</p>
        </div>

        <form onSubmit={handleSubmit} className={isModal ? 'max-h-[68vh] space-y-4 overflow-y-auto pr-1' : 'space-y-4'}>
          <Panel>
            <Field label="标题 *"><input type="text" className="auth-input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required /></Field>
            <Field label="描述 *"><textarea className="auth-input min-h-[84px] resize-none py-2" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required /></Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="地址 *"><input type="text" className="auth-input" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} required /></Field>
              <Field label="区域"><input type="text" className="auth-input" value={form.district} onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))} /></Field>
            </div>
          </Panel>

          <Panel>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="月租金(ETH) *"><input type="number" step="0.01" min="0" className="auth-input" value={form.rentAmount} onChange={(e) => setForm((p) => ({ ...p, rentAmount: e.target.value }))} required /></Field>
              <Field label="面积(㎡)"><input type="number" min="0" className="auth-input" value={form.area} onChange={(e) => setForm((p) => ({ ...p, area: e.target.value }))} /></Field>
            </div>

            <Field label="最少租期(月)">
              <select className="auth-input" value={form.minLeaseMonths} onChange={(e) => setForm((p) => ({ ...p, minLeaseMonths: parseInt(e.target.value, 10) }))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (<option key={m} value={m}>{m}个月</option>))}
              </select>
            </Field>

            <div className="grid grid-cols-3 gap-3">
              {[{ label: '卧室', key: 'bedrooms', min: 1 }, { label: '客厅', key: 'livingrooms', min: 0 }, { label: '卫生间', key: 'bathrooms', min: 1 }].map(({ label, key, min }) => (
                <Field key={key} label={label}><input type="number" min={min} className="auth-input" value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: parseInt(e.target.value, 10) }))} /></Field>
              ))}
            </div>
          </Panel>

          <Panel>
            <label className="block text-sm font-semibold text-slate-100">房源图片</label>
            <p className="mt-1 text-xs text-slate-300/72">可选，最多 {MAX_IMAGE_COUNT} 张，仅支持 jpeg/png/webp。</p>
            <input type="file" className="mt-3 block w-full rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-stone-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageChange} />
            {imagePreviews.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-4">
                {imagePreviews.map((url, index) => (
                  <div key={`${url}_${index}`} className="group relative overflow-hidden rounded-2xl border border-white/10">
                    <img src={url} alt={`preview_${index}`} className="h-24 w-full object-cover" />
                    <button type="button" onClick={() => removeImage(index)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/85 text-slate-100 shadow-sm transition-colors hover:bg-red-600" aria-label={`删除第${index + 1}张图片`}>
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <button type="submit" disabled={submitting} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-slate-100 shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            {submitting ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <PlusCircleIcon className="h-5 w-5" />}
            <span>{submitting ? '提交中...' : '发布房源（钱包确认）'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function Panel({ children }) {
  return <section className="space-y-3 rounded-2xl border border-white/10 bg-white/6 p-4">{children}</section>;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-300/72">{label}</span>
      <span className="flex min-h-[40px] items-center rounded-2xl border border-white/10 bg-white/6 px-3 focus-within:border-primary-600/80">{children}</span>
    </label>
  );
}

function CloseButton({ onClose }) {
  return (
    <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-stone-900/5 hover:text-slate-200" aria-label="关闭">
      <XIcon className="h-4 w-4" />
    </button>
  );
}
