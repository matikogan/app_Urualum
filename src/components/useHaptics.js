// src/components/useHaptics.js
export function useHaptics() {
  const beep = () => {
    // WebAudio beep corto (no necesitas archivo de audio)
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; // beep agudo
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.start(); o.stop(ctx.currentTime + 0.13);
  };
  const vibrate = (ms=60) => navigator.vibrate?.(ms);
  return { beep, vibrate };
}
