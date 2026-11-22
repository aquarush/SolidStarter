# Security model

SolidStarter has two parts with different trust boundaries: the **covenant** (enforced by every BCH node) and the
**web app** (a convenience; it holds no authority). This document describes what each guarantees, the threats
considered, and the residual risks.

## Covenant guarantees

These hold no matter which client builds the transaction, because they are checked by the BCH VM.

| Property | Mechanism |
| --- | --- |
| Only the creator can claim or cancel | `onlyCreator(sig)` checks `checkSig` against the `creator` contract parameter, which is baked into the address. |
| Only a backer can move their pledge | `withdraw` and `refund` require a signature from `backer`, and the ledger key is `hash160(backer)`. A forged key yields a different (empty) entry. |
| Pledges cannot be credited to someone else | `pledge` requires the backer's own signature, so a refund can only ever go back to the key that pledged. |
| Refunds and withdrawals pay the right person | The payout output is `LockingBytecodeP2PKH(hash160(backer))`, pinned by the covenant. |
| Claims pay the right person | The payout output is `LockingBytecodeP2PKH(beneficiaryPkh)`, a contract parameter. |
| No double refund or withdrawal | The entry is deleted and `raised` reduced in the same atomic state transition that pays out. |
| Phases cannot regress | `finalize` and `cancel` only run in Funding; `refund` only in Failed; `claim` never in Failed. |
| The deadline is real | `finalize` uses `tx.time >= deadline` (OP_CHECKLOCKTIMEVERIFY); nodes reject the spend before that time. |
| Ledger reads cannot be faked | `pledges` is a verified mapping: reads prove the stored value or the key's absence. |
| Arithmetic is safe | `uint256` arithmetic is checked; underflow on `raised -= amount` aborts the script. |
| No re-entrancy | Not possible on BCH (no call stack); each call is one atomic transaction. |

Design choices that follow the SolidCash agent rules:

- **No `msg.sender` authorization.** It is derived from transaction inputs chosen by the builder.
- **No unsafe tiers, no `--allow-unverified-paths`, no `--allow-unsafe-operations`.** Every public path verifies
  a signature, a time lock, or changes state, and the compiler's `enforceFinalRequire` stays on.
- **`pragma satoshicontainer single`**: all pledged BCH sits in one container coin, so a claim or refund can always
  find the full amount, and the container can never be drained below its reserve.
- **No `selfdestruct` payout.** A destination-pinned `selfdestruct` must consume every ledger entry in one
  transaction, which an unbounded number of backers would make impossible. `claim` uses an ordinary pinned
  transfer instead.
- **Constructor checks.** `goal > 0` and `minPledge >= 1000` (dust-safe pledges), validated again in the UI.

## Residual risks (covenant)

- **Compiler correctness.** The guarantees above are only as good as SolidCash 0.51.1's code generation. It is a
  beta without an independent audit. The test suite exercises each guarantee against the compiled bytecode in the
  BCH 2026 VM with mainnet limits, but tests are not a proof.
- **Late pledges** (see the README): pledges after the deadline are possible until someone finalizes.
- **Creator self-funding** can trigger success; this is inherent to all-or-nothing crowdfunding.
- **State contention.** Concurrent actions conflict on the state coin; the loser retries. A griefer could spam
  pledges to delay others, at a cost of about 11,500 sats per attempt plus the minimum pledge.

## Web app

| Threat | Mitigation |
| --- | --- |
| Malicious campaign link | `decodeRef` validates every field (hex lengths, compressed pubkey prefix, integer ranges, network allow-list). The app then derives the covenant from those parameters; a link that does not match a real on-chain covenant shows "Campaign not found". Beneficiary and creator are shown before any action. |
| Typo or float errors in amounts | Amounts are parsed as decimal strings into `bigint` satoshis; at most 8 decimals; no floats anywhere. |
| Wrong-network funds | Each network has its own wallet; WIF imports are rejected for the wrong network; beneficiary addresses must carry the right prefix. |
| Key theft at rest | Keys are stored only encrypted (AES-256-GCM, a key derived with PBKDF2-SHA256 at 600,000 iterations, random salt and IV). |
| Key theft at runtime (XSS) | Strict CSP: `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, no third-party code, analytics or fonts; `connect-src` limited to the two Electrum servers; `frame-ancestors 'none'`. React escapes all on-chain strings (titles). |
| Clickjacking | `X-Frame-Options: DENY` and `frame-ancestors 'none'`. |
| Accidental mainnet actions | Mainnet shows a persistent warning; every value-moving action on a live network requires confirmation with the exact amount and destination. |
| Supply chain | Production dependencies are React plus the SolidCash SDK and libauth (pinned to an exact commit). `npm audit` reports 0 known vulnerabilities. The lockfile is checked for SSH-only URLs. |

The web app is not trusted by the covenant: a malicious or buggy front end cannot steal pledges, because every
rule above is enforced on chain. It could, however, trick a user into signing a pledge to a different campaign,
so users should check the campaign's details panel before pledging large amounts.

## Reporting

Please report vulnerabilities privately to the repository owner before public disclosure.
