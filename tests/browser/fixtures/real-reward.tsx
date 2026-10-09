import { createRoot } from 'react-dom/client';
import RealRewardCard from '../../../app/ui/RealRewardCard';
import { OxygenVerifiedRewards } from '../../../app/services/verifiedRewards';

createRoot(document.getElementById('root')!).render(
  <RealRewardCard service={new OxygenVerifiedRewards(window.fetch.bind(window))}
    onSignIn={() => { document.body.dataset.signIn = 'requested'; }} />,
);
