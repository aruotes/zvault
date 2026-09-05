import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const FileRegistryModule = buildModule('FileRegistryModule', (m) => {
  const registry = m.contract('FileRegistry', []);

  return { registry };
});

export default FileRegistryModule;
