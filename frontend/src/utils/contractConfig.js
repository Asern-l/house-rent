// 合约配置 - 部署到 Sepolia 后替换为实际地址
// 部署后从 deployments-sepolia.json 获取
export const CONTRACT_ADDRESS = "0xe9C91b694110A64622f03024E057FA8cceB790f9";

export const NETWORK_CONFIG = {
  chainId: "0xAA36A7", // 11155111
  chainName: "Sepolia Testnet",
  nativeCurrency: {
    name: "SepoliaETH",
    symbol: "SepoliaETH",
    decimals: 18,
  },
  rpcUrls: [
    "https://rpc.sepolia.org",
    "https://sepolia.infura.io/v3/",
    "https://rpc2.sepolia.org",
  ],
};

export const SUPPORTED_CHAIN_ID = 11155111;

export const CATEGORIES = [
  { id: "all", label: "全部", icon: "🔍" },
  { id: "textbook", label: "教材", icon: "📚" },
  { id: "electronics", label: "数码", icon: "📱" },
  { id: "daily", label: "日用", icon: "🏠" },
  { id: "clothing", label: "服饰", icon: "👔" },
  { id: "sports", label: "运动", icon: "⚽" },
  { id: "transport", label: "出行", icon: "🚲" },
  { id: "other", label: "其他", icon: "📦" },
];

export const ORDER_STATUS_MAP = {
  0: { label: "待支付", color: "badge-gray" },
  1: { label: "已支付", color: "badge-blue" },
  2: { label: "已发货", color: "badge-yellow" },
  3: { label: "已收货", color: "badge-green" },
  4: { label: "已完成", color: "badge-green" },
  5: { label: "已取消", color: "badge-gray" },
  6: { label: "纠纷中", color: "badge-red" },
  7: { label: "已退款", color: "badge-red" },
};
