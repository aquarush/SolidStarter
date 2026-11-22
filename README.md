# SolidStarter

**All-or-nothing crowdfunding on Bitcoin Cash, written in Solidity and compiled to native BCH Script with [SolidCash](https://github.com/solidcash/solidcash).**

Pledges are held by a stateful covenant, not by the organiser or a platform. If the goal is reached, the
beneficiary is paid. If it is not, or the creator cancels, every backer reclaims exactly what they pledged.
Backers can also change their mind and withdraw while the campaign is open. No custodian, no platform fee, and
nobody (including the creator and this website) can bend the rules.

**Live app:** <https://solidstarter.pages.dev> (open it and press Demo to try the full lifecycle with play money).

> **Status:** SolidCash 0.51 is a beta compiler without an independent audit. Use small amounts on mainnet.

---

## Contents

- [Why it is useful](#why-it-is-useful)
- [How it works](#how-it-works)
- [SolidCash features used](#solidcash-features-used)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Testing](#testing)
- [Deploying a campaign to mainnet](#deploying-a-campaign-to-mainnet)
- [Hosting the web app on Cloudflare Pages](#hosting-the-web-app-on-cloudflare-pages)
- [Costs](#costs)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Feedback for SolidCash](#feedback-for-solidcash)
- [Bounty checklist](#bounty-checklist)

## Why it is useful

Any time a group chips in toward a shared goal and wants a guarantee that the money comes back if the goal is
not met:

| Situation | How SolidStarter helps |
| --- | --- |
| **Group gifts** — colleagues chip in for a farewell present | If not enough people join by Friday, everyone is refunded automatically. Nobody chases anyone. |
| **Pre-orders** — a shop runs a batch of 100 shirts | The maker is paid only when enough orders arrive; otherwise buyers reclaim their money. |
| **Open-source and community funding** — like Flipstarter | The goal, deadline and payout address are enforced on chain instead of by an off-chain coordinator. |
| **Neighbourhood projects, events, emergencies** | Anyone can verify the total raised; the payout address is fixed at launch and cannot be swapped. |

Compared with a shared bank account or a donation platform: no custodian can freeze or skim the funds, refunds
do not depend on the organiser's honesty, and fees are a few cents.

## How it works

```
                 pledge / withdraw (any backer, signed)
                        ┌──────────┐
                        ▼          │
   launch ──────▶   [ Funding ] ───┘
                     │   │   │
   claim (creator,   │   │   └── cancel (creator) ─────────────┐
   raised ≥ goal) ───┘   │                                     ▼
          │              └── finalize (anyone, after deadline) ─▶ [ Failed ] ── refund (each backer)
          ▼                    raised ≥ goal? ──▶ [ Succeeded ]
   beneficiary paid
```

| Action | Who | Rule enforced by the covenant |
| --- | --- | --- |
| `pledge(backer, sig)` *payable* | any backer | Phase is Funding; signature by `backer`; amount ≥ minimum. Records `pledges[hash160(backer)] += value`. |
| `withdraw(backer, sig)` | that backer | Phase is Funding; pays back exactly their pledge to their own P2PKH address. |
| `finalize()` | anyone | Deadline passed (`tx.time >= deadline`); sets Succeeded or Failed once. |
| `cancel(sig)` | creator | Phase is Funding; switches to Failed so everyone can reclaim. |
| `refund(backer, sig)` | that backer | Phase is Failed; pays back exactly their pledge, then deletes the entry (no double refund). |
| `claim(sig)` | creator | Goal reached and not Failed; pays the entire pot to the beneficiary fixed at launch. |
| `progress()` *view* | anyone | Percentage funded (basis points), via a library function. |

The goal, deadline, minimum pledge, creator key and beneficiary are **contract parameters**: they are compiled
into the covenant's address, so they cannot change after launch. State (phase, total raised, backer count, title)
lives in CashToken NFT commitments; each pledge is an entry in a **verified mapping**, so a transaction builder
cannot hide or forge a backer's balance.

The contract is in [`contracts/SolidStarter.scash`](contracts/SolidStarter.scash) (about 150 lines, 5,808 bytes of
BCH Script, within the 10,000-byte per-input consensus limit).

## SolidCash features used

| Feature | Where |
| --- | --- |
| Stateful contract (NFT-commitment state) | `phase`, `raised`, `backerCount`, `title` |
| Verified mapping `mapping(bytes20 => uint256)` with insert, update and `delete` | `pledges` |
| Dynamic `string` state, written by a constructor body argument | `title`, `constructor(string initialTitle)` |
| Contract parameters baked into the address | `creator`, `beneficiaryPkh`, `goal`, `deadline`, `minPledge` |
| `enum` in state, events and modifier arguments | `Phase` |
| Events with `indexed` parameters (NFT event records) | `Pledged`, `Withdrawn`, `Refunded`, `Finalized`, `Claimed` |
| Custom errors with arguments, `revert` | `PledgeTooSmall`, `WrongPhase`, `NothingPledged` |
| `require` with reason strings (surfaced in SDK preflight) | throughout |
| Abstract base contract with its own parameter, inheritance | `CreatorGuarded(creator)` |
| Modifiers with parameters, stacked | `onlyCreator(sig)`, `inPhase(Phase)` |
| Library with `internal pure` functions, `using … for` | `PledgeMath.progressBps`, `PledgeMath.lockFor` |
| File-level `constant`, numeric separators | `BPS_DENOMINATOR = 10_000` |
| `payable` + `msg.value` (net satoshi-container deposit) | `pledge` |
| Satoshi container payouts with `this.transfer` | `withdraw`, `refund`, `claim` |
| `pragma satoshicontainer single` | one pooled coin, so claims and refunds never fragment |
| Signature authorization (`checkSig`, `sig`, `pubkey`) instead of `msg.sender` | every privileged path |
| Absolute time lock `tx.time >= deadline` (OP_CHECKLOCKTIMEVERIFY) | `finalize` |
| `hash160`, `new LockingBytecodeP2PKH(...)` | backer identity and payout pinning |
| `view` function read via `staticCall` | `progress()` |
| Ternary, `if`, compound assignment, checked `uint256` arithmetic | throughout |

## Repository layout

```
contracts/SolidStarter.scash   the covenant (native SolidCash)
test/SolidStarter.test.ts      19 solidhat tests on a mainnet-limits mock chain
test/web-lib.test.ts           15 unit tests for amount parsing, link validation, artifact drift
e2e/demo-lifecycle.mjs         headless-Chrome test of the built site (with production CSP)
scripts/deploy.ts              solidhat deploy script (mock / chipnet / mainnet)
scripts/measure-costs.ts       measures the satoshi cost of each action
web/                           React + Vite front end (static, Cloudflare Pages-ready)
  src/lib/campaign.ts          typed client for the covenant (deploy, read, act)
  src/lib/wallet.ts            encrypted browser wallet (AES-256-GCM, PBKDF2 600k)
  src/lib/campaign-ref.ts      share-link encoding with strict validation
  public/_headers              CSP and security headers for Cloudflare Pages
solidcash.config.ts            networks, accounts (BCH path m/44'/145'), mainnet-like mock limits
SECURITY.md                    threat model and design decisions
docs/solidcash-feedback.md     issues found in SolidCash 0.51.1, with reproductions
```

## Quick start

Requirements: Node.js 22+.

```bash
npm ci
npm run compile          # solidhat compile -> artifacts/solidcash/
npm test                 # contract + unit tests (takes several minutes: full BCH VM, real limits)
npm run dev              # web app at http://localhost:5173
```

Open the app, keep **Demo** selected, and:

1. As **Creator**, launch a campaign (try the "Group gift" example).
2. Switch to **Alice** and **Bob** and pledge. Withdraw one pledge to see the ledger update.
3. Either claim as **Creator** once the goal is met, or press **Jump past deadline**, **Finalize**, then
   reclaim as each backer.

Demo mode runs the real compiled contract inside a full BCH 2026 virtual machine in your browser
(`MockNetworkProvider`), with five funded play-money personas. Every rejection you see comes from the covenant.

## Testing

| Suite | Command | What it proves |
| --- | --- | --- |
| Contract (solidhat) | `npm test` | 19 tests: every lifecycle path plus attacks (forged signatures, stealing another backer's pledge, double refund, double claim, early claim, outsider cancel, early finalize, double finalize, claim after cancel). Runs with **mainnet consensus limits** (10,000-byte inputs, 128-byte commitments, dust policy). |
| Web logic (vitest) | included in `npm test` | Exact BCH parsing (no floats), tamper-proof link decoding, bundled artifact equals compiled artifact. |
| Browser end-to-end | `npm run build && npm run e2e` | Drives the production build in headless Chrome, served with the production `_headers` (CSP), through a successful campaign (pledge, withdraw, top-up, claim) and a failed one (finalize, refund). Fails on any console error or CSP violation. |
| Everything | `npm run verify` | Lockfile check, all tests, build, e2e. |

`CHROME_PATH` selects the browser for the e2e test (default `/usr/bin/google-chrome`).

## Deploying a campaign to mainnet

You need a little real BCH: about **0.001 BCH** covers a deployment, a couple of pledges and a claim with margin
(see [Costs](#costs)).

1. **Rehearse for free** on the in-process chain:
   ```bash
   npx solidhat deploy --network mock
   ```
2. **Create a dedicated wallet.** Generate a fresh 12-word mnemonic in a BCH wallet (Electron Cash, Cashonize,
   Paytaca). The deploy script uses the standard BCH path `m/44'/145'/0'/0`, so the first address matches.
   Never reuse a wallet that holds significant funds.
3. **Fund it**, then deploy. The seed phrase is read only from the environment; never put it in a file you
   commit:
   ```bash
   export SOLIDCASH_MNEMONIC_MAINNET="your twelve words ..."   # or use your shell's secret manager
   BENEFICIARY=bitcoincash:q... \
   CAMPAIGN_TITLE="BLAZE 2026 demo campaign" \
   GOAL_SATS=20000 MIN_PLEDGE_SATS=1000 DURATION_HOURS=48 \
   APP_URL=https://solidstarter.pages.dev \
   npx solidhat deploy --network mainnet
   unset SOLIDCASH_MNEMONIC_MAINNET
   ```
   The script prints the deployer address and balance first, refuses to run without enough funds, and writes
   `deployments/mainnet-<category>.json` with the transaction id, constructor arguments, measured cost and the
   campaign's share link.
4. **Run the lifecycle** from the web app's **Mainnet** tab: open the share link, import a wallet, pledge,
   withdraw, claim or refund. Each action links to the transaction on a block explorer.

Use `--network chipnet` with `SOLIDCASH_MNEMONIC_CHIPNET` for a rehearsal on the public test network (free test
coins from a chipnet faucet). Keep the chipnet and mainnet phrases different; SolidHat refuses to use one phrase
on two live chains.

## Hosting the web app on Cloudflare Pages

The front end is a static site (no server, no API keys).

**Dashboard (Git integration):**

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION = 22` (also pinned in `.node-version`) |

**Or with Wrangler from your machine:**

```bash
npm run build
npx wrangler pages deploy dist --project-name solidstarter
```

`web/public/_headers` is copied into `dist/` and applies a strict Content-Security-Policy (scripts only from the
site itself, network access only to the two Electrum servers, no framing), HSTS, `nosniff`, and immutable
caching for hashed assets. Links use hash routing, so no redirect rules are needed.

> If you change dependencies, run `npm run fix-lockfile`. npm records the SDK's GitHub-hosted `libauth`
> dependency as `git+ssh://`, which build servers without SSH keys cannot fetch; the script rewrites it to HTTPS
> and `npm run check-lockfile` guards it.

## Costs

Measured on the BCH VM with `npx tsx scripts/measure-costs.ts` (1 sat/byte relay fee):

| Action | Cost to the caller |
| --- | --- |
| Launch a campaign | ~9,700 sats (fee + 1,000-sat container reserve + state-coin deposits) |
| First pledge from a backer | ~11,500 sats on top of the pledged amount (fee + new ledger entry + event record) |
| Further pledge / withdraw / refund / claim | ~9,000–10,000 sats each |

Every call carries the full 5.8 KB covenant script, which BCH prices per byte; event records and ledger entries
each lock a 1,200-sat deposit. That is the price of fully on-chain enforcement, roughly 0.0001 BCH per action.

## Security

See [SECURITY.md](SECURITY.md) for the full threat model. In short:

- **Every privileged path checks a signature** against a key the caller cannot choose (`creator`, or the
  backer key bound to the ledger entry). `msg.sender` is never used for authorization.
- **Payouts are pinned**: refunds and withdrawals go only to the backer's own P2PKH address; claims only to the
  beneficiary fixed at launch.
- **No double spending of pledges**: entries are deleted before payout in the same atomic transaction, and the
  phase machine forbids claiming a failed campaign or refunding a successful one.
- **The browser wallet is encrypted at rest** (AES-256-GCM, PBKDF2-SHA256 600,000 iterations); keys never leave
  the page. Share links are validated strictly, and the CSP blocks third-party scripts.

## Known limitations

- **Beta compiler.** SolidCash 0.51 has not been independently audited. Keep amounts small.
- **Late pledges.** BCH Script can prove that a time *has* passed but not that it has not, so the covenant cannot
  reject a pledge made after the deadline. Instead anyone can `finalize` at the deadline to lock the outcome. The
  UI offers this to every visitor, and backers should finalize a missed campaign promptly.
- **Goal can be self-funded.** As on any all-or-nothing platform, a creator could pledge to their own campaign to
  reach the goal. Backers can withdraw at any time before a claim.
- **Withdrawals after the goal.** Backers may withdraw until the creator claims (Flipstarter semantics), so
  creators should claim promptly once funded.
- **Contention.** All actions spend the campaign's state coin, so two people acting in the same instant conflict
  and one must retry. That is fine for crowdfunding volumes.
- **Hot wallet.** The built-in wallet is meant for small amounts. An XSS bug in the page could read an unlocked
  key; the strict CSP and the absence of third-party code are the mitigation.
- **Leftover deposits.** The 1,000-sat reserve and the event and entry deposits stay in the covenant after a
  campaign ends.

## Feedback for SolidCash

While building this, several rough edges in SolidCash 0.51.1 came up (test matcher classification, enum event
decoding, a documentation mismatch on receipts, satoshi-container aggregation and the `git+ssh` lockfile issue).
They are written up with reproductions and suggested fixes in
[docs/solidcash-feedback.md](docs/solidcash-feedback.md), ready to file as issues or pull requests upstream.

## Bounty checklist

BLAZE 2026, *Best SolidCash Application*:

- [x] Solidity-syntax smart contract compiled natively to BCH with SolidCash
- [x] Uses a wide range of SolidCash features and syntax (see the [feature table](#solidcash-features-used))
- [x] Tested with **solidhat** under real mainnet limits, including adversarial cases
- [x] Usable UI demonstrating the full contract lifecycle (in-browser demo plus chipnet and mainnet modes)
- [ ] Deployed and run on BCH mainnet (record the transaction ids from `deployments/` here)
- [ ] Issues or pull requests filed upstream from [docs/solidcash-feedback.md](docs/solidcash-feedback.md)

## License

MIT, see [LICENSE](LICENSE).
