import { useEffect, useState } from 'react';
import { binToHex } from '@bitauth/libauth';
import { addressOf, addressToPkh, type Account, type Session } from '../lib/chain';
import { CONTAINER_RESERVE, deployCampaign, TITLE_MAX_BYTES, validateTitle } from '../lib/campaign';
import { decodeRef, type CampaignRef } from '../lib/campaign-ref';
import { formatBch, formatDate, friendlyError, parseBch, shortHex } from '../lib/format';
import { campaignHref } from '../App';

interface Props {
  session: Session;
  account: Account | null;
  campaigns: CampaignRef[];
  onCreated(ref: CampaignRef): void;
}

const EXAMPLES = [
  { title: 'Group gift for Maya’s farewell', goal: '0.05', min: '0.001', days: '5' },
  { title: 'Pre-order: 100 BCH meetup T-shirts', goal: '0.5', min: '0.01', days: '14' },
  { title: 'Neighbourhood playground repair', goal: '1', min: '0.0005', days: '30' },
];

export function Home({ session, account, campaigns, onCreated }: Props) {
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  return (
    <div className="home">
      <section className="hero">
        <h1>Raise money together. Refunds guaranteed by code.</h1>
        <p className="lead">
          SolidStarter is all-or-nothing crowdfunding on Bitcoin Cash. Pledges are held by a smart contract, not by
          the organiser or a platform. If the goal is reached, the beneficiary gets paid. If it is not, every backer
          takes back exactly what they put in.
        </p>
        <ol className="steps">
          <li><strong>Launch</strong> a campaign with a goal, a deadline and a beneficiary address.</li>
          <li><strong>Pledge</strong> BCH. Changed your mind? Withdraw any time while it is open.</li>
          <li><strong>Claim</strong> once the goal is hit, or <strong>refund</strong> after a miss or a cancellation.</li>
        </ol>
      </section>

      <div className="grid two">
        <CreateCampaign session={session} account={account} onCreated={onCreated} />

        <section className="card">
          <h2>{session.network === 'demo' ? 'Demo campaigns' : 'Your campaigns'}</h2>
          {campaigns.length === 0 ? (
            <p className="muted">
              {session.network === 'demo'
                ? 'Launch a campaign as the Creator persona, then switch personas to pledge as Alice, Bob and Carol.'
                : 'Campaigns you launch or open appear here (stored only in this browser).'}
            </p>
          ) : (
            <ul className="campaign-list">
              {campaigns.map((ref) => (
                <li key={ref.categoryId}>
                  <a href={campaignHref(ref)}>
                    <span>Campaign {shortHex(ref.categoryId, 5)}</span>
                    <span className="muted">
                      goal {formatBch(ref.goal)} BCH · ends {formatDate(ref.deadline)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <h3>Open a campaign link</h3>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const encoded = link.trim().split('#/c/').pop() ?? '';
                const ref = decodeRef(encoded);
                setLinkError(null);
                window.location.hash = campaignHref(ref);
              } catch (err) {
                setLinkError((err as Error).message);
              }
            }}
          >
            <input placeholder="Paste a SolidStarter link" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="submit" className="secondary">Open</button>
          </form>
          {linkError && <p className="error-text">{linkError}</p>}
        </section>
      </div>
    </div>
  );
}

function CreateCampaign({ session, account, onCreated }: Omit<Props, 'campaigns'>) {
  const isDemo = session.network === 'demo';
  const defaultBeneficiary = () => {
    if (isDemo) return addressOf(session.accounts[1].signer, 'demo');
    return account ? addressOf(account.signer, session.network) : '';
  };
  const [title, setTitle] = useState(EXAMPLES[0].title);
  const [beneficiary, setBeneficiary] = useState(defaultBeneficiary);
  const [goal, setGoal] = useState(EXAMPLES[0].goal);
  const [minPledge, setMinPledge] = useState(EXAMPLES[0].min);
  const [duration, setDuration] = useState(EXAMPLES[0].days);
  const [unit, setUnit] = useState<'hours' | 'days'>('days');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!beneficiary) setBeneficiary(defaultBeneficiary());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const durationSeconds = Math.round(Number(duration) * (unit === 'days' ? 86_400 : 3_600));
  const deadline = session.now() + (Number.isFinite(durationSeconds) ? durationSeconds : 0);

  const submit = async () => {
    setError(null);
    if (!account) throw new Error(isDemo ? 'Pick a persona.' : 'Create or unlock a wallet first.');
    if (!(durationSeconds >= 3_600 && durationSeconds <= 365 * 86_400)) {
      throw new Error('The campaign must run between 1 hour and 365 days.');
    }
    const params = {
      creatorPubkey: binToHex(account.signer.publicKey),
      beneficiaryPkh: addressToPkh(beneficiary, session.network),
      goal: parseBch(goal),
      minPledge: parseBch(minPledge),
      deadline,
    };
    const cleanTitle = validateTitle(title);
    if (!isDemo) {
      const ok = confirm(
        `Launch "${cleanTitle}" on ${session.network}?\n\n` +
          `Goal: ${formatBch(params.goal)} BCH\nDeadline: ${formatDate(deadline)}\nBeneficiary: ${beneficiary}\n\n` +
          `You will lock a ${CONTAINER_RESERVE} sat reserve plus small state-coin deposits and network fees.`,
      );
      if (!ok) return;
    }
    const { ref } = await deployCampaign(session, account.signer, params, cleanTitle);
    onCreated(ref);
  };

  return (
    <section className="card">
      <h2>Launch a campaign</h2>
      {isDemo && account?.label !== 'Creator' && (
        <p className="muted small">Tip: launch as the <strong>Creator</strong> persona so you can claim or cancel later.</p>
      )}
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.title}
            type="button"
            className="chip"
            onClick={() => {
              setTitle(ex.title);
              setGoal(ex.goal);
              setMinPledge(ex.min);
              setDuration(ex.days);
              setUnit('days');
            }}
          >
            {ex.title}
          </button>
        ))}
      </div>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await submit();
          } catch (err) {
            setError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Title <small className="muted">(stored on chain, max {TITLE_MAX_BYTES} bytes)</small>
          <input value={title} maxLength={TITLE_MAX_BYTES} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Beneficiary address <small className="muted">(receives the funds if the goal is met; cannot be changed later)</small>
          <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder={isDemo ? 'bchtest:…' : 'bitcoincash:…'} required />
        </label>
        <div className="row">
          <label>
            Goal (BCH)
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} required />
          </label>
          <label>
            Minimum pledge (BCH)
            <input inputMode="decimal" value={minPledge} onChange={(e) => setMinPledge(e.target.value)} required />
          </label>
        </div>
        <div className="row">
          <label>
            Runs for
            <input inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} required />
          </label>
          <label>
            &nbsp;
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'hours' | 'days')}>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </label>
        </div>
        <p className="muted small">Ends {Number.isFinite(deadline) ? formatDate(deadline) : '—'} (chain time).</p>
        <button type="submit" disabled={busy || !account}>
          {busy ? 'Deploying covenant…' : 'Launch campaign'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </section>
  );
}
