import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from repo root: Next.js / Hardhat share a single .env file.
// Tries .env first, then .env.local (Next.js convention) — later file overrides earlier.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || '';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: 'cancun',
    },
  },
  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
  networks: {
    // Local Hardhat network for tests
    hardhat: {
      chainId: 31337,
    },
    // Ethereum Sepolia testnet — used for ZVault protocol deployments
    // Requires: SEPOLIA_RPC_URL (Alchemy/Infura) + SEPOLIA_PRIVATE_KEY (0x-prefixed)
    sepolia: {
      chainId: 11155111,
      url: SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || undefined,
  },
};

export default config;
