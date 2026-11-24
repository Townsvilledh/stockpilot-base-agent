// Shared helpers: config, clients, keys, artifacts.
const fs = require('fs');
const path = require('path');
const { createPublicClient, createWalletClient, http, defineChain, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const ROOT = path.join(__dirname, '..');
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const KEYS_FILE =
  process.env.KEYS_FILE || path.join(ROOT, '..', '.keys', 'keys.json');

// Reference prices (USD) snapshotted from public market data (Finnhub quote
// snapshot, 2026-11-24 18:06 UTC). Used only to seed the testnet oracle.
const REFERENCE_PRICES = { AAPL: 353.57, TSLA: 384.47, NVDA: 153.18 };

const STOCKS = [
  { symbol: 'AAPL', tokenName: 'Apple Test Stock Token (TESTNET MOCK)', tokenSymbol: 'tAAPL' },
  { symbol: 'TSLA', tokenName: 'Tesla Test Stock Token (TESTNET MOCK)', tokenSymbol: 'tTSLA' },
  { symbol: 'NVDA', tokenName: 'NVIDIA Test Stock Token (TESTNET MOCK)', tokenSymbol: 'tNVDA' },
];

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error(`keys file not found: ${KEYS_FILE} (set KEYS_FILE or provide deployer/agent/simulator keys)`);
  }
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', `${name}.json`), 'utf8'));
}

async function rpcChainId() {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const j = await res.json();
  return parseInt(j.result, 16);
}

async function makeClients(role) {
  const keys = loadKeys();
  const id = await rpcChainId();
  const chain = defineChain({
    id,
    name: id === 84532 ? 'Base Sepolia' : `Chain ${id}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const account = privateKeyToAccount(keys[role].privateKey);
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  return { pub, wallet, account, chain };
}

function deploymentsPath() {
  return path.join(ROOT, 'deployments.json');
}
function loadDeployments() {
  return JSON.parse(fs.readFileSync(deploymentsPath(), 'utf8'));
}
function saveDeployments(d) {
  fs.writeFileSync(deploymentsPath(), JSON.stringify(d, null, 2));
}

const fmtUsd = (n, dp = 2) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const toUsdc = (human) => parseUnits(String(human), 6);
const toStock = (human) => parseUnits(String(human), 18);
const fromUsdc = (raw) => Number(formatUnits(raw, 6));
const fromStock = (raw) => Number(formatUnits(raw, 18));
const priceToRaw = (usd) => parseUnits(String(usd), 18);
const priceFromRaw = (raw) => Number(formatUnits(raw, 18));

module.exports = {
  ROOT, RPC_URL, KEYS_FILE, REFERENCE_PRICES, STOCKS,
  loadKeys, artifact, makeClients, loadDeployments, saveDeployments,
  fmtUsd, toUsdc, toStock, fromUsdc, fromStock, priceToRaw, priceFromRaw,
};
