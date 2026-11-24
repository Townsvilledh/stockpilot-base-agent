// StockPilot agent — divergence-arbitrage strategy.
//
// Every cycle, for each mock stock pool:
//   1. read the reference price from the on-chain ReferenceOracle
//   2. read the AMM spot price from MiniAMM
//   3. divergence = (amm - ref) / ref
//   4. AMM cheap (div < -0.8%): BUY the stock token with mUSDC
//      AMM rich  (div > +0.8%): SELL the stock token for mUSDC
//      otherwise: HOLD
// Trade size scales with |divergence| and is capped; every trade is a real
// on-chain swap from the agent's own wallet, logged with its tx hash.
const fs = require('fs');
const path = require('path');
const lib = require('../scripts/lib');

const THRESHOLD = 0.008;      // 0.8% minimum divergence to act
const MIN_TRADE = 200;        // mUSDC
const MAX_TRADE = 3000;       // mUSDC per trade
const SIZE_FACTOR = 60000;    // notional = |div| * SIZE_FACTOR, clamped

async function buildAgent() {
  const d = lib.loadDeployments();
  const { pub, wallet, account } = await lib.makeClients('agent');
  const erc20 = lib.artifact('MockERC20').abi;
  const ammAbi = lib.artifact('MiniAMM').abi;
  const oracleAbi = lib.artifact('ReferenceOracle').abi;
  return { d, pub, wallet, account, erc20, ammAbi, oracleAbi, startValue: null, trades: 0 };
}

async function readTokenState(a, s) {
  const token = a.d.tokens[s.symbol];
  const [refRaw, spotRaw, usdcBal, stockBal] = await Promise.all([
    a.pub.readContract({ address: a.d.oracle, abi: a.oracleAbi, functionName: 'getPrice', args: [s.symbol] }),
    a.pub.readContract({ address: a.d.amm, abi: a.ammAbi, functionName: 'spotPrice1e18', args: [token] }),
    a.pub.readContract({ address: a.d.usdc, abi: a.erc20, functionName: 'balanceOf', args: [a.account.address] }),
    a.pub.readContract({ address: token, abi: a.erc20, functionName: 'balanceOf', args: [a.account.address] }),
  ]);
  return {
    s, token,
    ref: lib.priceFromRaw(refRaw),
    spot: lib.priceFromRaw(spotRaw),
    usdc: lib.fromUsdc(usdcBal),
    stock: lib.fromStock(stockBal),
  };
}

async function portfolioValue(a) {
  const states = [];
  let v = 0;
  for (const s of lib.STOCKS) {
    const st = await readTokenState(a, s);
    states.push(st);
    v += st.stock * st.spot;
  }
  v += states.length ? states[0].usdc : 0; // mUSDC balance counted once
  return { value: v, states };
}

async function ensureApproval(a, token, amount) {
  const allowance = await a.pub.readContract({
    address: token, abi: a.erc20, functionName: 'allowance', args: [a.account.address, a.d.amm],
  });
  if (allowance < amount) {
    const hash = await a.wallet.writeContract({
      address: token, abi: a.erc20, functionName: 'approve', args: [a.d.amm, amount * 100n],
    });
    await a.pub.waitForTransactionReceipt({ hash });
  }
}

