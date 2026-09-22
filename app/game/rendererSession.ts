import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

interface RendererResources {
  renderer: THREE.WebGLRenderer;
  environment: THREE.WebGLRenderTarget;
}
interface Session extends RendererResources {
  antialias: boolean;
  busy: boolean;
  lost: boolean;
  destroyed: boolean;
  retired?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  onLost: () => void;
}

function createResources(antialias: boolean): RendererResources {
  const renderer = new THREE.WebGLRenderer({
    antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  let studio: RoomEnvironment | undefined;
  let generator: THREE.PMREMGenerator | undefined;
  try {
    studio = new RoomEnvironment();
    generator = new THREE.PMREMGenerator(renderer);
    return { renderer, environment: generator.fromScene(studio, 0.04) };
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  } finally {
    studio?.dispose();
    generator?.dispose();
  }
}

/** One reusable context per antialias setting. Concurrent views never share a canvas. */
export function createRendererSessionPool(
  create = createResources,
  idleMs = 30_000,
) {
  const cached = new Map<boolean, Session>();
  const retire = (session: Session) => {
    const cleanup = session.retired;
    session.retired = undefined;
    cleanup?.();
  };
  const destroy = (session: Session) => {
    if (session.destroyed) return;
    session.destroyed = true;
    clearTimeout(session.timer);
    if (cached.get(session.antialias) === session) cached.delete(session.antialias);
    session.renderer.domElement.removeEventListener('webglcontextlost', session.onLost);
    retire(session);
    session.environment.dispose();
    session.renderer.dispose();
    session.renderer.forceContextLoss();
    session.renderer.domElement.remove();
  };
  return {
    acquire(antialias: boolean) {
      let session = cached.get(antialias);
      if (session && session.renderer.getContext().isContextLost()) {
        session.lost = true;
        if (!session.busy) destroy(session);
      }
      if (!session || session.busy || session.lost) {
        const resources = create(antialias);
        const created: Session = {
          ...resources,
          antialias,
          busy: false,
          lost: false,
          destroyed: false,
          onLost: () => {
            created.lost = true;
            if (!created.busy) destroy(created);
          },
        };
        resources.renderer.domElement.addEventListener('webglcontextlost', created.onLost);
        // An overlapping preview uses a temporary context, disposed on release.
        if (!session || session.lost) cached.set(antialias, created);
        session = created;
      }
      const current = session;
      current.busy = true;
      clearTimeout(current.timer);
      current.timer = undefined;
      let released = false;
      let rendered = false;
      return {
        renderer: current.renderer,
        environment: current.environment,
        afterRender() {
          if (released || rendered) return;
          rendered = true;
          // New bike materials now own the matching Three shader programs.
          retire(current);
        },
        release(materialCleanup: () => void = () => {}) {
          if (released) return;
          released = true;
          current.busy = false;
          current.renderer.domElement.remove();
          current.renderer.renderLists.dispose();
          if (rendered) {
            retire(current);
            current.retired = materialCleanup;
          } else {
            // StrictMode can release before a frame: keep the last warm set,
            // never accumulate materials from unrendered mounts.
            materialCleanup();
          }
          if (current.lost || cached.get(antialias) !== current) {
            destroy(current);
          } else {
            current.timer = setTimeout(() => destroy(current), idleMs);
          }
        },
      };
    },
    disposeIdle() {
      for (const session of cached.values())
        if (!session.busy) destroy(session);
    },
  };
}

export const rendererSessions = createRendererSessionPool();
