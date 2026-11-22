// Measures the satoshi cost of every SolidStarter action on the in-process BCH VM.
//   npx tsx scripts/measure-costs.ts
import { SignatureTemplate } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { ContractFactory } from '@solidcash/solidcash/contract-factory';
import artifact from '../artifacts/solidcash/SolidStarter.json' with { type: 'json' };

const provider: any = new MockNetworkProvider();
const [creator, beneficiary, alice] = await provider.getSigners(3);
const bal = async (s: any) => (await s.getUtxos()).filter((u: any) => !u.token).reduce((a: bigint, u: any) => a + BigInt(u.satoshis), 0n);
const sig = (s: any) => new SignatureTemplate(s.privateKey);
const rows: [string, bigint, string][] = [];
async function measure(label: string, who: any, fn: () => Promise<unknown>, moved = 0n) {
  const before = await bal(who);
  await fn();
  const spent = before - (await bal(who)) - moved;
  rows.push([label, spent, moved ? `excl. ${moved} sats moved` : '']);
}

const deadline = BigInt(provider.getBlockTime() + 3600);
let c: any;
await measure('deploy campaign (creator)', creator, async () => {
  c = await new ContractFactory(artifact as any, creator).deploy(creator.publicKey, beneficiary.pkh, 30_000n, deadline, 1_000n, 'Cost probe', { initialBalance: 1_000n });
  await c.waitForDeployment();
});
await measure('first pledge (backer)', alice, () => c.connect(alice).call.pledge(alice.publicKey, sig(alice)).withValue(10_000n).send(), 10_000n);
await measure('top-up pledge (backer)', alice, () => c.connect(alice).call.pledge(alice.publicKey, sig(alice)).withValue(10_000n).send(), 10_000n);
await measure('withdraw (backer)', alice, () => c.connect(alice).call.withdraw(alice.publicKey, sig(alice)).send(), -20_000n);
await measure('pledge again (backer)', alice, () => c.connect(alice).call.pledge(alice.publicKey, sig(alice)).withValue(30_000n).send(), 30_000n);
await measure('claim (creator)', creator, () => c.connect(creator).call.claim(sig(creator)).send());
console.table(rows.map(([action, sats, note]) => ({ action, 'cost (sats)': Number(sats), note })));
