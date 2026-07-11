import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import solc from 'solc';

const root = process.cwd();
const contractFile = 'contracts/TrafficPredictionMarket.sol';
const source = fs.readFileSync(path.join(root, contractFile), 'utf8');
const input = {
  language: 'Solidity',
  sources: { [contractFile]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

function findImports(importPath) {
  for (const candidate of [path.join(root, importPath), path.join(root, 'node_modules', importPath)]) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, 'utf8') };
  }
  return { error: `Import not found: ${importPath}` };
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error.formattedMessage}\n`);
  process.exit(1);
}

const compiled = output.contracts[contractFile].TrafficPredictionMarket;
const artifact = {
  contractName: 'TrafficPredictionMarket',
  compiler: solc.version(),
  chainId: 421614,
  admin: '0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e',
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
};
const outputDirectory = path.join(root, 'public', 'contracts');
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'TrafficPredictionMarket.json'), `${JSON.stringify(artifact, null, 2)}\n`);
