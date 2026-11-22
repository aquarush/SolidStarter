import { defineConfig } from 'vitest/config';
import { solidhatPreset } from '@solidcash/solidhat/vitest-preset';

export default defineConfig(solidhatPreset({ hardhat: 3, ethers: 6 }, {
  test: { include: ['test/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000 },
}));
