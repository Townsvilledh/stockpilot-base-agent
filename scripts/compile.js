// Compile contracts with solc-js into artifacts/<Name>.json { abi, bytecode }.
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const contractsDir = path.join(__dirname, '..', 'contracts');
const artifactsDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

const files = fs.readdirSync(contractsDir).filter((f) => f.endsWith('.sol'));
const sources = {};
for (const f of files) sources[f] = { content: fs.readFileSync(path.join(contractsDir, f), 'utf8') };

const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  for (const e of output.errors) {
    console.log(e.severity.toUpperCase(), e.formattedMessage);
    if (e.severity === 'error') process.exitCode = 1;
  }
}
if (process.exitCode) process.exit(1);

for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    fs.writeFileSync(
      path.join(artifactsDir, `${name}.json`),
      JSON.stringify({ contractName: name, sourceFile: file, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2)
    );
    console.log('compiled', name, 'bytecode bytes:', c.evm.bytecode.object.length / 2);
  }
}
