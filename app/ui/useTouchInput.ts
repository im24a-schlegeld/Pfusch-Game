import { useSyncExternalStore } from 'react';

// Browsers cannot report whether a physical keyboard is connected. Remember
// actual keyboard/touch use across screens, including on hybrid devices.
let lastInput: 'touch' | 'keyboard' | null = null;
const capability = () => typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || window.matchMedia('(any-pointer: coarse)').matches);
let touchObserved = false;
let monitoring = false;
const listeners = new Set<() => void>();
const snapshot = () => {
  const capable = capability() || touchObserved;
  return (capable ? 1 : 0) | (capable && lastInput !== 'keyboard' ? 2 : 0);
};
const notify = () => { for (const listener of listeners) listener(); };
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!monitoring) {
    monitoring = true;
    // Keep one page-lifetime observer, even while neither Settings nor Ride is
    // mounted, so keyboard use in the garage also counts on the next ride.
    window.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      touchObserved = true; lastInput = 'touch'; notify();
    }, true);
    window.addEventListener('keydown', event => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      lastInput = 'keyboard'; notify();
    }, true);
    window.matchMedia('(any-pointer: coarse)').addEventListener('change', notify);
  }
  return () => { listeners.delete(listener); };
}

export function useTouchInput() {
  const state = useSyncExternalStore(subscribe, snapshot, () => 0);
  return { touchCapable: !!(state & 1), touchActive: !!(state & 2) };
}
