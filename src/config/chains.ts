export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

const BASE_MAINNET_EXPLORER = 'https://basescan.org';
const BASE_SEPOLIA_EXPLORER = 'https://sepolia.basescan.org';

export function explorerTxUrl(chainId: number, txHash: `0x${string}`): string {
  const base = chainId === BASE_SEPOLIA_CHAIN_ID ? BASE_SEPOLIA_EXPLORER : BASE_MAINNET_EXPLORER;
  return `${base}/tx/${txHash}`;
}

export function explorerAddressUrl(chainId: number, address: `0x${string}`): string {
  const base = chainId === BASE_SEPOLIA_CHAIN_ID ? BASE_SEPOLIA_EXPLORER : BASE_MAINNET_EXPLORER;
  return `${base}/address/${address}`;
}
