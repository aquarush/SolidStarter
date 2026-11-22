import { describe, expect, it } from 'vitest';
import { ethers } from '@solidcash/solidhat/hardhat3';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignatureTemplate } from '@solidcash/solidcash';

// Phase enum as declared in the contract.
const Phase = { Funding: 0n, Succeeded: 1n, Failed: 2n } as const;

const GOAL = 50_000n;
const MIN_PLEDGE = 1_000n;
const TITLE = 'Community 3D printer';
const RESERVE = 1_000n; // satoshi-container reserve opened at deployment

// Failure reasons as surfaced by the SDK's BCH 2026 VM preflight.
const BAD_SIG = /bad backer signature|NULLFAIL/;
const NOT_CREATOR = /not creator|NULLFAIL/;
const FAILED_REQUIRE = /Require statement failed|preflight failed|failed/i;

const sigOf = (signer: { privateKey: any }) => new SignatureTemplate(signer.privateKey);

/**
 * Assert that a contract call is rejected. The SDK evaluates every transaction in the
 * BCH 2026 VM before broadcasting, so a rejection means the covenant refused the spend.
 */
async function expectRejected(call: any, reason: RegExp) {
  await expect(Promise.resolve().then(() => call.send())).rejects.toThrow(reason);
}

/** Whether the signer owns a plain (token-free) coin of exactly `amount` satoshis. */
async function hasCoin(signer: any, amount: bigint): Promise<boolean> {
  const utxos = await signer.getUtxos();
  return utxos.some((u: any) => !u.token && u.satoshis === amount);
}

async function deployCampaign() {
  const [creator, beneficiary, alice, bob, mallory] = await ethers.getSigners(5);
  const deadline = BigInt(await time.latest()) + BigInt(time.duration.days(7));
  const Factory = await ethers.getContractFactory('SolidStarter', creator);
  const campaign: any = await Factory.deploy(
    creator.publicKey, beneficiary.pkh, GOAL, deadline, MIN_PLEDGE, TITLE,
    { initialBalance: RESERVE },
  );
  await campaign.waitForDeployment();
  return { campaign, creator, beneficiary, alice, bob, mallory, deadline };
}

const pledgeCall = (campaign: any, backer: any, amount: bigint) =>
  campaign.connect(backer).call.pledge(backer.publicKey, sigOf(backer)).withValue(amount);

const pledge = (campaign: any, backer: any, amount: bigint) => pledgeCall(campaign, backer, amount).send();

async function passDeadlineAndFinalize(campaign: any, deadline: bigint) {
  await time.increaseTo(Number(deadline) + 3_600);
  await campaign.call.finalize().setLocktime(Number(deadline)).send();
}

