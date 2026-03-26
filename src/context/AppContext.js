import { createContext, useContext, useState, useMemo } from "react";

// Si tenés un componente Toast por default, lo ignoramos aquí.
// Proveemos un wrapper simple compatible con toast.success/error/info.
const toast = {
  success: (m) => (window?.toast?.success ? window.toast.success(m) : console.log(m)),
  error:   (m) => (window?.toast?.error   ? window.toast.error(m)   : console.warn(`Error: ${m}`)),
  info:    (m) => (window?.toast?.info    ? window.toast.info(m)    : console.log(m)),
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
  // ==========================================
  // ESTADOS APP INTERNA DE STOCK (NO TOCAR)
  // ==========================================
  const [depositoActual, setDepositoActual] = useState("R8");
  const [metodoFiltro, setMetodoFiltro] = useState(null);
  const haptics = useHapticsStub();

  // ==========================================
  // ESTADOS APP DE VENTAS / CLIENTES (NUEVO)
  // ==========================================
  const [usuarioApp, setUsuarioApp] = useState(null);
  const [reglasPrecios, setReglasPrecios] = useState(null);
  const [nombreLista, setNombreLista] = useState("");
  const [clienteActivo, setClienteActivo] = useState(null);

  // Lógica del Carrito
  const [carrito, setCarrito] = useState([]);

  const agregarAlCarrito = (item) => setCarrito((prev) => [...prev, item]);
  
  const eliminarDelCarrito = (index) => setCarrito((prev) => prev.filter((_, i) => i !== index));
  
  const limpiarCarrito = () => setCarrito([]);

  const actualizarCantidadItem = (index, nuevaCantidad) => {
    if (nuevaCantidad < 1) return;
    setCarrito((prev) => {
      const nuevoCarrito = [...prev];
      // Clonamos el item específico para que React detecte el cambio correctamente
      nuevoCarrito[index] = { ...nuevoCarrito[index] }; 
      nuevoCarrito[index].cantidad = nuevaCantidad;
      nuevoCarrito[index].precioTotal = nuevoCarrito[index].precioUnitario * nuevaCantidad;
      return nuevoCarrito;
    });
  };

  // Matemática del Carrito
  const subtotalCarrito = carrito.reduce((acc, item) => acc + item.precioTotal, 0);
  const ivaCarrito = subtotalCarrito * 0.22;
  const totalConIva = subtotalCarrito + ivaCarrito;

  // ==========================================
  // EXPORTACIÓN DE VARIABLES (CONSOLIDADO)
  // ==========================================
  const value = useMemo(() => ({
    // Variables de la App Interna
    depositoActual, setDepositoActual,
    metodoFiltro, setMetodoFiltro,
    haptics, toast,
    
    // Variables de la App Ventas
    usuarioApp, setUsuarioApp,
    reglasPrecios, setReglasPrecios,
    nombreLista, setNombreLista,
    clienteActivo, setClienteActivo,
    carrito, agregarAlCarrito, eliminarDelCarrito, limpiarCarrito,
    actualizarCantidadItem, // <-- Acá está la función exportada para que Carrito.js la pueda usar
    subtotalCarrito, ivaCarrito, totalConIva
  }), [
    // Array de dependencias del useMemo
    depositoActual, metodoFiltro,
    usuarioApp, reglasPrecios, nombreLista, carrito, 
    subtotalCarrito, ivaCarrito, totalConIva
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Hook recomendado
export const useApp = () => useContext(Ctx);

// ⚠️ Export named para compatibilidad con imports viejos
export const AppContext = Ctx;