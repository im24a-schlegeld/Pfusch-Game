import { lazy, Suspense } from 'react';
import { ArrowUpRight, Coins, ChevronLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Player } from '../domain/types';
import { levelProgress } from '../domain/progression';
export const Scene = lazy(() => import('../game/SceneView'));
export const fmt = (n: number) => Math.floor(n).toLocaleString('en-CH');
export const money = (n: number) => `CHF ${n.toFixed(2)}`;
export function SceneLoading() {
  return (
    <div className="scene-loading">
      <span className="spinner" />
      <span>WARMING UP THE ENGINE</span>
    </div>
  );
}
export function Preview(props: React.ComponentProps<typeof Scene>) {
  return (
    <Suspense fallback={<SceneLoading />}>
      <Scene {...props} />
    </Suspense>
  );
}
export function Coin({ value }: { value: number }) {
  return (
    <span className="coin">
      <Coins size={16} />
      {fmt(value)}
    </span>
  );
}
export function XpBar({ player }: { player: Player }) {
  const p = levelProgress(player.xp);
  return (
    <div className="xp-block">
      <div>
        <span>LEVEL {p.level.toString().padStart(2, '0')}</span>
        <span>
          {p.level === 10
            ? 'MAX LEVEL'
            : `${fmt(p.current)} / ${fmt(p.needed)} XP`}
        </span>
      </div>
      <Progress value={p.percent} aria-label="Level progress" />
    </div>
  );
}
export function ScreenHeading({
  kicker,
  title,
  back,
}: {
  kicker: string;
  title: string;
  back: () => void;
}) {
  return (
    <div className="screen-heading">
      <button
        className="icon-button"
        onClick={back}
        aria-label="Back to main menu"
      >
        <ChevronLeft />
      </button>
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
      </div>
    </div>
  );
}
export function ExternalArrow() {
  return <ArrowUpRight size={17} />;
}
