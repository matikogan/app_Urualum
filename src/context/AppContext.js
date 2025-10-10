import { createContext, useContext, useState, useMemo } from "react";
// Si tenés un componente Toast por default, lo ignoramos aquí.
// Proveemos un wrapper simple compatible con toast.success/error/info.
const toast = {
  success: (m) => (window?.toast?.success ? window.toast.success(m) : alert(m)),
  error:   (m) => (window?.toast?.error   ? window.toast.error(m)   : alert(`Error: ${m}`)),
  info:    (m) => (window?.toast?.info    ? window.toast.info(m)    : alert(m)),
};

// Haptics opcional (si no existe, devolvemos stubs)
function useHapticsStub() {
  return {
    success: () => {},
    error: () => {},
    impact: () => {},
  };
}

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [depositoActual, setDepositoActual] = useState("R8");
  const [metodoFiltro, setMetodoFiltro] = useState(null);
  const haptics = useHapticsStub();

  const value = useMemo(() => ({
    depositoActual, setDepositoActual,
    metodoFiltro, setMetodoFiltro,
    haptics, toast
  }), [depositoActual, metodoFiltro]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Hook recomendado
export const useApp = () => useContext(Ctx);

// ⚠️ Export named para compatibilidad con imports viejos
export const AppContext = Ctx;
