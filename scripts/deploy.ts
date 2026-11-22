// Deploy a SolidStarter campaign.
//
//   npx solidhat deploy --network mock       # dry run on the in-process chain (free)
//   SOLIDCASH_MNEMONIC_CHIPNET="..." npx solidhat deploy --network chipnet
//   SOLIDCASH_MNEMONIC_MAINNET="..." npx solidhat deploy --network mainnet
//
// Campaign settings come from environment variables (all optional except on live networks, where
// BENEFICIARY must be set explicitly):
//   CAMPAIGN_TITLE   on-chain title (default "SolidStarter demo campaign")
//   BENEFICIARY      P2PKH CashAddress that receives the funds on success (default: the deployer)
//   GOAL_SATS        funding goal in satoshis (default 100000 = 0.001 BCH)
//   MIN_PLEDGE_SATS  minimum pledge in satoshis (default 1000)
//   DEADLINE         ISO date, or DURATION_HOURS hours from now (default 72)
//   APP_URL          deployed web app base URL, used to print the share link
import { writeFile, mkdir } from 'node:fs/promises';
import { ethers, network } from '@solidcash/solidhat/hardhat3';
import { binToHex, decodeCashAddress } from '@bitauth/libauth';
import { encodeRef, validateParams, type CampaignRef } from '../web/src/lib/campaign-ref.ts';

const RESERVE = 1_000n;
const live = network.name === 'mainnet' || network.name === 'chipnet';

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function pkhFromAddress(address: string): string {
  const decoded = decodeCashAddress(address.trim());
  if (typeof decoded === 'string') throw new Error(`BENEFICIARY: ${decoded}`);
  if (decoded.type !== 'p2pkh') throw new Error('BENEFICIARY must be a P2PKH address.');
  const expected = network.name === 'mainnet' ? 'bitcoincash' : 'bchtest';
  if (decoded.prefix !== expected) throw new Error(`BENEFICIARY must be a ${expected}: address on ${network.name}.`);
  return binToHex(decoded.payload);
}

async function balance(signer: any): Promise<bigint> {
  const utxos = await signer.getUtxos();
  return utxos.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
}

const [deployer]: any[] = await ethers.getSigners(1);
console.log(`Network:  ${network.name}`);
console.log(`Deployer: ${deployer.address}`);
const before = await balance(deployer);
console.log(`Balance:  ${before} sats`);

const beneficiaryAddress = env('BENEFICIARY');
if (live && !beneficiaryAddress) throw new Error('Set BENEFICIARY to the address that should receive the funds.');
const nowSeconds = Math.floor(Date.now() / 1000);
const deadlineEnv = env('DEADLINE');
const deadline = deadlineEnv
  ? Math.floor(new Date(deadlineEnv).getTime() / 1000)
  : (network.name === 'mock' ? Number((await (deployer.provider as any).getBlockTime?.()) ?? nowSeconds) : nowSeconds) +
    Number(env('DURATION_HOURS', '72')) * 3600;

const params = {
  creatorPubkey: binToHex(deployer.publicKey),
  beneficiaryPkh: beneficiaryAddress ? pkhFromAddress(beneficiaryAddress) : binToHex(deployer.pkh),
  goal: BigInt(env('GOAL_SATS', '100000')!),
  minPledge: BigInt(env('MIN_PLEDGE_SATS', '1000')!),
  deadline,
};
validateParams(params);
const title = env('CAMPAIGN_TITLE', 'SolidStarter demo campaign')!;

if (before < 20_000n) {
  throw new Error(`The deployer needs at least 20,000 sats (has ${before}). Fund ${deployer.address} first.`);
}

const Factory = await ethers.getContractFactory('SolidStarter', deployer);
const campaign: any = await Factory.deploy(
  params.creatorPubkey, params.beneficiaryPkh, params.goal, BigInt(params.deadline), params.minPledge, title,
  { initialBalance: RESERVE },
);
await campaign.waitForDeployment();
const txid = campaign.deploymentTransaction().txid;
const after = await balance(deployer);

const ref: CampaignRef = {
  ...params,
  network: network.name === 'mock' ? 'demo' : (network.name as 'mainnet' | 'chipnet'),
  categoryId: campaign.categoryId,
};
const deployment = {
  network: network.name,
  title,
  categoryId: campaign.categoryId,
  address: await campaign.getAddress(),
  deploymentTxid: txid,
  deployer: deployer.address,
  constructorArgs: {
    creator: params.creatorPubkey,
    beneficiaryPkh: params.beneficiaryPkh,
    goal: params.goal.toString(),
    deadline: params.deadline,
    deadlineIso: new Date(params.deadline * 1000).toISOString(),
    minPledge: params.minPledge.toString(),
  },
  costSats: (before - after).toString(),
  shareLink: live ? `${env('APP_URL', 'https://solidstarter.pages.dev')}/#/c/${encodeRef(ref)}` : undefined,
  deployedAt: new Date().toISOString(),
};

console.log(JSON.stringify(deployment, null, 2));
if (live) {
  await mkdir('deployments', { recursive: true });
  const file = `deployments/${network.name}-${campaign.categoryId.slice(0, 12)}.json`;
  await writeFile(file, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
  console.log(`Saved ${file}`);
}
