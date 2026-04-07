import { useEffect, useMemo, useRef, useState } from "react";
import { listenPedidosAsignadosOperario } from "../services/pedidosFS";
import { agruparPorEstadoYFecha, ordenarEstados } from "../services/agrupaciones";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { Link } from "react-router-dom";
import Badge from "./Badge";
import useNotificationSound from "hooks/useNotificationSound";

// Estados visibles para operario
const ESTADOS_VISIBLES = new Set(["ASIGNADO", "EN_PREPARACION"]);

// Helper: tiempo transcurrido en el estado actual
function formatTimeAgo(ts) {
  if (!ts) return null;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}

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

  const [badges, setBadges] = useState({}); // { [ESTADO]: número }
  const prevAllIdsRef = useRef(new Set());   // IDs vistos en el snapshot anterior (de ESTA vista)
  const firstSnapRef = useRef(true);         // NO contar la primera foto
  const lastChangeWasNewRef = useRef(false); // para evitar dobles incrementos si tenés otro efecto

  // (opcional) sonido
  const { soundOn, playNotif } = useNotificationSound("/sfx/new-order.mp3")

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

         // === NUEVOS PARA LA VISTA (IDs que antes no estaban en esta página) ===
        const currentIds = new Set(filtrados.map(p => p.id));
        const newOnes = [];

        if (!firstSnapRef.current) {
          for (const p of filtrados) {
            if (!prevAllIdsRef.current.has(p.id)) newOnes.push(p);
          }
        } else {
          firstSnapRef.current = false; // la primera foto no cuenta como nuevas
        }

        // actualizar ref para próxima comparación
        prevAllIdsRef.current = currentIds;

        if (newOnes.length > 0) {
          lastChangeWasNewRef.current = true;
          setBadges(prev => {
            const next = { ...prev };
            for (const p of newOnes) {
              const est = String(p.estado || "").toUpperCase();
              next[est] = (next[est] || 0) + 1;
            }
            return next;
          });
          // (opcional) sonido cuando llegan primeros asignados visibles para el operario
          if (soundOn) playNotif();
        } else {
          lastChangeWasNewRef.current = false;
        }

      },
      onError: (e) => {
        console.error(e);
        toast.error(e?.code === "permission-denied"
          ? "Sin permisos para ver estos pedidos."
          : "No se pudieron cargar tus pedidos. Verifica tu conexión.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, [user?.uid, toast]);

  function clearEstadoBadge(estado) {
    setBadges(b => ({...b, [estado]: 0 }))
  }

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
            <h2
              className="font-bold estado-title"
              style={{ position: "relative", display: "inline-block", cursor: "pointer" }}
              onClick={() => setBadges(b => ({ ...b, [estado]: 0 }))}
            >
              <Badge count={badges?.[estado] || 0} />
              {estado}
            </h2>
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
                        {formatTimeAgo(p.timestamps?.[p.estado]) && (
                          <span className="pill pill--muted" title={`En estado ${p.estado} desde hace este tiempo`}>
                            ⏱ {formatTimeAgo(p.timestamps?.[p.estado])}
                          </span>
                        )}
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
