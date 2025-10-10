import { useEffect, useMemo, useState } from "react";
import { listenPedidosAsignadosOperario } from "../services/pedidosFS";
import { agruparPorEstadoYFecha, ordenarEstados } from "../services/agrupaciones";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { Link } from "react-router-dom";

// Estados visibles para operario
const ESTADOS_VISIBLES = new Set(["ASIGNADO", "EN_PREPARACION"]);

// Helpers UI (solo presentación)
function MetodoChip({ metodo }) {
  if (!metodo) return null;
  return <span className="pill">{metodo}</span>;
}
function fmtFecha(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch { return iso; }
}

export default function PedidosAsignadosOperario() {
  const { user } = useAuth();
  const { toast } = useApp();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);

    const unsub = listenPedidosAsignadosOperario(user.uid, {
      onChange: (snap) => {
        // Traigo todo lo asignado al operario...
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // ...y filtro SOLO los estados visibles
        const filtrados = arr.filter(p => ESTADOS_VISIBLES.has(String(p.estado || "").toUpperCase()));
        setPedidos(filtrados);
        setLoading(false);
      },
      onError: (e) => {
        console.error(e);
        toast.error("Error cargando tus pedidos");
        setLoading(false);
      }
    });

    return () => unsub();
  }, [user?.uid, toast]);

  const grupos = useMemo(() => agruparPorEstadoYFecha(pedidos), [pedidos]);
  const estadosOrdenados = useMemo(() => ordenarEstados(Object.keys(grupos)), [grupos]);

  return (
    <div className="p-3">
      <h1 className="font-bold mb-2">Mis pedidos asignados</h1>
      {loading && <p>Cargando…</p>}
      {!loading && pedidos.length === 0 && (
        <p>No tenés pedidos asignados en preparación.</p>
      )}

      {!loading && estadosOrdenados.map((estado) => {
        const porFecha = grupos[estado];
        return (
          <section key={estado} className="mt-4">
            <h2 className="font-bold">{estado}</h2>
            {Object.entries(porFecha).map(([bucket, items]) => (
              <div key={bucket}>
                <h3 className="text-sm text-gray-500">{bucket}</h3>
                <div className="orders-grid">
                  {items.map((p) => (
                    <Link
                      key={p.id}
                      to={`/pedidos-operario/${p.id}`}
                      className="order-card card--selectable"
                    >
                      <div className="order-head">
                        <div className="order-number">#{p.numero}</div>
                        <MetodoChip metodo={p.metodoEntrega} />
                        <span className="muted" style={{ marginLeft: "auto" }}>
                          {fmtFecha(p.finFecha)}
                        </span>
                      </div>

                      <div className="order-body">
                        <div className="order-field">
                          <span className="order-label">Cliente</span>
                          <span className="order-value">{p.cliente}</span>
                        </div>
                        <div className="order-field">
                          <span className="order-label">Depósito</span>
                          <span className="order-value">{p.deposito || "—"}</span>
                        </div>
                        <div className="order-field">
                          <span className="order-label">Ítems</span>
                          <span className="order-value">
                            {Array.isArray(p.productos) ? p.productos.length : 0}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
