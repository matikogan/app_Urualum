import { cambiarEstado, ESTADOS } from "../services/estados";
import { useApp } from "../../../context/AppContext";

export default function ConfirmarDespacho({ pedidoId }) {
  const { toast, haptics } = useApp();
  async function onDespachar() {
    try {
      await cambiarEstado(pedidoId, ESTADOS.DESPACHADO);
      haptics?.success?.();
      toast.success("Pedido despachado correctamente");
    } catch (e) { toast.error(e.message); }
  }
  return <button className="w-full py-3 rounded bg-black text-white" onClick={onDespachar}>Despachar</button>;
}
