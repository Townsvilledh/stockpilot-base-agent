// Deploy StockPilot to the configured RPC (default: Base Sepolia).
// Deployer funds everything; agent + simulator wallets are topped up with
// testnet ETH and mock assets. Writes deployments.json.
const { parseEther } = require('viem');
const lib = require('./lib');

async function send(pub, wallet, params) {
  const hash = await wallet.writeContract(params);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`tx failed: ${hash}`);
  return { hash, rcpt };
}

async function deploy(pub, wallet, name, args) {
  const a = lib.artifact(name);
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`deploy failed: ${name}`);
  console.log(`[deploy] ${name} -> ${rcpt.contractAddress} (tx ${hash})`);
  return rcpt.contractAddress;
}

async function main() {
  const { pub, wallet, account } = await lib.makeClients('deployer');
  const keys = lib.loadKeys();
  const chainId = await pub.getChainId();
  const bal = await pub.getBalance({ address: account.address });
  console.log(`[deploy] chain ${chainId}, deployer ${account.address}, ETH balance ${Number(bal) / 1e18}`);
  if (bal === 0n) throw new Error('deployer has 0 ETH — fund it with testnet ETH first');

  // 1. Tokens
  const usdc = await deploy(pub, wallet, 'MockERC20', ['Mock USD Coin (TESTNET)', 'mUSDC', 6]);
  const tokens = {};
  for (const s of lib.STOCKS) {
    tokens[s.symbol] = await deploy(pub, wallet, 'MockERC20', [s.tokenName, s.tokenSymbol, 18]);
  }

  // 2. Oracle + reference prices
  const oracle = await deploy(pub, wallet, 'ReferenceOracle', []);
  const oracleAbi = lib.artifact('ReferenceOracle').abi;
  for (const s of lib.STOCKS) {
    const { hash } = await send(pub, wallet, {
      address: oracle, abi: oracleAbi, functionName: 'setPrice',
      args: [s.symbol, lib.priceToRaw(lib.REFERENCE_PRICES[s.symbol])],
    });
    console.log(`[deploy] oracle ${s.symbol} = $${lib.REFERENCE_PRICES[s.symbol]} (tx ${hash})`);
  }

  // 3. AMM
  const amm = await deploy(pub, wallet, 'MiniAMM', [usdc]);
  const erc20 = lib.artifact('MockERC20').abi;
  const ammAbi = lib.artifact('MiniAMM').abi;

  // 4. Mint mock assets to deployer
  await send(pub, wallet, { address: usdc, abi: erc20, functionName: 'mint', args: [account.address, lib.toUsdc(2000000)] });
  for (const s of lib.STOCKS) {
    await send(pub, wallet, { address: tokens[s.symbol], abi: erc20, functionName: 'mint', args: [account.address, lib.toStock(200000)] });
  }
  console.log('[deploy] minted mock USDC + stock tokens to deployer');

  // 5. Seed liquidity at oracle prices: 200,000 mUSDC per pool
  for (const s of lib.STOCKS) {
    const ref = lib.REFERENCE_PRICES[s.symbol];
    const stockWhole = (200000 / ref).toFixed(6);
    await send(pub, wallet, { address: usdc, abi: erc20, functionName: 'approve', args: [amm, lib.toUsdc(200000)] });
    await send(pub, wallet, { address: tokens[s.symbol], abi: erc20, functionName: 'approve', args: [amm, lib.toStock(stockWhole)] });
    const { hash } = await send(pub, wallet, {
      address: amm, abi: ammAbi, functionName: 'addLiquidity',
      args: [tokens[s.symbol], lib.toStock(stockWhole), lib.toUsdc(200000)],
    });
    const spot = await pub.readContract({ address: amm, abi: ammAbi, functionName: 'spotPrice1e18', args: [tokens[s.symbol]] });
    console.log(`[deploy] pool ${s.symbol}: seeded ${stockWhole} ${s.tokenSymbol} + 200,000 mUSDC, spot $${lib.fmtUsd(lib.priceFromRaw(spot))} (tx ${hash})`);
  }

  // 6. Fund agent + simulator
  for (const role of ['agent', 'simulator']) {
    const addr = keys[role].address;
    const b = await pub.getBalance({ address: addr });
    if (b < parseEther('0.002')) {
      const hash = await wallet.sendTransaction({ to: addr, value: parseEther('0.005') });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`[deploy] sent 0.005 testnet ETH to ${role} ${addr}`);
    }
  }
  await send(pub, wallet, { address: usdc, abi: erc20, functionName: 'transfer', args: [keys.agent.address, lib.toUsdc(50000)] });
  await send(pub, wallet, { address: usdc, abi: erc20, functionName: 'transfer', args: [keys.simulator.address, lib.toUsdc(60000)] });
  for (const s of lib.STOCKS) {
    await send(pub, wallet, { address: tokens[s.symbol], abi: erc20, functionName: 'mint', args: [keys.simulator.address, lib.toStock(20000)] });
    // The agent holds starting inventory of each stock so it can also SELL
    // into rich pools, not only buy cheap ones.
    await send(pub, wallet, { address: tokens[s.symbol], abi: erc20, functionName: 'mint', args: [keys.agent.address, lib.toStock(40)] });
  }
  console.log('[deploy] agent funded: 50,000 mUSDC + 40 of each stock token | simulator funded: 60,000 mUSDC + 20,000 of each stock token');

  lib.saveDeployments({
    chainId,
    rpc: lib.RPC_URL,
    deployedAt: new Date().toISOString(),
    usdc,
    oracle,
    amm,
    tokens,
    wallets: { deployer: keys.deployer.address, agent: keys.agent.address, simulator: keys.simulator.address },
    referencePrices: lib.REFERENCE_PRICES,
  });
  console.log('[deploy] wrote deployments.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
