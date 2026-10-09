import StopSign from './StopSign';
import './game-brand.css';
import './signs-lockup.css';

/** The original Signs artwork stays intact; the lockup has a level baseline. */
export default function GameBrand({ wordmark = false, className = '' }: { wordmark?: boolean; className?: string }) {
  // The original Signs, STOP and title assets form one accessible image.
  // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <span className={`game-brand${wordmark ? ' game-brand-wordmark' : ''} ${className}`} role="img" aria-label={wordmark ? 'PFUSCH Wheelie Escape' : 'PFUSCH Signs'}>
    <span className="game-brand-signs signs-lockup">
      <img className="signs-lockup-artwork" src="/images/artwork/signs.png" alt="" />
      <StopSign className="game-brand-stop signs-lockup-stop" />
    </span>
    {wordmark && <img className="game-brand-title" src="/branding/wheelie-escape-wordmark-a.png" alt="" />}
  </span>;
}
