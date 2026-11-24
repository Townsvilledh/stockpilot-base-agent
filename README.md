# StockPilot — an autonomous agent for tokenized-stock finance

**Built for the Base "Stocks Maxxing Season" Builder Quest — Agentic Stock Finance track.**

StockPilot is an autonomous on-chain agent that keeps tokenized-stock prices honest. It watches AMM pools for mock tokenized stocks (tAAPL, tTSLA, tNVDA) on Base Sepolia, compares each pool's spot price against a real-world reference price held in an on-chain oracle, and — whenever a pool diverges by more than 0.8% — trades the pool back toward the reference price from its own wallet, booking the spread. No human clicks anything: the agent reads, decides, signs, and swaps by itself, and every decision is logged with its transaction hash.

> **Testnet honesty note.** Everything here runs on testnet with **mock assets**. The stock tokens are testnet-only mocks with no real-world value; they represent no real securities and confer no rights in Apple, Tesla, or NVIDIA. The reference prices are real market prices (snapshotted from public Finnhub data, 2026-11-24 18:06 UTC) so the agent's job — closing the gap between an on-chain price and the real-world price — is demonstrated against real numbers. This is a research prototype, not a product, not financial advice, and it does not enable trading for anyone.

## What the demo shows

A full run (`scripts/run-demo.js`) executes end to end:

1. Pools start priced exactly at the reference prices.
2. A separate, clearly-labelled **simulator wallet** trades the pools randomly, pushing prices 5–20% away from reference. (One disclosed simulator wallet generating price drift — not users, not traction.)
3. The agent detects each divergence and corrects it over several cycles: buying pools that are cheap vs. reference, selling pools that are rich, until divergences fall below its 0.8% threshold or its inventory runs out.
4. In the live Base Sepolia run (2026-11-24, log: `demo-run-live.log` in the submission pack) the agent executed **15 real on-chain swaps**, corrected AAPL from −5.94% to −0.50% and TSLA from −6.64% to −0.72% divergence, and finished with a positive mock P&L of **+$1,832.01** on an ~$84k mock portfolio — profit taken from the spread, exactly what a real basis-arbitrage agent earns. NVDA was pushed +10.49% rich; the agent sold into it until its tNVDA inventory ran out, so that pool's correction was partial (+10.11% at the end) — the inventory cap working as designed, disclosed here rather than hidden.

## Architecture

| Piece | File | Role |
|---|---|---|
| `MockERC20` | `contracts/MockERC20.sol` | Testnet mock tokens: mUSDC (6 dp) and the three mock stock tokens (18 dp). Public mint — testnet only, by design. |
| `ReferenceOracle` | `contracts/ReferenceOracle.sol` | Stores real-world USD reference prices per ticker (1e18-scaled). Keeper-set, every update is an auditable on-chain event. |
| `MiniAMM` | `contracts/MiniAMM.sol` | Minimal constant-product AMM (0.3% fee), one pool per stock token vs. mUSDC. Emits a `Swap` event per trade with the post-trade spot price. |
| Agent | `agent/agent.js` | The strategy loop: read oracle + AMM → compute divergence → size the trade (scales with \|divergence\|, capped) → execute the swap → log decision + tx hash. |
| Simulator | `scripts/simulate.js` | Disclosed drift generator: one wallet making random-sized trades so the agent has divergence to correct. |
| Deploy | `scripts/deploy.js` | Deploys everything, seeds pools at reference prices, funds the agent (50,000 mUSDC + 40 of each stock token as sellable inventory) and the simulator. Writes `deployments.json`. |

Strategy parameters (in `agent/agent.js`): divergence threshold 0.8%, trade size = \|divergence\| × 60,000 mUSDC clamped to [200, 3,000] mUSDC, 2% slippage tolerance, sells capped at 60% of the held position per cycle.

## Run it

Prerequisites: Node 20+, three funded testnet wallets (deployer / agent / simulator) in a keys file — see `KEYS_FILE` below. On Base Sepolia the deployer needs a small amount of testnet ETH (faucet); the deploy script tops up the other two wallets itself.

