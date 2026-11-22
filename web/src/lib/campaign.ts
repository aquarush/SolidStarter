// Typed wrapper around the SolidStarter covenant: deploy, load, read and act.
import { SignatureTemplate, type Signer } from '@solidcash/solidcash';
import { ContractFactory } from '@solidcash/solidcash/contract-factory';
import { StatefulContract } from '@solidcash/solidcash/stateful';
import { binToHex, hexToBin } from '@bitauth/libauth';
import artifactJson from '../contract/SolidStarter.json';
import { constructorArgs, validateParams, type CampaignParams, type CampaignRef } from './campaign-ref';
import type { Session } from './chain';

export const artifact = artifactJson as any;

/** Satoshis the creator locks in the campaign's satoshi container at launch (dust-safe reserve). */
export const CONTAINER_RESERVE = 1_000n;
export const TITLE_MAX_BYTES = 80;

export enum Phase {
  Funding = 0,
  Succeeded = 1,
  Failed = 2,
}

export const PHASE_LABEL: Record<Phase, string> = {
  [Phase.Funding]: 'Funding',
  [Phase.Succeeded]: 'Succeeded',
  [Phase.Failed]: 'Failed / cancelled',
};

export interface Backer {
  pkh: string;
  amount: bigint;
}

export interface ActivityItem {
  kind: 'Pledged' | 'Withdrawn' | 'Refunded' | 'Finalized' | 'Claimed';
  backer?: string;
  amount?: bigint;
  txid: string;
}

export interface CampaignSnapshot {
  title: string;
  phase: Phase;
  raised: bigint;
  backerCount: bigint;
  progressBps: number;
  backers: Backer[];
  activity: ActivityItem[];
}

const toHex = (v: unknown): string => (v instanceof Uint8Array ? binToHex(v) : String(v ?? ''));
const toNumber = (v: unknown): number => (v instanceof Uint8Array ? (v.length ? v[0] : 0) : Number(v ?? 0));
const sig = (signer: Signer) => new SignatureTemplate(signer.privateKey);

export function validateTitle(title: string): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Give your campaign a title.');
  if (new TextEncoder().encode(clean).length > TITLE_MAX_BYTES) {
    throw new Error(`Keep the title under ${TITLE_MAX_BYTES} bytes.`);
  }
  return clean;
}

export async function deployCampaign(
  session: Session,
  creator: Signer,
  params: CampaignParams,
  title: string,
): Promise<{ ref: CampaignRef; txid: string }> {
  validateParams(params);
  if (binToHex(creator.publicKey) !== params.creatorPubkey) throw new Error('Creator key mismatch.');
  const cleanTitle = validateTitle(title);
  const factory = new ContractFactory(artifact, creator);
  const contract: any = await factory.deploy(...constructorArgs(params), cleanTitle, {
    initialBalance: CONTAINER_RESERVE,
  });
  await contract.waitForDeployment();
  const ref: CampaignRef = { ...params, network: session.network, categoryId: contract.categoryId };
  return { ref, txid: contract.deploymentTransaction().txid };
}

export class CampaignClient {
  private constructor(
    readonly ref: CampaignRef,
    private readonly session: Session,
    private readonly contract: any,
  ) {}

  /** Attach to a deployed campaign. Fails if the parameters do not match the on-chain covenant. */
  static async open(session: Session, ref: CampaignRef): Promise<CampaignClient> {
    if (ref.network !== session.network) throw new Error(`This campaign lives on ${ref.network}.`);
    const contract = await StatefulContract.at(ref.categoryId, artifact, session.provider, {
      constructorArgs: constructorArgs(ref),
    } as any);
    const client = new CampaignClient(ref, session, contract);
    await client.contract.getState(); // proves the covenant + state NFTs exist for these parameters
    return client;
  }

  async snapshot(): Promise<CampaignSnapshot> {
    const state: any = await this.contract.getState();
    const raised = BigInt(state.raised);
    const activity = await this.activity();

    const seen = new Set<string>();
    const backers: Backer[] = [];
    for (const item of activity) {
      if (item.kind === 'Pledged' && item.backer && !seen.has(item.backer)) {
        seen.add(item.backer);
        const amount = await this.pledgeOf(item.backer);
        if (amount > 0n) backers.push({ pkh: item.backer, amount });
      }
    }
    backers.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

    const goal = this.ref.goal;
    const bps = goal === 0n ? 10_000n : (raised * 10_000n) / goal;
    return {
      title: String(state.title),
      phase: toNumber(state.phase) as Phase,
      raised,
      backerCount: BigInt(state.backerCount),
      progressBps: Number(bps > 10_000n ? 10_000n : bps),
      backers,
      activity,
    };
  }

  private async activity(): Promise<ActivityItem[]> {
    const kinds: ActivityItem['kind'][] = ['Pledged', 'Withdrawn', 'Refunded', 'Finalized', 'Claimed'];
    const results = await Promise.all(
      kinds.map(async (kind) => {
        try {
          const logs: any[] = await this.contract.queryFilter(kind);
          return logs.map((log) => ({
            kind,
            backer: log.args?.backer !== undefined ? toHex(log.args.backer) : undefined,
            amount: log.args?.amount !== undefined ? BigInt(log.args.amount) : log.args?.totalRaised !== undefined ? BigInt(log.args.totalRaised) : undefined,
            txid: String(log.txid),
          }));
        } catch {
          return []; // event history is best effort; state reads are authoritative
        }
      }),
    );
    return results.flat();
  }

  /** Current pledge of a backer, read from the verified mapping (key = hash160 of the backer's pubkey). */
  async pledgeOf(pkhHex: string): Promise<bigint> {
    return BigInt(await this.contract.state.pledges(hexToBin(pkhHex)));
  }

  private as(signer: Signer) {
    return this.contract.connect(signer).call;
  }

  async pledge(backer: Signer, amount: bigint): Promise<string> {
    if (amount < this.ref.minPledge) throw new Error('Below the minimum pledge.');
    const tx = await this.as(backer).pledge(backer.publicKey, sig(backer)).withValue(amount).send();
    return tx.txid;
  }

  async withdraw(backer: Signer): Promise<string> {
    return (await this.as(backer).withdraw(backer.publicKey, sig(backer)).send()).txid;
  }

  async refund(backer: Signer): Promise<string> {
    return (await this.as(backer).refund(backer.publicKey, sig(backer)).send()).txid;
  }

  async finalize(caller: Signer): Promise<string> {
    return (await this.as(caller).finalize().setLocktime(this.ref.deadline).send()).txid;
  }

  async cancel(creator: Signer): Promise<string> {
    return (await this.as(creator).cancel(sig(creator)).send()).txid;
  }

  async claim(creator: Signer): Promise<string> {
    return (await this.as(creator).claim(sig(creator)).send()).txid;
  }

  get explorerTx() {
    return this.session.explorerTx;
  }
}
