import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import VolverListaPedidos from "../components/VolverListaPedidos";
import { moverPedidoADespachados } from "../services/moverPedidoDespachado";


export default function PedidoDetalleVentas() {
  const { id: encodedId } = useParams();
  const id = decodeURIComponent(encodedId || "");
  console.log("🔍 PedidoDetalleVentas → ID desde URL:", id);    
  const { toast, haptics } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [pedido, setPedido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [despachando, setDespachando] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const ref = doc(db, "pedidos", id);
        console.log("📄 Buscando pedido en FS con ID:", id);

        const snap = await getDoc(ref);

        console.log("📄 Existe documento en Firestore?", snap.exists());
        if (snap.exists()) {
        console.log("📄 Datos del pedido:", snap.data());
        }

        if (!snap.exists()) {
          toast.error("Pedido no encontrado");
          navigate("/ventas/para-despachar");
          return;
        }
        if (!cancel) {
          setPedido({ id, ...snap.data() });
        }
      } catch (e) {
        toast.error("Error cargando pedido");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [id]);

  async function despachar() {
        try {
            setDespachando(true);
            console.log("🟦 Ejecutando despachar() con ID:", id);

            await moverPedidoADespachados({ 
            pedidoId: id, 
            usuario: user 
            });

            console.log("🟩 moverPedidoADespachados terminó OK");

            haptics?.success?.();
            toast.success("Pedido despachado");
            navigate("/ventas/para-despachar");

        } catch (e) {
            console.error(e);
            haptics?.error?.();
            toast.error(e?.message || "No se pudo despachar");
        } finally {
            setDespachando(false);
        }
    }


  if (loading) return <p className="p-3">Cargando…</p>;
  if (!pedido) return null;

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{pedido.numero || id}</h1>
        <VolverListaPedidos to="/ventas/para-despachar" />
      </div>

      {/* Datos generales */}
      <div className="card">
        <div className="order-body">
          <div className="order-field">
            <span className="order-label">Fecha (Finnegans)</span>
            <span className="order-value">{pedido.finFecha || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Cliente</span>
            <span className="order-value">{pedido.cliente || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Método de entrega</span>
            <span className="order-value">{pedido.metodoEntrega || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Depósito</span>
            <span className="order-value">{pedido.deposito || "—"}</span>
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="card">
        <div className="subsection-title">Productos</div>
        <div className="subsection-body space-y-2">
          {pedido.productos?.map((p, idx) => {
            const cant = p.cant ?? p.cantidad ?? p.qty ?? 0;
            const desc = p.desc || p.descripcion || p.nombre || "Producto";
            return (
              <div key={idx} className="flex justify-between border-b py-1">
                <span>{desc}</span>
                <span>x{cant}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Botón despachar */}
      <button
        className="btn bg-black text-white w-full py-3 disabled:opacity-60"
        onClick={despachar}
        disabled={despachando}
      >
        {despachando ? "Despachando…" : "Despachar pedido"}
      </button>
    </div>
  );
}