```bash
npm install
npm run compile          # solc-js -> artifacts/

# keys file: JSON { deployer: {address, privateKey}, agent: {...}, simulator: {...} }
export KEYS_FILE=/path/to/keys.json
export RPC_URL=https://sepolia.base.org   # default

npm run deploy           # contracts + oracle prices + seeded pools -> deployments.json
npm run demo             # simulator drift + agent correction, full narration
npm run agent            # or: run the agent loop standalone (6 cycles)
npm run simulate         # or: run a simulator burst standalone
```

`RPC_URL` can point at any EVM node with chain ID 84532 (e.g. a local rehearsal node) — the same scripts run unchanged.

## Deployments

Source of truth: `deployments.json` (written by `scripts/deploy.js` on every deploy).

**LIVE deployment — Base Sepolia** (chain ID 84532, deployed 2026-11-24; a rehearsal on a local node with the identical scripts preceded it):

| Contract | Address | Deploy tx |
|---|---|---|
| mUSDC (mock) | [`0xdb2ec11357d013d4792e5916bfc9e7b093460c26`](https://sepolia.basescan.org/address/0xdb2ec11357d013d4792e5916bfc9e7b093460c26) | `0xe321270f35eab1d0f233caa5d9c70cce3d1826f2fa20b3e5ff14cb5a403bfb2b` |
| tAAPL (mock) | [`0xab67a46184d1eb08b0eb38dde9bbafaa27e737ea`](https://sepolia.basescan.org/address/0xab67a46184d1eb08b0eb38dde9bbafaa27e737ea) | `0xf1f4626cfc279e187533ec03f3fb63443dbe7afc39402200f5b918df97a1a5fd` |
| tTSLA (mock) | [`0x2f16d9b574c0002f06a7d159fb2a543895636efe`](https://sepolia.basescan.org/address/0x2f16d9b574c0002f06a7d159fb2a543895636efe) | `0xeae38047141dbb748cf08c4f9d93d619b971ece7ab8bef0ac711f79a1be371f9` |
| tNVDA (mock) | [`0x12ab65c96c281a3a089c09dc6e686bf7d101cd22`](https://sepolia.basescan.org/address/0x12ab65c96c281a3a089c09dc6e686bf7d101cd22) | `0x2e089f7560fdd3c28204f2eec5e9e6518e79975d59d95bb1848e6e41fab4c277` |
| ReferenceOracle | [`0x588e4e75ca32f4d793aec0f0e8b4cb9f086e7fc8`](https://sepolia.basescan.org/address/0x588e4e75ca32f4d793aec0f0e8b4cb9f086e7fc8) | `0x844243297a8e614ca29fb1ccd4cb3ec331882fc30297f9ae4b56457e0b89cd96` |
| MiniAMM | [`0xc667169c9c7b9e7c5f6a84829aa32df9d28cb299`](https://sepolia.basescan.org/address/0xc667169c9c7b9e7c5f6a84829aa32df9d28cb299) | `0xdbbe9efcef2506f897cd6e559c9074332dc073306dbbec6004ad3e81f82f3b56` |

The live demo run against these contracts (15 agent swaps, blocks 63126846–63127006) is recorded in the submission pack as `demo-run-live.log` with the video cut `stockpilot-demo-live.mp4`.

Wallets: deployer `0xE572DE84e3e5bceD291c55C88C947997cE66D706` · agent `0xD7C2C5a367b1aaFAfDE399538B8347A3af201CF9` · simulator `0x3D9167121882CadDaBBeEAFD75f5af44F628CC4c`.

Reference prices seeded (Finnhub snapshot, 2026-11-24 18:06 UTC): AAPL $353.57 · TSLA $384.47 · NVDA $153.18.

## Where this goes next

On mainnet, the same agent points at real tokenized-stock venues: the oracle becomes a feed of real reference prices, the MiniAMM is replaced by the venue's pools/order books, and the agent's job — closing the basis between on-chain tokenized stocks and the real market, 24/7, including when the stock market is closed — stays exactly the same. Tokenized stocks trade around the clock; their prices drift most when the underlying market is shut. An agent that never sleeps is the natural market-maker for that gap.

## License

MIT
