import { CopyButton } from './CopyButton';

export const VOTE_ADDRESS = 'bitcoincash:qp7slgwzvqw78zxahgczh329v3vne072zy3xcd9x94';

export function VoteBanner() {
  return (
    <section className="vote-banner" aria-label="Vote for SolidStarter">
      <img className="vote-qr" src="/vote-qr.svg" width={84} height={84} alt={`QR code for ${VOTE_ADDRESS}`} />
      <div className="vote-body">
        <strong className="vote-title">
          <span aria-hidden>🔥</span> Vote for SolidStarter at BCH BLAZE 2026
        </strong>
        <span className="vote-sub">Send BCH to our address to cast your vote:</span>
        <code className="vote-address">{VOTE_ADDRESS}</code>
        <div className="vote-actions">
          <CopyButton text={VOTE_ADDRESS} label="Copy address" />
          <a className="vote-open" href={VOTE_ADDRESS}>Open in wallet</a>
        </div>
      </div>
    </section>
  );
}
