import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { CONTRACT_ADDRESS, SUPPORTED_CHAIN_ID } from '../utils/contractConfig';
import CampusTradeABI from '../utils/CampusTradeABI.json';

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [chainId, setChainId] = useState(null);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [error, setError] = useState(null);

  const initContract = useCallback(async (signerInstance) => {
    try {
      const contractInstance = new ethers.Contract(
        CONTRACT_ADDRESS,
        CampusTradeABI,
        signerInstance
      );
      setContract(contractInstance);
      return contractInstance;
    } catch (err) {
      console.error("合约初始化失败:", err);
      setError("合约初始化失败");
      return null;
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xAA36A7" }], // Sepolia 11155111
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xAA36A7",
              chainName: "Sepolia Testnet",
              nativeCurrency: { name: "SepoliaETH", symbol: "SepoliaETH", decimals: 18 },
              rpcUrls: ["https://rpc.sepolia.org", "https://rpc2.sepolia.org"],
            }],
          });
        } catch (addError) {
          toast.error("添加网络失败");
        }
      }
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      toast.error("请安装 MetaMask 钱包!");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);

      if (accounts.length > 0) {
        const network = await browserProvider.getNetwork();
        const chainIdNum = Number(network.chainId);
        setChainId(chainIdNum);
        setIsCorrectNetwork(chainIdNum === SUPPORTED_CHAIN_ID);

        const signerInstance = await browserProvider.getSigner();
        setProvider(browserProvider);
        setSigner(signerInstance);
        setAccount(accounts[0]);

        await initContract(signerInstance);

        // 监听账户变化
        window.ethereum.on("accountsChanged", (newAccounts) => {
          if (newAccounts.length === 0) {
            disconnectWallet();
          } else {
            setAccount(newAccounts[0]);
            window.location.reload();
          }
        });

        // 监听网络变化
        window.ethereum.on("chainChanged", () => {
          window.location.reload();
        });
      }
    } catch (err) {
      console.error("连接钱包失败:", err);
      setError(err.message);
      toast.error("连接钱包失败");
    } finally {
      setIsConnecting(false);
    }
  }, [initContract]);

  const disconnectWallet = useCallback(() => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setContract(null);
    setChainId(null);
  }, []);

  // 自动连接
  useEffect(() => {
    if (window.ethereum && window.ethereum.selectedAddress) {
      connectWallet();
    }
  }, []);

  const value = {
    account,
    provider,
    signer,
    contract,
    isConnecting,
    chainId,
    isCorrectNetwork,
    error,
    connectWallet,
    disconnectWallet,
    switchNetwork,
  };

  return (
    <Web3Context.Provider value={value}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error("useWeb3 must be used within Web3Provider");
  }
  return context;
}
