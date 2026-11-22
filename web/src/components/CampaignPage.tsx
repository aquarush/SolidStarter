import { useCallback, useEffect, useState } from 'react';
import { binToHex } from '@bitauth/libauth';
import { CampaignClient, Phase, PHASE_LABEL, type CampaignSnapshot } from '../lib/campaign';
import type { CampaignRef } from '../lib/campaign-ref';
import { addressOf, pkhToAddress, type Account, type Session } from '../lib/chain';
import { formatBch, formatDate, friendlyError, parseBch, relativeTime, shortAddress, shortHex } from '../lib/format';
import { campaignHref } from '../App';
import { CopyButton } from './CopyButton';

interface Props {
  session: Session;
  campaignRef: CampaignRef;
  account: Account | null;
  onOpened(ref: CampaignRef): void;
  onChanged(): void;
}

/** On live networks a time-locked spend is final only once median block time passes the deadline (~1h lag). */
const LIVE_FINALITY_MARGIN = 3_600;

export function CampaignPage({ session, campaignRef: ref, account, onOpened, onChanged }: Props) {
  const [client, setClient] = useState<CampaignClient | null>(null);
  const [snap, setSnap] = useState<CampaignSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myPledge, setMyPledge] = useState<bigint>(0n);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string; txid?: string } | null>(null);
  const [now, setNow] = useState(session.now());

  const myPkh = account ? binToHex(account.signer.pkh) : null;
  const isCreator = account ? binToHex(account.signer.publicKey) === ref.creatorPubkey : false;

  const reload = useCallback(
    async (c: CampaignClient | null = client) => {
      if (!c) return;
      const next = await c.snapshot();
      setSnap(next);
      setNow(session.now());
      setMyPledge(myPkh ? await c.pledgeOf(myPkh) : 0n);
    },
    [client, myPkh, session],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await CampaignClient.open(session, ref);
        if (cancelled) return;
        setClient(c);
        onOpened(ref);
        await reload(c);
      } catch (error) {
        if (!cancelled) setLoadError(friendlyError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ref]);

  useEffect(() => {
    reload().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPkh]);

  // Live networks: poll so other people's pledges show up.
  useEffect(() => {
    if (session.network === 'demo' || !client) return;
    const id = setInterval(() => reload().catch(() => undefined), 30_000);
    return () => clearInterval(id);
  }, [session, client, reload]);

  const act = async (label: string, fn: () => Promise<string | void>, confirmText?: string) => {
    if (confirmText && session.network !== 'demo' && !confirm(confirmText)) return;
    setBusy(label);
    setNotice(null);
    try {
      const txid = await fn();
      setNotice({ kind: 'ok', text: `${label} confirmed by the contract.`, txid: txid || undefined });
      await reload();
      onChanged();
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error) });
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="card">
        <h2>Campaign not found</h2>
        <p className="muted">
          No SolidStarter covenant with these parameters exists on {ref.network}, or the network could not be reached.
        </p>
        <p className="error-text">{loadError}</p>
        <a href="#/">Back</a>
      </div>
    );
  }
  if (!client || !snap) return <div className="loading">Loading campaign state from the chain…</div>;

  const pastDeadline = now >= ref.deadline;
  const finalizable = session.network === 'demo' ? pastDeadline : now >= ref.deadline + LIVE_FINALITY_MARGIN;
  const goalMet = snap.raised >= ref.goal;
  const shareUrl = `${window.location.origin}${window.location.pathname}${campaignHref(ref)}`;
  const beneficiaryAddress = pkhToAddress(ref.beneficiaryPkh, session.network);
  const signer = account?.signer;

  const phaseClass = snap.phase === Phase.Succeeded ? 'ok' : snap.phase === Phase.Failed ? 'bad' : 'live';

  return (
    <div className="campaign">
      <section className="card campaign-head">
        <div className="title-row">
          <h1>{snap.title}</h1>
          <span className={`badge ${phaseClass}`}>{PHASE_LABEL[snap.phase]}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snap.progressBps / 100}>
          <div className="progress-fill" style={{ width: `${snap.progressBps / 100}%` }} />
        </div>
        <div className="stats">
          <div>
            <strong>{formatBch(snap.raised)} BCH</strong>
            <span className="muted">raised of {formatBch(ref.goal)} BCH ({(snap.progressBps / 100).toFixed(1)}%)</span>
          </div>
          <div>
            <strong>{snap.backerCount.toString()}</strong>
            <span className="muted">backers</span>
          </div>
          <div>
            <strong>{pastDeadline ? 'Ended' : relativeTime(ref.deadline, now)}</strong>
            <span className="muted">deadline {formatDate(ref.deadline)}</span>
          </div>
        </div>
        {snap.phase === Phase.Succeeded && snap.raised === 0n && (
          <p className="ok-text">Funded and paid out to the beneficiary.</p>
        )}
      </section>

      <div className="grid two">
        <section className="card">
          <h2>Actions</h2>
          {!signer && <p className="muted">{session.network === 'demo' ? 'Pick a persona above.' : 'Unlock a wallet above to take part.'}</p>}
          {signer && (
            <p className="muted small">
              Acting as <strong>{account!.label}</strong>
              {isCreator && ' (campaign creator)'} · your pledge: <strong>{formatBch(myPledge)} BCH</strong>
            </p>
          )}

          {snap.phase === Phase.Funding && signer && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                let sats: bigint;
                try {
                  sats = parseBch(amount);
                } catch (err) {
                  setNotice({ kind: 'error', text: (err as Error).message });
                  return;
                }
                act(
                  'Pledge',
                  () => client.pledge(signer, sats),
                  `Pledge ${formatBch(sats)} BCH to "${snap.title}"?\n\nYou can withdraw it any time while the campaign is open, or reclaim it if the campaign fails.`,
                ).then(() => setAmount(''));
              }}
            >
              <input
                inputMode="decimal"
                placeholder={`Amount in BCH (min ${formatBch(ref.minPledge)})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button type="submit" disabled={!!busy}>{busy === 'Pledge' ? 'Pledging…' : 'Pledge'}</button>
            </form>
          )}

          <div className="actions">
            {snap.phase === Phase.Funding && myPledge > 0n && signer && (
              <button className="secondary" disabled={!!busy} onClick={() => act('Withdraw', () => client.withdraw(signer), `Withdraw your ${formatBch(myPledge)} BCH pledge?`)}>
                Withdraw my pledge
              </button>
            )}
            {snap.phase === Phase.Failed && myPledge > 0n && signer && (
              <button disabled={!!busy} onClick={() => act('Refund', () => client.refund(signer), `Reclaim your ${formatBch(myPledge)} BCH pledge to ${addressOf(signer, session.network)}?`)}>
                Reclaim my {formatBch(myPledge)} BCH
              </button>
            )}
            {isCreator && signer && snap.phase !== Phase.Failed && snap.raised > 0n && (
              <button
                disabled={!!busy || !goalMet}
                title={goalMet ? '' : 'Available once the goal is reached'}
                onClick={() => act('Claim', () => client.claim(signer), `Send ${formatBch(snap.raised)} BCH to the beneficiary ${beneficiaryAddress}?`)}
              >
                Claim {formatBch(snap.raised)} BCH for beneficiary
              </button>
            )}
            {snap.phase === Phase.Funding && signer && (
              <button
                className="secondary"
                disabled={!!busy || !finalizable}
                title={finalizable ? '' : 'Available after the deadline'}
                onClick={() => act('Finalize', () => client.finalize(signer))}
              >
                Finalize campaign
              </button>
            )}
            {isCreator && signer && snap.phase === Phase.Funding && (
              <button
                className="danger"
                disabled={!!busy}
                onClick={() => {
                  if (session.network !== 'demo' || confirm('Cancel the campaign? Every backer will be able to reclaim their pledge. This cannot be undone.')) {
                    act('Cancel', () => client.cancel(signer));
                  }
                }}
              >
                Cancel campaign
              </button>
            )}
          </div>

          {snap.phase === Phase.Funding && pastDeadline && !finalizable && (
            <p className="muted small">
              The deadline has passed. Finalizing becomes possible once block time catches up (about an hour).
            </p>
          )}
          {busy && <p className="muted">Building, checking and broadcasting the {busy.toLowerCase()} transaction…</p>}
          {notice && (
            <p className={`action-notice ${notice.kind === 'ok' ? 'ok-text' : 'error-text'}`} role="status">
              {notice.text}{' '}
              {notice.txid && (session.explorerTx ? (
                <a href={session.explorerTx(notice.txid)} target="_blank" rel="noreferrer noopener">view tx</a>
              ) : (
                <code>{shortHex(notice.txid)}</code>
              ))}
            </p>
          )}

          {session.advanceTime && (
            <div className="demo-time">
              <h3>Demo clock</h3>
              <p className="muted small">Chain time: {formatDate(now)}</p>
              <div className="actions">
                <button className="secondary" disabled={!!busy} onClick={() => act('Advance 1 day', async () => session.advanceTime!(86_400))}>+1 day</button>
                <button
                  className="secondary"
                  disabled={!!busy || pastDeadline}
                  onClick={() => act('Skip past deadline', async () => session.advanceTime!(ref.deadline - now + 60))}
                >
                  Jump past deadline
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Backers</h2>
          {snap.backers.length === 0 ? (
            <p className="muted">No active pledges.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Backer</th><th className="num">Pledged</th></tr>
              </thead>
              <tbody>
                {snap.backers.map((b) => (
                  <tr key={b.pkh} className={b.pkh === myPkh ? 'me' : ''}>
                    <td><code title={pkhToAddress(b.pkh, session.network)}>{shortAddress(pkhToAddress(b.pkh, session.network))}</code>{b.pkh === myPkh && ' (you)'}</td>
                    <td className="num">{formatBch(b.amount)} BCH</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Activity</h3>
          {snap.activity.length === 0 ? (
            <p className="muted small">No events yet.</p>
          ) : (
            <ul className="activity">
              {snap.activity.map((a) => (
                <li key={`${a.kind}-${a.txid}-${a.backer ?? ''}`}>
                  <span className={`dot ${a.kind}`} aria-hidden />
                  <span>
                    <strong>{a.kind}</strong>
                    {a.amount !== undefined && ` ${formatBch(a.amount)} BCH`}
                    {a.backer && <span className="muted"> · {shortAddress(pkhToAddress(a.backer, session.network))}</span>}
                  </span>
                  {session.explorerTx ? (
                    <a className="muted small" href={session.explorerTx(a.txid)} target="_blank" rel="noreferrer noopener">{shortHex(a.txid, 4)}</a>
                  ) : (
                    <code className="muted small">{shortHex(a.txid, 4)}</code>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card details">
        <h2>Contract details</h2>
        <dl>
          <dt>Share link</dt>
          <dd><CopyButton text={shareUrl} label="Copy campaign link" /></dd>
          <dt>Beneficiary</dt>
          <dd><code>{beneficiaryAddress}</code></dd>
          <dt>Creator key</dt>
          <dd><code>{shortHex(ref.creatorPubkey, 10)}</code>{account && isCreator && ` (${addressOf(account.signer, session.network)})`}</dd>
          <dt>Minimum pledge</dt>
          <dd>{formatBch(ref.minPledge)} BCH</dd>
          <dt>CashToken category</dt>
          <dd><code>{ref.categoryId}</code></dd>
          <dt>Network</dt>
          <dd>{ref.network}</dd>
        </dl>
        <p className="muted small">
          The goal, deadline, minimum and beneficiary are compiled into the covenant's address, and the ledger lives in
          CashToken NFT commitments. Nobody — including the creator and this website — can change them or move pledges
          outside the rules.
        </p>
      </section>
    </div>
  );
}
