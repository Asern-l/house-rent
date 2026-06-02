import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  HelpCircleIcon,
  KeyIcon,
  LoaderIcon,
  ServerIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';

const API_BASE = '/api';

function friendlyIpfsError(msg) {
  const s = String(msg || '');
  if (!s) return '连接失败';
  if (s.includes('fetch failed') || s.includes('ECONNREFUSED') || s.includes('ECONNRESET') || s.includes('ETIMEDOUT')) {
    return '无法连接到本地 IPFS 节点（127.0.0.1:5001），请确认 IPFS Kubo 已启动';
  }
  if (s.includes('未启用')) return 'IPFS 未启用，请先选择节点类型并保存配置';
  return s;
}

async function fetchAdminApi(path, options = {}) {
  const res = await fetch(`${API_BASE}/admin${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

function StatusBadge({ ok, label }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
        <CheckCircleIcon className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-500">
      <XCircleIcon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function KeyGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-stone-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-[#A47864] transition-colors hover:bg-stone-100"
      >
        <HelpCircleIcon className="h-3.5 w-3.5 flex-shrink-0" />
        如何获取签名私钥？
        <ChevronDownIcon
          className={`ml-auto h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-stone-200 bg-stone-50 px-3 pb-3 pt-2.5 space-y-3 text-xs text-stone-500 leading-relaxed">
          <div>
            <p className="mb-1 font-semibold text-slate-700">本地网络（Hardhat）</p>
            <p>
              打开 <code className="rounded bg-stone-200 px-1 py-0.5 text-slate-700">blockchain/.env</code>，
              复制 <code className="rounded bg-stone-200 px-1 py-0.5 text-slate-700">PRIVATE_KEY</code> 或{' '}
              <code className="rounded bg-stone-200 px-1 py-0.5 text-slate-700">TRUSTED_SIGNER_PRIVATE_KEY</code> 的值。
            </p>
            <p className="mt-1">若使用 Hardhat 默认账号 #0，固定私钥为：</p>
            <code className="mt-1 block break-all rounded bg-stone-200 px-2 py-1.5 text-slate-700 font-mono">
              0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            </code>
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">Sepolia 测试网</p>
            <p>
              必须使用<span className="text-slate-600">部署合约时的那个钱包</span>的私钥。
              在 MetaMask 中：点击账号头像 → 账号详情 → 导出私钥，输入密码后复制。
            </p>
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-700">
            私钥只保存在本地服务器内存，不写入文件也不上传云端。重启服务后需重新填写，
            或在 <code className="text-amber-800">blockchain/.env</code> 中持久化配置。
          </p>
        </div>
      )}
    </div>
  );
}

