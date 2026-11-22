import { defineConfig } from '@solidcash/solidhat/config';

// Native SolidCash mode (no evmCompat): compact Script ABI and sha256 selectors.
// The mock network enforces real BCH mainnet limits so a green test means a valid mainnet transaction.
export default defineConfig({
  paths: {
    contracts: 'contracts',
    tests: 'test',
    artifacts: 'artifacts',
  },
  // BIP44 coin type 145 (BCH), so the same mnemonic opens in Electron Cash, Cashonize, Paytaca, etc.
  accounts: { count: 5, satoshis: 100_000_000n, path: "m/44'/145'/0'/0" },
  networks: {
    mock: {
      type: 'mock',
      policy: { enforceDust: true },
      consensus: {
        maximumInputBytes: 10_000,
        maximumStackItemBytes: 10_000,
        maximumTransactionBytes: 100_000,
        maximumNftCommitmentBytes: 128,
      },
    },
    chipnet: { type: 'electrum', network: 'chipnet', mnemonic: process.env.SOLIDCASH_MNEMONIC_CHIPNET },
    mainnet: { type: 'electrum', network: 'mainnet', mnemonic: process.env.SOLIDCASH_MNEMONIC_MAINNET },
  },
  defaultNetwork: 'mock',
});
