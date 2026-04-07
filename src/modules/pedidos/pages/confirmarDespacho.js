import { useState } from "react";
import { getDoc, setDoc, deleteDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { db } from "../../../firebase";
import { useNavigate } from "react-router-dom";


export default function ConfirmarDespacho({ pedidoId, onDone }) {
  const { toast, haptics } = useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();


  async function onDespachar() {
    try {
      setLoading(true);

      const ref = doc(db, "pedidos", String(pedidoId));
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        toast.error("El pedido no existe");
        return;
      }

      const data = snap.data();

      // 1) Guardar en colección de históricos
      await setDoc(doc(db, "pedidos_despachados", String(pedidoId)), {
        ...data,
        estado: "DESPACHADO",
        despachadoAt: serverTimestamp(),
        despachadoPor: user?.uid || null,
        movedAt: serverTimestamp(),
        source: "app-despacho",
      });

      // 2) Borrar de la colección activa
      await deleteDoc(ref);

      haptics?.success?.();
      toast.success("Pedido marcado como DESPACHADO");

      // 3) Volver a la lista
      navigate("/pedidos");
    } catch (e) {
      console.error(e);
      haptics?.error?.();
      toast.error(e?.message || "No se pudo despachar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="w-full py-3 rounded bg-black text-white disabled:opacity-60"
      onClick={onDespachar}
      disabled={loading}
      aria-busy={loading}
    >
      {loading ? "Despachando…" : "Despachar"}
    </button>
  );
}
