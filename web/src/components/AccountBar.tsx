import { useEffect, useState } from 'react';
import { addressOf, balanceOf, signerFromKey, type Account, type Session } from '../lib/chain';
import { formatBch, shortAddress } from '../lib/format';
import {
  exportWif,
  forgetWallet,
  hasStoredWallet,
  importWif,
  newPrivateKey,
  saveWallet,
  unlockWallet,
} from '../lib/wallet';
import { CopyButton } from './CopyButton';

interface Props {
  session: Session;
  accountIndex: number;
  onSelectAccount(index: number): void;
  liveAccount: Account | null;
  onLiveAccount(account: Account | null): void;
  tick: number;
}

export function AccountBar({ session, accountIndex, onSelectAccount, liveAccount, onLiveAccount, tick }: Props) {
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  const accounts = session.network === 'demo' ? session.accounts : liveAccount ? [liveAccount] : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        accounts.map(async (a) => [a.label, await balanceOf(a.signer).catch(() => -1n)] as const),
      );
      if (!cancelled) setBalances(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, liveAccount, tick]);

  if (session.network === 'demo') {
    return (
      <section className="accountbar">
        <span className="muted">Acting as</span>
        <div className="personas" role="radiogroup" aria-label="Demo persona">
          {session.accounts.map((a, i) => (
            <button
              key={a.label}
              role="radio"
              aria-checked={i === accountIndex}
              className={i === accountIndex ? 'persona active' : 'persona'}
              onClick={() => onSelectAccount(i)}
            >
              <strong>{a.label}</strong>
              <small>{balances[a.label] !== undefined ? `${formatBch(balances[a.label])} BCH` : '…'}</small>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <LiveWallet
      session={session}
      account={liveAccount}
      balance={liveAccount ? balances[liveAccount.label] : undefined}
      onAccount={onLiveAccount}
    />
  );
}

function LiveWallet({
  session,
  account,
  balance,
  onAccount,
}: {
  session: Session;
  account: Account | null;
  balance: bigint | undefined;
  onAccount(a: Account | null): void;
}) {
  const network = session.network;
  const [mode, setMode] = useState<'idle' | 'create' | 'import'>('idle');
  const [password, setPassword] = useState('');
  const [wif, setWif] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const stored = hasStoredWallet(network);

  const open = (key: Uint8Array) => onAccount({ label: 'My wallet', signer: signerFromKey(session, key) });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPassword('');
      setWif('');
      setMode('idle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    const address = addressOf(account.signer, network);
    return (
      <section className="accountbar live">
        <div className="wallet-line">
          <span className="muted">Wallet</span>
          <code title={address}>{shortAddress(address)}</code>
          <CopyButton text={address} label="Copy address" />
          <span className="balance">
            {balance === undefined ? '…' : balance < 0n ? 'balance unavailable' : `${formatBch(balance)} BCH`}
          </span>
          <button className="link" onClick={() => setShowBackup((s) => !s)}>
            {showBackup ? 'Hide backup' : 'Back up key'}
          </button>
          <button className="link" onClick={() => onAccount(null)}>Lock</button>
        </div>
        {showBackup && (
          <div className="backup">
            <p className="warn-text">
              Anyone with this key can spend your funds and act on your pledges. Store it offline; never paste it into
              a website you do not trust.
            </p>
            <code className="secret">{exportWif(network, account.signer.privateKey)}</code>
          </div>
        )}
        {balance === 0n && (
          <p className="muted small">
            Send a small amount of {network === 'mainnet' ? 'BCH' : 'chipnet tBCH (free from a faucet)'} to this address
            to pledge or launch a campaign.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="accountbar live">
      {stored && mode === 'idle' && (
        <form
          className="wallet-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => open(await unlockWallet(network, password)));
          }}
        >
          <span className="muted">Unlock your {network} wallet</span>
          <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          <button
            type="button"
            className="link danger"
            onClick={() => {
              if (confirm('Remove the encrypted wallet from this browser? Make sure you have its backup key.')) {
                forgetWallet(network);
                setMode('idle');
                onAccount(null);
                setError(null);
                window.location.reload();
              }
            }}
          >
            Forget wallet
          </button>
        </form>
      )}
      {!stored && mode === 'idle' && (
        <div className="wallet-form">
          <span className="muted">No {network} wallet in this browser.</span>
          <button onClick={() => setMode('create')}>Create wallet</button>
          <button className="secondary" onClick={() => setMode('import')}>Import WIF key</button>
        </div>
      )}
      {mode !== 'idle' && (
        <form
          className="wallet-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const key = mode === 'create' ? newPrivateKey() : importWif(network, wif);
              await saveWallet(network, key, password);
              open(key);
            });
          }}
        >
          {mode === 'import' && (
            <input type="password" autoComplete="off" placeholder="WIF private key" value={wif} onChange={(e) => setWif(e.target.value)} />
          )}
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password (10+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy}>{busy ? 'Encrypting…' : mode === 'create' ? 'Create & encrypt' : 'Import & encrypt'}</button>
          <button type="button" className="link" onClick={() => setMode('idle')}>Cancel</button>
          <p className="muted small full">
            The key is encrypted with your password (AES-256-GCM, PBKDF2 600k) and stored only in this browser.
          </p>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
