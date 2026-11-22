# SolidCash 0.51.1 feedback

Issues met while building SolidStarter, each with a reproduction and a suggested fix, ready to file at
<https://github.com/solidcash/solidcash>. Versions: `@solidcash/solidc`, `@solidcash/solidcash`,
`@solidcash/solidhat` 0.51.1, Node 22.

---

## 1. `toBeReverted()` rejects genuine VM failures prefixed with `messageBus:`

**Observed.** A call that fails a `require` (bad signature, CLTV not yet satisfied) is reported by the matcher as
*not* a revert:

```
Error: Expected a contract revert, but the failure was not a VM or require failure:
messageBus: BCH-2026 preflight failed at input 0: Program failed a signature verification with a
non-null signature (violating the "NULLFAIL" rule). ...; failing require in SolidStarter:82 (bad backer signature)
```

The same happens for `OP_CHECKLOCKTIMEVERIFY` failures on `require(tx.time >= deadline)`.

**Repro.** Any stateful contract with `function f(pubkey pk, sig s) external { require(checkSig(s, pk), "bad"); ... }`,
called with a signature from a different key:

```ts
await expect(sc.connect(mallory).call.f(alice.publicKey, sigOf(mallory))).toBeReverted(); // fails
```

**Suggested fix.** The matcher's failure classifier should accept preflight errors whose message carries the
`messageBus:` prefix (or classify on the structured error type rather than the message text). The failure is a real
VM failure and even names the failing `require`.

**Workaround used.** `await expect(call.send()).rejects.toThrow(/bad backer signature|NULLFAIL/)`.

## 2. Enum event arguments decode as raw bytes

**Observed.** For `event Finalized(Phase outcome, uint256 totalRaised)` with `enum Phase { Funding, Succeeded, Failed }`,
`toEmit(..., { outcome: 2n })` fails with `Field 'outcome': expected 2n, got 0x02`, and `queryFilter('Finalized')`
returns `outcome` as a `Uint8Array`.

**Suggested fix.** Decode enum-typed event parameters with the artifact's `enums` metadata (to `bigint`, as the
state getters do for enum state variables), or at least let `toEmit` compare an enum argument numerically.

## 3. Documentation says `.send()` returns decoded `receipt.events`

**Observed.** `AGENTS.md` and the SDK docs show:

```ts
const receipt = await counter.call.increment(sig).send(); // explicit form; receipt.events is decoded
```

In 0.51.1 `StatefulTransactionBuilder.send()` is typed and behaves as `Promise<TransactionDetails>`; there is no
`events` field. Events are available through `toEmit` and `queryFilter`.

**Suggested fix.** Either attach decoded events to the returned details, or update the docs to point at
`queryFilter` / `toEmit`.

## 4. Satoshi container coins are not aggregated for a transfer

**Observed.** Without `pragma satoshicontainer single`, each payable call creates a new container coin. A later
`this.transfer(to, total)` whose amount exceeds any single coin fails before evaluation:

```
Cannot send stateful transaction: state commitments could not be auto-derived. Reason: Full state derivation
failed: Total transfer amount (50000) exceeds satoshi container balance (30000)
```

even though the contract's container coins together hold 50,000 sats. After a container is fully paid out, later
calls also fail with `Satoshi container UTXO not found` instead of reaching the contract's own `require`.

**Suggested fix.** Let the SDK select as many container coins as needed to cover the transfer (as it does for
signer funding), or document `pragma satoshicontainer single` as the recommended layout for pooled-funds contracts.

## 5. Mapping getter with a hex-string key silently returns the default

**Observed.** In a browser app, `await sc.state.pledges('0a1b…')` (a 40-character hex string for a `bytes20` key)
returned `0n` for a key that had a pledge; passing `hexToBin('0a1b…')` returned the correct value. No error was
raised, so the bug showed up only as a wrong balance in the UI.

**Suggested fix.** Accept hex strings for `bytesN` keys (normalising them as constructor arguments are), or throw a
type error for a string whose byte length does not match the key type.

## 6. `git+ssh` lockfile entries for the libauth fork

**Observed.** The SDK depends on `git+https://github.com/mainnet-pat/libauth.git#<sha>`. npm records this in
`package-lock.json` as `git+ssh://git@github.com/...`, so `npm ci` fails on hosts without GitHub SSH keys
(Cloudflare Pages, most CI runners, Docker builds).

**Suggested fix.** Publish the fork to npm under a scoped name (for example `@solidcash/libauth`) and depend on a
version, which also restores npm's integrity checking (npm prints `skipping integrity check for git dependency`).

**Workaround used.** `scripts/fix-lockfile.mjs` rewrites the URL to HTTPS; `npm run check-lockfile` guards it.

## 7. Per-call cost of stateful contracts

Not a bug, but worth documenting with numbers: a call to a ~5.8 KB stateful contract is a ~7.9 KB transaction
(the redeem script travels in every spend), so each action costs roughly 9,000–11,500 sats including the 1,200-sat
event and entry deposits. A short "what will my users pay" section in the docs, and a cost-reporting helper (like
`scripts/measure-costs.ts` here), would help application authors size minimum pledges and fees.
