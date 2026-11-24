// Market simulator — a separate wallet that trades the mock pools in random
// directions/sizes, pushing AMM prices away from the reference oracle. This
// creates the divergence the StockPilot agent exists to correct. It is a
// price-drift generator for the testnet demo, NOT fake users or traction:
// it is one labelled simulator wallet, disclosed in the README.
const lib = require('./lib');

async function buildSim() {
  const d = lib.loadDeployments();
  const { pub, wallet, account } = await lib.makeClients('simulator');
  return {
    d, pub, wallet, account,
    erc20: lib.artifact('MockERC20').abi,
    ammAbi: lib.artifact('MiniAMM').abi,
    oracleAbi: lib.artifact('ReferenceOracle').abi,
  };
}

async function ensureApproval(sim, token, amount) {
  const allowance = await sim.pub.readContract({
    address: token, abi: sim.erc20, functionName: 'allowance', args: [sim.account.address, sim.d.amm],
  });
  if (allowance < amount) {
    const hash = await sim.wallet.writeContract({
      address: token, abi: sim.erc20, functionName: 'approve', args: [sim.d.amm, amount * 100n],
    });
    await sim.pub.waitForTransactionReceipt({ hash });
  }
}

// Deterministic-ish pseudo random with seed so demo runs are reproducible.
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

async function burst(sim, n, log = console.log, seed = 42) {
  const rand = rng(seed + n * 7919);
  for (let i = 0; i < n; i++) {
    const s = lib.STOCKS[Math.floor(rand() * lib.STOCKS.length)];
    const token = sim.d.tokens[s.symbol];
    const usdcSize = 2500 + rand() * 6500; // $2.5k-$9k notional
    const buy = rand() > 0.45;
    try {
      if (buy) {
        await ensureApproval(sim, sim.d.usdc, lib.toUsdc(usdcSize.toFixed(2)));
        const hash = await sim.wallet.writeContract({
          address: sim.d.amm, abi: sim.ammAbi, functionName: 'swapUsdcForStock',
          args: [token, lib.toUsdc(usdcSize.toFixed(2)), 0n],
        });
        await sim.pub.waitForTransactionReceipt({ hash });
      } else {
        const spotRaw = await sim.pub.readContract({ address: sim.d.amm, abi: sim.ammAbi, functionName: 'spotPrice1e18', args: [token] });
        const spot = lib.priceFromRaw(spotRaw);
        const stockAmt = usdcSize / spot;
        await ensureApproval(sim, token, lib.toStock(stockAmt.toFixed(6)));
        const hash = await sim.wallet.writeContract({
          address: sim.d.amm, abi: sim.ammAbi, functionName: 'swapStockForUsdc',
          args: [token, lib.toStock(stockAmt.toFixed(6)), 0n],
        });
        await sim.pub.waitForTransactionReceipt({ hash });
      }
      const [spotRaw, refRaw] = await Promise.all([
        sim.pub.readContract({ address: sim.d.amm, abi: sim.ammAbi, functionName: 'spotPrice1e18', args: [token] }),
        sim.pub.readContract({ address: sim.d.oracle, abi: sim.oracleAbi, functionName: 'getPrice', args: [s.symbol] }),
      ]);
      const spot = lib.priceFromRaw(spotRaw);
      const ref = lib.priceFromRaw(refRaw);
      const div = ((spot - ref) / ref) * 100;
      log(`[SIM] ${buy ? 'BUY ' : 'SELL'} $${lib.fmtUsd(usdcSize)} ${s.symbol} -> AMM $${lib.fmtUsd(spot)} vs ref $${lib.fmtUsd(ref)} (div ${div.toFixed(2)}%)`);
    } catch (e) {
      log(`[SIM] trade failed: ${e.shortMessage || e.message}`);
    }
  }
}

async function main() {
  const n = Number(process.argv[2] || 5);
  const sim = await buildSim();
  console.log(`[SIM] simulator wallet ${sim.account.address}`);
  await burst(sim, n);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildSim, burst };