describe('SolidStarter', () => {
  describe('deployment', () => {
    it('starts in the Funding phase with the configured title', async () => {
      const { campaign } = await loadFixture(deployCampaign);
      expect(await campaign.state.phase()).toBe(Phase.Funding);
      expect(await campaign.state.raised()).toBe(0n);
      expect(await campaign.state.backerCount()).toBe(0n);
      expect(await campaign.state.title()).toBe(TITLE);
      expect(await campaign.call.progress().staticCall()).toBe(0n);
    });
  });

  describe('pledging', () => {
    it('records pledges, counts each backer once and emits Pledged', async () => {
      const { campaign, alice, bob } = await loadFixture(deployCampaign);
      await expect(pledgeCall(campaign, alice, 10_000n))
        .toEmit(campaign, 'Pledged', { amount: 10_000n, totalRaised: 10_000n });
      await pledge(campaign, alice, 5_000n);
      await pledge(campaign, bob, 7_500n);

      expect(await campaign.state.raised()).toBe(22_500n);
      expect(await campaign.state.backerCount()).toBe(2n);
      expect(await campaign.state.pledges(alice.pkh)).toBe(15_000n);
      expect(await campaign.state.pledges(bob.pkh)).toBe(7_500n);
      expect(await campaign.call.progress().staticCall()).toBe(4_500n); // 45.00%
      expect((await campaign.queryFilter('Pledged')).length).toBe(3);
    });

    it('rejects a pledge below the minimum', async () => {
      const { campaign, alice } = await loadFixture(deployCampaign);
      await expectRejected(pledgeCall(campaign, alice, MIN_PLEDGE - 1n), FAILED_REQUIRE);
    });

    it("rejects a pledge signed with someone else's key", async () => {
      const { campaign, alice, mallory } = await loadFixture(deployCampaign);
      const forged = campaign.connect(mallory).call.pledge(alice.publicKey, sigOf(mallory)).withValue(5_000n);
      await expectRejected(forged, BAD_SIG);
    });
  });

  describe('withdrawing while open', () => {
    it('returns the full pledge to the backer and updates the ledger', async () => {
      const { campaign, alice, bob } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 12_345n);
      await pledge(campaign, bob, 2_000n);

      await expect(campaign.connect(alice).call.withdraw(alice.publicKey, sigOf(alice)))
        .toEmit(campaign, 'Withdrawn', { amount: 12_345n });

      expect(await hasCoin(alice, 12_345n)).toBe(true);
      expect(await campaign.state.pledges(alice.pkh)).toBe(0n);
      expect(await campaign.state.raised()).toBe(2_000n);
      expect(await campaign.state.backerCount()).toBe(1n);
    });

    it('rejects a withdrawal by someone with no pledge', async () => {
      const { campaign, alice, mallory } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 5_000n);
      await expectRejected(campaign.connect(mallory).call.withdraw(mallory.publicKey, sigOf(mallory)), FAILED_REQUIRE);
    });

    it("cannot withdraw another backer's pledge", async () => {
      const { campaign, alice, mallory } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 5_000n);
      await expectRejected(campaign.connect(mallory).call.withdraw(alice.publicKey, sigOf(mallory)), BAD_SIG);
      expect(await campaign.state.pledges(alice.pkh)).toBe(5_000n);
    });
  });

  describe('finalizing', () => {
    it('cannot be finalized before the deadline', async () => {
      const { campaign, deadline } = await loadFixture(deployCampaign);
      await expectRejected(campaign.call.finalize().setLocktime(Number(deadline) - 1), /deadline not reached|LOCKTIME/i);
    });

    it('fails a campaign that missed its goal, then refunds every backer exactly', async () => {
      const { campaign, alice, bob, deadline } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 9_000n);
      await pledge(campaign, bob, 4_000n);
      await passDeadlineAndFinalize(campaign, deadline);
      expect(await campaign.state.phase()).toBe(Phase.Failed);

      await expect(campaign.connect(alice).call.refund(alice.publicKey, sigOf(alice)))
        .toEmit(campaign, 'Refunded', { amount: 9_000n });
      await campaign.connect(bob).call.refund(bob.publicKey, sigOf(bob)).send();
      expect(await hasCoin(alice, 9_000n)).toBe(true);
      expect(await hasCoin(bob, 4_000n)).toBe(true);
      expect(await campaign.state.raised()).toBe(0n);
    });

    it('refuses a second refund for the same backer', async () => {
      const { campaign, alice, bob, deadline } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 9_000n);
      await pledge(campaign, bob, 3_000n);
      await passDeadlineAndFinalize(campaign, deadline);
      await campaign.connect(alice).call.refund(alice.publicKey, sigOf(alice)).send();
      await expectRejected(campaign.connect(alice).call.refund(alice.publicKey, sigOf(alice)), FAILED_REQUIRE);
      expect(await campaign.state.pledges(bob.pkh)).toBe(3_000n); // Bob's pledge is untouched
    });

    it('marks a funded campaign Succeeded and blocks refunds and new pledges', async () => {
      const { campaign, alice, bob, deadline } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 30_000n);
      await pledge(campaign, bob, 25_000n);
      await passDeadlineAndFinalize(campaign, deadline);

      expect(await campaign.state.phase()).toBe(Phase.Succeeded);
      await expectRejected(campaign.connect(alice).call.refund(alice.publicKey, sigOf(alice)), FAILED_REQUIRE);
      await expectRejected(pledgeCall(campaign, bob, 5_000n), FAILED_REQUIRE);
    });

    it('cannot be finalized twice', async () => {
      const { campaign, deadline } = await loadFixture(deployCampaign);
      await passDeadlineAndFinalize(campaign, deadline);
      await expectRejected(campaign.call.finalize().setLocktime(Number(deadline)), FAILED_REQUIRE);
    });
  });

  describe('claiming', () => {
    it('pays the whole pot to the beneficiary once the goal is reached, even before the deadline', async () => {
      const { campaign, creator, beneficiary, alice, bob } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 30_000n);
      await pledge(campaign, bob, 20_000n);

      await expect(campaign.connect(creator).call.claim(sigOf(creator)))
        .toEmit(campaign, 'Claimed', { amount: 50_000n });
      expect(await hasCoin(beneficiary, 50_000n)).toBe(true);
      expect(await campaign.state.phase()).toBe(Phase.Succeeded);
      expect(await campaign.state.raised()).toBe(0n);
    });

    it('refuses a claim before the goal is met', async () => {
      const { campaign, creator, alice } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 49_999n);
      await expectRejected(campaign.connect(creator).call.claim(sigOf(creator)), /goal not reached/);
    });

    it('refuses a claim signed by anyone but the creator', async () => {
      const { campaign, alice, mallory } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 60_000n);
      await expectRejected(campaign.connect(mallory).call.claim(sigOf(mallory)), NOT_CREATOR);
    });

    it('cannot claim twice', async () => {
      const { campaign, creator, alice } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 60_000n);
      await campaign.connect(creator).call.claim(sigOf(creator)).send();
      await expectRejected(campaign.connect(creator).call.claim(sigOf(creator)), /goal not reached|failed/i);
    });
  });

  describe('cancelling', () => {
    it('lets the creator cancel and backers reclaim immediately', async () => {
      const { campaign, creator, alice } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 8_000n);
      await expect(campaign.connect(creator).call.cancel(sigOf(creator)))
        .toEmit(campaign, 'Finalized', { totalRaised: 8_000n }); // enum args decode as raw bytes; phase checked below
      expect(await campaign.state.phase()).toBe(Phase.Failed);

      await campaign.connect(alice).call.refund(alice.publicKey, sigOf(alice)).send();
      expect(await hasCoin(alice, 8_000n)).toBe(true);
    });

    it('cannot be cancelled by an outsider', async () => {
      const { campaign, mallory } = await loadFixture(deployCampaign);
      await expectRejected(campaign.connect(mallory).call.cancel(sigOf(mallory)), NOT_CREATOR);
    });

    it('a cancelled campaign can never be claimed, even with enough funds', async () => {
      const { campaign, creator, alice } = await loadFixture(deployCampaign);
      await pledge(campaign, alice, 60_000n);
      await campaign.connect(creator).call.cancel(sigOf(creator)).send();
      await expectRejected(campaign.connect(creator).call.claim(sigOf(creator)), /campaign failed/);
    });
  });
});
