import { Vector3, type Camera } from 'three';
import type { PoliceImpactEvent } from './policePursuit';

let burstInstance = 0;

/** Keep offscreen feedback inside the ride without moving its camera. */
export function policeImpactPlacement(
  impact: PoliceImpactEvent,
  camera: Camera,
  distance: number,
) {
  camera.updateMatrixWorld();
  const world = new Vector3(impact.x, 0.9, distance - impact.worldDistance);
  const local = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const screen = world.project(camera);
  const onscreen =
    local.z < 0 &&
    screen.z > -1 &&
    screen.z < 1 &&
    Math.abs(screen.x) < 0.92 &&
    Math.abs(screen.y) < 0.88;
  return {
    show: impact.fallback || !onscreen,
    // Camera-local lateral offset keeps a crash behind the rider on its true
    // side; perspective projection would mirror it across the screen.
    x: 50 + Math.max(-1, Math.min(1, local.x / 2.8)) * 30,
    y: 100,
  };
}

/** One bounded, reusable SVG burst. No per-frame React updates or timers. */
export function createPoliceCrashEffect(host: HTMLElement, initialSerial = 0) {
  const shadeId = `police-burst-${++burstInstance}`;
  const roundedFire = 'M61 234C40 220 50 193 73 194C63 178 76 157 96 160C89 140 111 120 132 134C123 102 152 88 169 108C182 89 212 103 212 126C239 113 265 132 256 153C280 148 299 170 286 190C316 195 311 222 291 234Z';
  const hotCore = 'M96 234C71 218 82 200 102 198C93 175 120 164 139 177C133 143 157 131 176 150C198 134 224 154 214 172C244 166 258 184 250 206C279 208 279 227 260 234Z';
  const root = document.createElement('div');
  root.className = 'police-crash-cartoon';
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'absolute',
    width: 'min(62%, 270px)',
    aspectRatio: '360 / 270',
    pointerEvents: 'none',
    zIndex: '4',
    display: 'none',
    transform: 'translate(-50%, -100%)',
    transformOrigin: '50% 100%',
  });
  root.innerHTML = `<svg viewBox="0 0 360 270" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${shadeId}-flare" x1="25%" y1="0%" x2="70%" y2="100%"><stop stop-color="#ffae28"/><stop offset=".52" stop-color="#ef6512"/><stop offset="1" stop-color="#b43808"/></linearGradient>
      <linearGradient id="${shadeId}-fire" x1="18%" y1="5%" x2="75%" y2="100%"><stop stop-color="#ffd650"/><stop offset=".42" stop-color="#ffaf20"/><stop offset="1" stop-color="#df710a"/></linearGradient>
      <radialGradient id="${shadeId}-core" cx="36%" cy="20%" r="86%"><stop stop-color="#ffe86a"/><stop offset=".55" stop-color="#ffc62c"/><stop offset="1" stop-color="#eb900b"/></radialGradient>
    </defs>
    <ellipse class="police-impact-ring" cx="180" cy="226" rx="100" ry="18" fill="none" stroke="#ffdb72" stroke-width="7"/>
    <g class="police-impact-fire" stroke="#080a0e" stroke-width="3.5" stroke-linejoin="round">
      <path d="M25 234Q17 216 46 205L17 177L75 193L56 164Q94 156 108 175L87 120L121 143L111 54L151 121L165 91L166 139L218 28L209 128L240 105L231 150Q259 125 279 136L265 176L324 158L294 201L346 214L301 234Z" fill="url(#${shadeId}-flare)"/>
      <path d="${roundedFire}" fill="#9d3609" stroke="none" opacity=".30" transform="translate(5 8)"/>
      <path d="${roundedFire}" fill="url(#${shadeId}-fire)"/>
      <path d="M100 151C102 138 117 131 129 140M137 118C137 106 151 102 161 111M223 133C237 131 247 140 246 149" fill="none" stroke="#ffe16a" stroke-width="5" stroke-linecap="round" opacity=".75"/>
    </g>
    <g class="police-impact-core" stroke="#080a0e" stroke-width="3.5" stroke-linejoin="round">
      <path d="${hotCore}" fill="#b55109" stroke="none" opacity=".38" transform="translate(6 7)"/>
      <path d="${hotCore}" fill="url(#${shadeId}-core)"/>
      <path d="M147 165C143 150 159 145 169 153M109 188C115 181 126 180 133 185M187 157C194 153 204 158 206 165" fill="none" stroke="#ffe66f" stroke-width="5" stroke-linecap="round" opacity=".8"/>
    </g>
    ${Array.from({ length: 8 }, (_, i) => `<g class="police-impact-ember" fill="${i % 2 ? '#f38317' : '#ec5820'}" stroke="#080a0e" stroke-width="2" stroke-linejoin="round"><path d="${['M-2 -10L3 -3L1 7L-4 2Z', 'M-6 -3L6 -1L2 5Z', 'M-2 -6L3 0L0 4L-4 2Z'][i % 3]}"/></g>`).join('')}
  </svg>`;
  const fire = root.querySelector<SVGElement>('.police-impact-fire')!;
  const core = root.querySelector<SVGElement>('.police-impact-core')!;
  const ring = root.querySelector<SVGElement>('.police-impact-ring')!;
  const embers = [...root.querySelectorAll<SVGGElement>('.police-impact-ember')];
  const emberMotion = [[-156, -58], [-121, -148], [-57, -203], [-32, -87],
    [54, -169], [96, -71], [137, -121], [167, -31]];
  host.appendChild(root);
  let seen = initialSerial,
    elapsed = 2;
  return {
    update(
      impact: PoliceImpactEvent,
      camera: Camera,
      distance: number,
      dt: number,
      active: boolean,
      reducedMotion: boolean,
    ) {
      if (impact.serial !== seen) {
        seen = impact.serial;
        const position = policeImpactPlacement(impact, camera, distance);
        elapsed = position.show ? 0 : 2;
        root.dataset.policeImpact = String(seen);
        root.style.left = `${position.x}%`;
        root.style.top = `${position.y}%`;
      }
      if (active) elapsed += Math.max(0, Math.min(0.1, dt));
      const duration = 1.05;
      if (elapsed >= duration) {
        root.style.display = 'none';
        return;
      }
      root.style.display = 'block';
      const age = reducedMotion ? 0.24 : elapsed;
      const bloom = 1 - (1 - Math.min(1, age / 0.18)) ** 3;
      const scale = 0.2 + bloom * 0.8;
      fire.setAttribute('transform', `translate(180 226) scale(${scale} ${scale * (1 + Math.sin(age * 27) * 0.05)}) translate(-180 -226)`);
      fire.setAttribute('opacity', String(Math.max(0, 1 - Math.max(0, age - 0.24) * 1.8)));
      core.setAttribute('transform', `translate(180 226) scale(${0.15 + bloom * 0.9}) translate(-180 -226)`);
      core.setAttribute('opacity', String(Math.max(0, 1 - Math.max(0, age - 0.18) * 2.3)));
      ring.setAttribute('transform', `translate(180 226) scale(${0.4 + age * 2.4} ${0.6 + age}) translate(-180 -226)`);
      ring.setAttribute('opacity', String(Math.max(0, 0.8 - age * 2)));
      embers.forEach((ember, i) => {
        const [dx, dy] = emberMotion[i], flight = Math.min(1, age * (1.8 + i % 3 * 0.37));
        ember.setAttribute('transform', `translate(${180 + dx * flight} ${226 + dy * flight + age * age * 92}) rotate(${i * 67 + age * (i % 2 ? -105 : 170)}) scale(${0.7 + i % 3 * 0.18})`);
        ember.setAttribute('opacity', String(Math.max(0, 1 - Math.max(0, age - 0.12) * 1.5)));
      });
      root.style.opacity = String(
        reducedMotion ? 1 : Math.min(1, (duration - elapsed) / 0.22),
      );
    },
    dispose() {
      root.remove();
    },
  };
}
