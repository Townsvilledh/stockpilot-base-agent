// Orchestrated end-to-end demo used for the recording:
//   snapshot -> simulator drift -> agent corrects -> more drift -> agent corrects -> summary
const lib = require('./lib');
const { buildAgent, runCycle, portfolioValue } = require('../agent/agent');
const { buildSim, burst } = require('./simulate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const d = lib.loadDeployments();
  const agent = await buildAgent();
  const sim = await buildSim();

  console.log('='.repeat(100));
  console.log('StockPilot — autonomous agent for tokenized-stock finance');
  console.log(`Network: chain ${d.chainId} via ${d.rpc}`);
  console.log(`AMM ${d.amm} | Oracle ${d.oracle} | mUSDC ${d.usdc}`);
  console.log(`Agent wallet ${d.wallets.agent} | Simulator wallet ${d.wallets.simulator}`);
  console.log('Assets are TESTNET MOCKS (tAAPL / tTSLA / tNVDA + mUSDC) — no real securities, no real value.');
  console.log('Strategy: when a pool price diverges >0.8% from the real-world reference price,');
  console.log('the agent trades the pool back toward the reference and books the spread.');
  console.log('='.repeat(100));

  const { value: v0, states } = await portfolioValue(agent);
  console.log(`[DEMO] initial portfolio $${lib.fmtUsd(v0)}`);
  for (const st of states) {
    console.log(`[DEMO] ${st.s.symbol}: AMM $${lib.fmtUsd(st.spot)} vs ref $${lib.fmtUsd(st.ref)} (div ${(((st.spot - st.ref) / st.ref) * 100).toFixed(2)}%)`);
  }

  console.log('\n[DEMO] --- Phase 1: market simulator pushes prices away from reference ---');
  await burst(sim, 5, console.log, 11);
  await sleep(1000);

  console.log('\n[DEMO] --- Phase 2: agent corrects the divergence ---');
  for (let i = 1; i <= 4; i++) { await runCycle(agent, i); await sleep(1200); }

  console.log('\n[DEMO] --- Phase 3: simulator drifts prices again ---');
  await burst(sim, 4, console.log, 97);
  await sleep(1000);

  console.log('\n[DEMO] --- Phase 4: agent corrects again ---');
  for (let i = 5; i <= 8; i++) { await runCycle(agent, i); await sleep(1200); }

  const { value: vEnd, states: endStates } = await portfolioValue(agent);
  console.log('\n' + '='.repeat(100));
  console.log(`[DEMO] SUMMARY: agent trades executed: ${agent.trades}`);
  console.log(`[DEMO] portfolio: start $${lib.fmtUsd(agent.startValue ?? v0)} -> end $${lib.fmtUsd(vEnd)} (mock P&L $${lib.fmtUsd(vEnd - (agent.startValue ?? v0))})`);
  for (const st of endStates) {
    console.log(`[DEMO] final ${st.s.symbol}: AMM $${lib.fmtUsd(st.spot)} vs ref $${lib.fmtUsd(st.ref)} (div ${(((st.spot - st.ref) / st.ref) * 100).toFixed(2)}%) | agent holds ${lib.fmtUsd(st.stock, 4)} ${st.s.tokenSymbol}`);
  }
  console.log('[DEMO] every trade above is a real on-chain swap, verifiable in the AMM Swap events.');
  console.log('='.repeat(100));
}

main().catch((e) => { console.error(e); process.exit(1); });
