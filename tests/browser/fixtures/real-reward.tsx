import { createRoot } from 'react-dom/client';
import RealRewardCard from '../../../app/ui/RealRewardCard';
import SaveAccessGate from '../../../app/ui/SaveAccessGate';
import { Rewards } from '../../../app/ui/Screens';
import { newPlayer } from '../../../app/domain/progression';
import type { Services } from '../../../app/services';
import { OxygenVerifiedRewards } from '../../../app/services/verifiedRewards';
import '../../../app/globals.css';
import '../../../app/pfusch-shop-ui.css';
import '../../../app/refinement-v40.css';
import '../../../app/ride-fix-v42.css';
import '../../../app/shop-typography.css';

const mode = new URLSearchParams(window.location.search).get('view');
const service = new OxygenVerifiedRewards(window.fetch.bind(window));
const onSignIn = () => { document.body.dataset.signIn = 'requested'; };
const loginHref = '/auth/login?return_to=https%3A%2F%2Fgame.pfusch-clothing.ch%2F';
const player = newPlayer();
const services: Services = {
  auth: { getUser: async () => ({ id: player.id, kind: 'guest' }) },
  players: { load: async () => player, save: () => {}, export: () => '', warning: '' },
  products: { list: async () => [] },
  rewards: { real: service, settle: () => null, redeem: () => null },
  leaderboard: { list: () => [] },
  analytics: { track: () => {} },
};
createRoot(document.getElementById('root')!).render(mode === 'gate'
  ? <SaveAccessGate open access={{ allowed: false, reason: 'newsletter_required', completedRuns: 5, freeRuns: 5 }}
    checking={false} loginHref={loginHref} onLogin={onSignIn} onNewsletter={() => { document.body.dataset.newsletter = 'requested'; }}
    onStart={() => { document.body.dataset.start = 'requested'; }} back={() => { document.body.dataset.back = 'requested'; }} />
  : mode === 'rewards'
    ? <Rewards player={player} services={services} update={() => {}} notify={() => {}} back={() => { document.body.dataset.back = 'requested'; }}
      loginHref={loginHref} onLogin={onSignIn} />
    : <RealRewardCard service={service} loginHref={mode === 'fallback' ? undefined : loginHref} onSignIn={onSignIn} />);
