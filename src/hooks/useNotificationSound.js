import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Reproduce un sonido de notificación de forma segura (mobile-friendly).
 * - Requiere al menos una interacción del usuario para habilitar audio en iOS.
 * - Respeta un mute global (persistente en localStorage).
 */
export default function useNotificationSound(src, { volume = 0.5 } = {}) {
  const audioRef = useRef(null);
  const [enabled, setEnabledState] = useState(() => {
    const saved = localStorage.getItem("notifSoundEnabled");
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = volume;
    audioRef.current = a;
    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, [src, volume]);

  useEffect(() => {
    localStorage.setItem("notifSoundEnabled", String(enabled));
  }, [enabled]);

  // iOS/Chrome móviles: desbloquear audio con primer tap
  const unlock = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = true;
    audioRef.current.play().catch(() => {});
    audioRef.current.pause();
    audioRef.current.muted = false;
  }, []);

  // Llamar cuando haya nuevas notificaciones
  const play = useCallback(() => {
    if (!enabled || !audioRef.current) return;
    // Evitá reproducir si la pestaña NO está visible (opcional)
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    try {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Si falla, probablemente falta un tap; podrías mostrar un banner para “activar sonido”
      });
    } catch (_) {}
  }, [enabled]);

  const setEnabled = useCallback((v) => setEnabledState(Boolean(v)), []);

  return { play, enabled, setEnabled, unlock };
}
