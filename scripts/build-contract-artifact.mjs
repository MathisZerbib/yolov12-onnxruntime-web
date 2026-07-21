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
const outputDirectory = path.join(root, 'public', 'contracts');
fs.mkdirSync(outputDirectory, { recursive: true });

const implArtifact = {
  contractName: 'TrafficPredictionMarket',
  compiler: solc.version(),
  chainId: 421614,
  admin: '0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e',
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
};
fs.writeFileSync(path.join(outputDirectory, 'TrafficPredictionMarket.json'), `${JSON.stringify(implArtifact, null, 2)}\n`);

const prebuiltProxy = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@openzeppelin', 'contracts', 'build', 'contracts', 'ERC1967Proxy.json'), 'utf8'));
const proxyArtifact = {
  contractName: 'ERC1967Proxy',
  compiler: solc.version(),
  chainId: 421614,
  admin: '0x2a1F44Ce3759b8624aD8b5828efEe2Dd370DCa1e',
  abi: prebuiltProxy.abi,
  bytecode: prebuiltProxy.bytecode.startsWith('0x') ? prebuiltProxy.bytecode : `0x${prebuiltProxy.bytecode}`,
  deployedBytecode: prebuiltProxy.deployedBytecode.startsWith('0x') ? prebuiltProxy.deployedBytecode : `0x${prebuiltProxy.deployedBytecode}`,
};
fs.writeFileSync(path.join(outputDirectory, 'ERC1967Proxy.json'), `${JSON.stringify(proxyArtifact, null, 2)}\n`);
