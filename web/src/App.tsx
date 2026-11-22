import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDemoSession, createLiveSession, type Account, type Session } from './lib/chain';
import { decodeRef, encodeRef, refKey, type CampaignRef, type NetworkName } from './lib/campaign-ref';
import { Home } from './components/Home';
import { CampaignPage } from './components/CampaignPage';
import { AccountBar } from './components/AccountBar';

const SAVED_KEY = 'solidstarter.campaigns.v1';

type Route = { name: 'home' } | { name: 'campaign'; ref: CampaignRef } | { name: 'bad-link'; error: string };

function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/c\/([A-Za-z0-9_-]+)$/);
  if (!match) return { name: 'home' };
  try {
    return { name: 'campaign', ref: decodeRef(match[1]) };
  } catch (error) {
    return { name: 'bad-link', error: (error as Error).message };
  }
}

export function campaignHref(ref: CampaignRef): string {
  return `#/c/${encodeRef(ref)}`;
}

function loadSaved(): CampaignRef[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(list) ? list.flatMap((s) => { try { return [decodeRef(String(s))]; } catch { return []; } }) : [];
  } catch {
    return [];
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [network, setNetwork] = useState<NetworkName>(() => {
    const r = parseRoute(window.location.hash);
    return r.name === 'campaign' ? r.ref.network : 'demo';
  });
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [accountIndex, setAccountIndex] = useState(0);
  const [liveAccount, setLiveAccount] = useState<Account | null>(null);
  const [saved, setSaved] = useState<CampaignRef[]>(loadSaved);
  const [demoCampaigns, setDemoCampaigns] = useState<CampaignRef[]>([]);
  const [tick, setTick] = useState(0); // bump to refresh balances / state after an action

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A campaign link pins its network.
  useEffect(() => {
    if (route.name === 'campaign' && route.ref.network !== network) setNetwork(route.ref.network);
  }, [route, network]);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setSessionError(null);
    setLiveAccount(null);
    setAccountIndex(0);
    (async () => {
      try {
        const next = network === 'demo' ? await createDemoSession() : createLiveSession(network);
        if (!cancelled) setSession(next);
      } catch (error) {
        if (!cancelled) setSessionError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network]);

  // Demo campaigns live in the in-memory chain; drop them when it is recreated.
  useEffect(() => setDemoCampaigns([]), [network]);

  const account: Account | null = useMemo(() => {
    if (!session) return null;
    if (session.network === 'demo') return session.accounts[accountIndex] ?? null;
    return liveAccount;
  }, [session, accountIndex, liveAccount]);

  const remember = useCallback((ref: CampaignRef) => {
    if (ref.network === 'demo') {
      setDemoCampaigns((list) => [ref, ...list.filter((r) => refKey(r) !== refKey(ref))]);
      return;
    }
    setSaved((list) => {
      const next = [ref, ...list.filter((r) => refKey(r) !== refKey(ref))].slice(0, 50);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next.map(encodeRef)));
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>◆</span> SolidStarter
        </a>
        <nav className="network-switch" aria-label="Network">
          {(['demo', 'chipnet', 'mainnet'] as NetworkName[]).map((n) => (
            <button
              key={n}
              className={n === network ? 'active' : ''}
              onClick={() => {
                setNetwork(n);
                if (route.name === 'campaign' && route.ref.network !== n) window.location.hash = '#/';
              }}
            >
              {n === 'demo' ? 'Demo' : n === 'chipnet' ? 'Chipnet' : 'Mainnet'}
            </button>
          ))}
        </nav>
      </header>

      {network === 'mainnet' && (
        <div className="banner warn">
          Mainnet uses real BCH. SolidCash 0.51 is beta software without an independent audit, so keep amounts small.
        </div>
      )}
      {network === 'demo' && (
        <div className="banner info">
          Demo mode runs a full BCH virtual machine in your browser with play money. Every rule you see is enforced
          by the real compiled contract. Nothing leaves this tab.
        </div>
      )}

      {sessionError && <div className="banner error">Could not connect: {sessionError}</div>}

      {session && (
        <AccountBar
          session={session}
          accountIndex={accountIndex}
          onSelectAccount={setAccountIndex}
          liveAccount={liveAccount}
          onLiveAccount={setLiveAccount}
          tick={tick}
        />
      )}

      <main className="content">
        {!session && !sessionError && <div className="loading">Connecting to {network}…</div>}
        {session && route.name === 'home' && (
          <Home
            session={session}
            account={account}
            campaigns={network === 'demo' ? demoCampaigns : saved.filter((r) => r.network === network)}
            onCreated={(ref) => {
              remember(ref);
              refresh();
              window.location.hash = campaignHref(ref);
            }}
          />
        )}
        {session && route.name === 'campaign' && route.ref.network === session.network && (
          <CampaignPage
            key={refKey(route.ref)}
            session={session}
            campaignRef={route.ref}
            account={account}
            onOpened={remember}
            onChanged={refresh}
          />
        )}
        {route.name === 'bad-link' && (
          <div className="card">
            <h2>That campaign link is not valid</h2>
            <p className="muted">{route.error}</p>
            <a href="#/">Back to start</a>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>
          Non-custodial crowdfunding on Bitcoin Cash, written in Solidity with{' '}
          <a href="https://github.com/solidcash/solidcash" target="_blank" rel="noreferrer noopener">SolidCash</a>.
        </span>
        <span className="muted">Your keys never leave this browser.</span>
      </footer>
    </div>
  );
}