async function runCycle(a, cycleNum, log = console.log) {
  const { value, states } = await portfolioValue(a);
  if (a.startValue === null) a.startValue = value;
  log(`[AGENT] cycle ${cycleNum} | portfolio $${lib.fmtUsd(value)} (start $${lib.fmtUsd(a.startValue)}, P&L $${lib.fmtUsd(value - a.startValue)})`);
  for (const st of states) {
    const div = (st.spot - st.ref) / st.ref;
    const divPct = (div * 100).toFixed(2);
    const head = `[AGENT] ${st.s.symbol}: ref $${lib.fmtUsd(st.ref)} | AMM $${lib.fmtUsd(st.spot)} | div ${divPct}%`;
    if (Math.abs(div) < THRESHOLD) {
      log(`${head} | HOLD`);
      continue;
    }
    const notional = Math.min(MAX_TRADE, Math.max(MIN_TRADE, Math.abs(div) * SIZE_FACTOR));
    try {
      if (div < 0) {
        const spend = Math.min(notional, st.usdc);
        if (spend < 10) { log(`${head} | BUY skipped (low mUSDC)`); continue; }
        await ensureApproval(a, a.d.usdc, lib.toUsdc(spend.toFixed(2)));
        const expected = await a.pub.readContract({
          address: a.d.amm, abi: a.ammAbi, functionName: 'getAmountOut',
          args: [lib.toUsdc(spend.toFixed(2)), ...(await reserves(a, st))],
        });
        const minOut = (expected * 98n) / 100n;
        const hash = await a.wallet.writeContract({
          address: a.d.amm, abi: a.ammAbi, functionName: 'swapUsdcForStock',
          args: [st.token, lib.toUsdc(spend.toFixed(2)), minOut],
        });
        const rcpt = await a.pub.waitForTransactionReceipt({ hash });
        a.trades++;
        log(`${head} | BUY $${lib.fmtUsd(spend)} mUSDC -> ${lib.fmtUsd(lib.fromStock(expected), 4)} ${st.s.tokenSymbol} | tx ${hash} (block ${rcpt.blockNumber})`);
      } else {
        const heldValue = st.stock * st.spot;
        const sellValue = Math.min(notional, heldValue * 0.6);
        if (sellValue < 10) { log(`${head} | SELL skipped (low holdings)`); continue; }
        const stockAmt = sellValue / st.spot;
        await ensureApproval(a, st.token, lib.toStock(stockAmt.toFixed(6)));
        const [usdcReserve, stockReserve] = await reserves(a, st);
        const expected = await a.pub.readContract({
          address: a.d.amm, abi: a.ammAbi, functionName: 'getAmountOut',
          args: [lib.toStock(stockAmt.toFixed(6)), stockReserve, usdcReserve],
        });
        const minOut = (expected * 98n) / 100n;
        const hash = await a.wallet.writeContract({
          address: a.d.amm, abi: a.ammAbi, functionName: 'swapStockForUsdc',
          args: [st.token, lib.toStock(stockAmt.toFixed(6)), minOut],
        });
        const rcpt = await a.pub.waitForTransactionReceipt({ hash });
        a.trades++;
        log(`${head} | SELL ${lib.fmtUsd(stockAmt, 4)} ${st.s.tokenSymbol} (~$${lib.fmtUsd(sellValue)}) | tx ${hash} (block ${rcpt.blockNumber})`);
      }
    } catch (e) {
      log(`${head} | trade failed: ${e.shortMessage || e.message}`);
    }
  }
  return value;
}

async function reserves(a, st) {
  const p = await a.pub.readContract({ address: a.d.amm, abi: a.ammAbi, functionName: 'pools', args: [st.token] });
  // pools() returns [stockReserve, usdcReserve, stockDecimals, exists]
  return [p[1], p[0]]; // [usdcReserve, stockReserve] for getAmountOut(usdcIn,...)
}

async function main() {
  const cycles = Number(process.argv[2] || 6);
  const intervalSec = Number(process.argv[3] || 5);
  const a = await buildAgent();
  console.log(`[AGENT] StockPilot live. wallet ${a.account.address}`);
  const logFile = path.join(lib.ROOT, 'logs', 'agent-log.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  for (let i = 1; i <= cycles; i++) {
    const v = await runCycle(a, i);
    fs.appendFileSync(logFile, JSON.stringify({ cycle: i, ts: new Date().toISOString(), value: v, trades: a.trades }) + '\n');
    if (i < cycles) await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
  console.log(`[AGENT] done. trades executed: ${a.trades}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildAgent, runCycle, portfolioValue };
