import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
  type ComponentProps,
} from 'react';
import { ArrowUpRight, Coins, ChevronLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Player } from '../domain/types';
import { levelProgress } from '../domain/progression';
import LoadingScreen, { PreviewLoading } from './LoadingScreen';
type SceneModule = Pick<typeof import('../game/SceneView'), 'default'> &
  Partial<Pick<typeof import('../game/SceneView'), 'preloadBikeAsset'>>;
let sceneModule: Promise<SceneModule> | undefined;
function SceneLoadError({ onLoadError, detail }: { onLoadError?: (message: string) => void; detail?: string }) {
  const message = detail || '3D-Ansicht konnte nicht geladen werden.';
  useEffect(() => { onLoadError?.(message); }, [message, onLoadError]);
  return (
    <div className="scene-loading" role="alert">
      <span>{message}</span>
      <button className="button" onClick={() => window.location.reload()}>
        NEU LADEN
      </button>
    </div>
  );
}

interface SceneBoundaryState {
  failed: boolean;
}

/** A WebGL preview must never take the menu or ride navigation down with it. */
class SceneErrorBoundary extends Component<
  { children: ReactNode; onLoadError?: (message: string) => void },
  SceneBoundaryState
> {
  state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D-Vorschau konnte nicht gestartet werden.', error, info.componentStack);
  }

  render() {
    return this.state.failed ? <SceneLoadError onLoadError={this.props.onLoadError} /> : this.props.children;
  }
}
/** Preload code only; the renderer is still created by the mounted Scene. */
export function preloadScene(bike?: Player['bike']): Promise<SceneModule> {
  sceneModule ??= import('../game/SceneView').catch((error: unknown) => {
    sceneModule = undefined;
    throw error;
  });
  return bike ? sceneModule.then(async (module) => {
    if (module.preloadBikeAsset) await module.preloadBikeAsset(bike);
    return module;
  }) : sceneModule;
}
type SceneProps = ComponentProps<SceneModule['default']>;
function SceneHost(props: SceneProps) {
  const [loaded, setLoaded] = useState<SceneModule['default'] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void preloadScene().then((module) => {
      if (active) setLoaded(() => module.default);
    }).catch((reason: unknown) => {
      console.error('3D-Ansicht konnte nicht geladen werden.', reason);
      if (active) setError(reason instanceof Error ? reason.message : '3D-Ansicht konnte nicht geladen werden.');
    });
    return () => { active = false; };
  }, []);
  if (error) return <SceneLoadError onLoadError={props.onLoadError} detail={error} />;
  if (!loaded) return <SceneLoading mode={props.mode} />;
  const LoadedScene = loaded;
  return <LoadedScene {...props} />;
}
export const Scene = SceneHost;
export const fmt = (n: number) => Math.floor(n).toLocaleString('en-CH');
export const money = (n: number) => `CHF ${n.toFixed(2)}`;
export function gameText(text: string) {
  const exact: Record<string, string> = {
    'Ride ended': 'Fahrt beendet',
    'Missed the side jump': 'Seitensprung verpasst',
    'Overrotated the wheelie': 'Wheelie überdreht',
    'Traffic collision': 'Kollision mit Verkehr',
    'Construction barrier collision': 'Kollision mit Baustellenabsperrung',
    'Caught the raised road edge': 'Fahrbahnkante getroffen',
    'Caught the pothole edge': 'Schlaglochkante getroffen',
    'Lost rear grip on wet asphalt': 'Hinterrad auf nassem Asphalt weggerutscht',
    'Lost traction on loose gravel': 'Auf losem Kies Traktion verloren',
    'RAMP TRANSFER': 'RAMPENWECHSEL',
    'TAIL SCRAPE': 'HECKSCHLEIFER',
    BALANCED: 'AUSBALANCIERT',
    'NEAR MISS': 'KNAPP VORBEI',
    'TOW TRUCK TRANSFER': 'ABSCHLEPPER-SPRUNG',
    'PFUSCH SET COMPLETE': 'PFUSCH-SATZ KOMPLETT',
    'CLEAN LIFT': 'SAUBER ANGEHOBEN',
    'SMOOTH LINE': 'SAUBERE LINIE',
    'CAUGHT THE SLIP': 'RUTSCHER ABGEFANGEN',
    'POLIZEI ABGEHÄNGT': 'POLIZEI ABGEHÄNGT',
    'POLIZEI CRASH': 'POLIZEI CRASH',
    'POLIZEI HAT DICH GERAMMT': 'POLIZEI HAT DICH GERAMMT',
  };
  if (text.startsWith('SIGN · ')) return `ZEICHEN · ${text.slice(7)}`;
  return exact[text] ?? text;
}
export function SceneLoading({ mode }: { mode: 'menu' | 'garage' | 'ride' }) {
  return mode === 'ride' ? <LoadingScreen label="STRECKE WIRD GELADEN" fullScreen /> : <PreviewLoading />;
}
export function Preview(props: ComponentProps<typeof Scene>) {
  return (
    <SceneErrorBoundary onLoadError={props.onLoadError}>
      <Scene {...props} />
    </SceneErrorBoundary>
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
        <span>STUFE {p.level.toString().padStart(2, '0')}</span>
        <span>
          {p.level === 10
            ? 'MAX. STUFE'
            : `${fmt(p.current)} / ${fmt(p.needed)} XP`}
        </span>
      </div>
      <Progress value={p.percent} aria-label="Stufenfortschritt" />
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
        aria-label="Zurück zur Garage"
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