export default function AdminSetupPage({ onClose }) {
  const isModal = typeof onClose === 'function';
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [privateKey, setPrivateKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [keySuccess, setKeySuccess] = useState(false);

  const [ipfsProvider, setIpfsProvider] = useState('local');
  const [pinataJwt, setPinataJwt] = useState('');
  const [showJwt, setShowJwt] = useState(false);
  const [savingIpfs, setSavingIpfs] = useState(false);
  const [ipfsResult, setIpfsResult] = useState(null);
  const [testingIpfs, setTestingIpfs] = useState(false);
  const [ipfsTestResult, setIpfsTestResult] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const data = await fetchAdminApi('/config-status');
      setStatus(data.data);
      if (data.data?.ipfsProvider) setIpfsProvider(data.data.ipfsProvider);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleSaveKey = async () => {
    setKeyError(null);
    setKeySuccess(false);
    setSavingKey(true);
    try {
      await fetchAdminApi('/signer-key', {
        method: 'POST',
        body: JSON.stringify({ privateKey }),
      });
      setPrivateKey('');
      setKeySuccess(true);
      await loadStatus();
      // 3 秒后自动隐藏成功提示
      setTimeout(() => setKeySuccess(false), 3000);
    } catch (err) {
      setKeyError(err.message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleSaveIpfs = async () => {
    setIpfsResult(null);
    setIpfsTestResult(null);
    setSavingIpfs(true);
    try {
      await fetchAdminApi('/ipfs-config', {
        method: 'POST',
        body: JSON.stringify({ provider: ipfsProvider, pinataJwt }),
      });
      setIpfsResult({ ok: true, msg: '配置已保存' });
      await loadStatus();
    } catch (err) {
      setIpfsResult({ ok: false, msg: err.message });
    } finally {
      setSavingIpfs(false);
    }
  };

  const handleTestIpfs = async () => {
    setIpfsTestResult(null);
    setTestingIpfs(true);
    try {
      const data = await fetchAdminApi('/test-ipfs', { method: 'POST' });
      setIpfsTestResult({ ok: true, msg: `连接成功，CID: ${data.data?.cid || ''}` });
    } catch (err) {
      setIpfsTestResult({ ok: false, msg: err.message });
    } finally {
      setTestingIpfs(false);
    }
  };

  const ipfsProviderLabel = { disabled: '禁用', local: '本地节点', pinata: 'Pinata 云端' };

  const card = (
    <div
      className="relative w-full max-w-[480px] rounded-[1.5rem] border border-stone-200 shadow-[0_22px_55px_rgba(0,0,0,0.25)]"
      style={{ background: '#F2EFE4' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-stone-200 px-5 py-4">
        {isModal ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700"
          >
            <XIcon className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        )}
          <div>
            <h1 className="text-sm font-bold text-slate-900">系统设置</h1>
            <p className="text-xs text-stone-500">配置签名密钥与 IPFS 存储</p>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 p-5">

          {/* ── Section 1: 签名密钥 ── */}
          <section className="rounded-2xl border border-stone-200 bg-[#F2EFE4]/60 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-300 bg-[#E8E4D8]">
                  <KeyIcon className="h-4 w-4 text-[#A47864]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">签名密钥</h2>
                  <p className="text-xs text-stone-400">用于签署链上操作许可证</p>
                </div>
              </div>
              {loadingStatus ? (
                <LoaderIcon className="mt-1 h-4 w-4 animate-spin text-stone-400" />
              ) : status ? (
                <StatusBadge
                  ok={status.hasSignerKey}
                  label={
                    status.hasSignerKey && status.signerAddress
                      ? `已配置 · ${status.signerAddress.slice(0, 6)}...${status.signerAddress.slice(-4)}`
                      : status.hasSignerKey ? '已配置' : '未配置'
                  }
                />
              ) : null}
            </div>

            <p className="mb-3 text-xs text-stone-500 leading-relaxed">
              填写部署合约时使用的钱包私钥，用于签署链上操作许可证。私钥仅保存在本地服务器，不会上传到任何云端。
            </p>

            {/* 当前已配置地址 */}
            {status?.hasSignerKey && status?.signerAddress && (
              <div className="mb-3 rounded-xl border border-stone-300 bg-[#F2EFE4] px-3 py-2">
                <p className="text-xs text-stone-400 mb-0.5">当前签名地址</p>
                <p className="font-mono text-xs text-slate-700 break-all">{status.signerAddress}</p>
              </div>
            )}

            {status?.hasSignerKey && privateKey.trim() && (
              <p className="mb-2 text-xs text-amber-600 font-medium">
                ⚠ 保存后将替换当前已配置的密钥
              </p>
            )}

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                className="w-full rounded-xl border border-stone-300 bg-[#F2EFE4] px-3 py-2.5 pr-10 text-sm text-slate-900 font-mono outline-none focus:border-stone-500 placeholder:text-stone-400"
                placeholder="0x 开头的 64 位十六进制私钥"
                value={privateKey}
                onChange={(e) => { setPrivateKey(e.target.value); setKeyError(null); setKeySuccess(false); }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                {showKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>

            {keyError && (
              <p className="mt-2 text-xs font-medium text-red-500">{keyError}</p>
            )}
            {keySuccess && (
              <p className="mt-2 text-xs font-medium text-emerald-600">
                ✓ 密钥已{status?.hasSignerKey ? '更新' : '保存'}，签名地址见上方
              </p>
            )}

            <button
              type="button"
              onClick={handleSaveKey}
              disabled={savingKey || !privateKey.trim()}
              className="btn-primary mt-3 inline-flex h-9 items-center gap-2 px-4 text-sm disabled:opacity-50"
            >
              {savingKey && <LoaderIcon className="h-3.5 w-3.5 animate-spin" />}
              {status?.hasSignerKey ? '更新密钥' : '保存密钥'}
            </button>

            <KeyGuide />
          </section>

          {/* ── Section 2: IPFS 存储 ── */}
          <section className="rounded-2xl border border-stone-200 bg-[#F2EFE4]/60 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-300 bg-[#E8E4D8]">
                  <ServerIcon className="h-4 w-4 text-[#A47864]" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">IPFS 存储</h2>
                  <p className="text-xs text-stone-400">配置去中心化文件存储节点</p>
                </div>
              </div>
              {loadingStatus ? (
                <LoaderIcon className="mt-1 h-4 w-4 animate-spin text-stone-400" />
              ) : status ? (
                <StatusBadge
                  ok={status.ipfsProvider !== 'disabled'}
                  label={ipfsProviderLabel[status.ipfsProvider] || status.ipfsProvider}
                />
              ) : null}
            </div>

            {/* Provider 选择 */}
            <div className="mb-3 flex gap-2">
              {['disabled', 'local', 'pinata'].map((p) => {
                const active = ipfsProvider === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setIpfsProvider(p); setIpfsResult(null); setIpfsTestResult(null); }}
                    className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#A47864]/40 bg-[#A47864]/10 text-[#A47864]'
                        : 'border-stone-300 bg-[#F2EFE4] text-slate-600 hover:bg-stone-100'
                    }`}
                  >
                    {p === 'disabled' ? '禁用' : p === 'local' ? '本地节点' : 'Pinata 云端'}
                  </button>
                );
              })}
            </div>

            {ipfsProvider === 'local' && (
              <p className="mb-3 text-xs text-stone-500 leading-relaxed">
                使用本机运行的 IPFS 节点（默认 API：<code className="rounded bg-stone-200 px-1 text-slate-700">http://127.0.0.1:5001</code>）。
                请确保 IPFS Kubo 或兼容实现已在本机启动。
              </p>
            )}

            {ipfsProvider === 'pinata' && (
              <div className="mb-3 space-y-2">
                <p className="text-xs text-stone-500 leading-relaxed">
                  使用{' '}
                  <a
                    href="https://pinata.cloud"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[#A47864] underline-offset-2 hover:underline"
                  >
                    Pinata 云端
                    <ExternalLinkIcon className="h-3 w-3" />
                  </a>{' '}
                  存储 IPFS 文件。请在 Pinata 控制台获取 API JWT 并填写到下方。
                </p>
                <div className="relative">
                  <input
                    type={showJwt ? 'text' : 'password'}
                    className="w-full rounded-xl border border-stone-300 bg-[#F2EFE4] px-3 py-2.5 pr-10 text-sm text-slate-900 font-mono outline-none focus:border-stone-500 placeholder:text-stone-400"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={pinataJwt}
                    onChange={(e) => setPinataJwt(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowJwt((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    {showJwt ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {ipfsProvider === 'disabled' && (
              <p className="mb-3 text-xs text-stone-500 leading-relaxed">
                IPFS 存储已禁用。房源快照将不会上传到 IPFS，链上合同将无法存储公开快照 CID。
              </p>
            )}

            {ipfsResult && (
              <p className={`mb-2 text-xs font-medium ${ipfsResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {ipfsResult.msg}
              </p>
            )}

            {ipfsTestResult && (
              <p className={`mb-2 text-xs font-medium ${ipfsTestResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {ipfsTestResult.ok ? `测试结果：${ipfsTestResult.msg}` : friendlyIpfsError(ipfsTestResult.msg)}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveIpfs}
                disabled={savingIpfs}
                className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm disabled:opacity-50"
              >
                {savingIpfs && <LoaderIcon className="h-3.5 w-3.5 animate-spin" />}
                保存配置
              </button>
              <button
                type="button"
                onClick={handleTestIpfs}
                disabled={testingIpfs || ipfsProvider === 'disabled'}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-stone-300 bg-[#F2EFE4] px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-stone-100 disabled:opacity-50"
              >
                {testingIpfs && <LoaderIcon className="h-3.5 w-3.5 animate-spin" />}
                测试连接
              </button>
            </div>
          </section>

        </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
        {card}
      </div>
    );
  }

  return <div className="mx-auto max-w-[480px] py-2">{card}</div>;
}
