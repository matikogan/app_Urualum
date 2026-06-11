/**
 * PedidosSinDeposito
 *
 * Vista exclusiva de ventas/admin.
 * Muestra todos los pedidos activos donde `deposito == null` o `deposito == ""`
 * (la app no pudo clasificar la descripción al sincronizar desde Finnegans).
 *
 * Desde acá ventas puede:
 *   · Asignar depósito (R8 / ISABELA) y método de entrega.
 *   · El pedido desaparece de esta lista en cuanto queda clasificado.
 */

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, where, limit, orderBy } from "firebase/firestore";
import { db } from "../../../firebase";
import { useNavigate } from "react-router-dom";
import AsignarDepositoModal from "../components/AsignarDepositoModal";

// Estados que ya no requieren clasificación (finales o activos con flujo propio)
const ESTADOS_EXCLUIDOS = new Set(["CANCELADO", "ANULADO", "DESPACHADO", "ENTREGADO"]);

function timeAgo(ts) {
  if (!ts?.seconds) return null;
  const m = Math.floor((Date.now() - ts.seconds * 1000) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function getDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  return null;
}

function fmtFecha(d) {
  if (!d) return null;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

// ─────────────────────────────────────────────────────────────
//  Fila de pedido
// ─────────────────────────────────────────────────────────────

function PedidoRow({ p, onClasificar }) {
  const navigate = useNavigate();
  const fecha = getDate(p);
  const items = p.productos?.length ?? p.items?.length ?? 0;
  const ta    = timeAgo(p.updatedAt);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto auto",
      alignItems: "center",
      gap: "12px",
      padding: "13px 16px",
      borderBottom: "1px solid #f1f5f9",
      background: "#fff",
    }}>
      {/* Número */}
      <div style={{ minWidth: "100px" }}>
        <button
          onClick={() => navigate(`/pedidos/${encodeURIComponent(p.id)}`)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontWeight: 800, fontSize: "0.9rem", color: "#0f172a",
            padding: 0, textDecoration: "underline", textDecorationColor: "#cbd5e1",
          }}
        >
          #{p.numero || p.id}
        </button>
        {ta && (
          <p style={{ margin: "2px 0 0", fontSize: "0.63rem", color: "#94a3b8" }}>
            ⏱ {ta}
          </p>
        )}
      </div>

      {/* Cliente + descripción */}
      <div style={{ minWidth: 0 }}>
        <p style={{
          margin: 0, fontWeight: 600, fontSize: "0.88rem", color: "#1e293b",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.cliente || <span style={{ color: "#94a3b8" }}>Sin cliente</span>}
        </p>
        {p.descripcion ? (
          <p style={{
            margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontStyle: "italic",
          }}>
            "{p.descripcion}"
          </p>
        ) : (
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#fbbf24", fontWeight: 600 }}>
            ⚠️ Sin descripción
          </p>
        )}
      </div>

      {/* Info adicional */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {items > 0 && (
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748b" }}>
            {items} ítem{items !== 1 ? "s" : ""}
          </p>
        )}
        {fecha && (
          <p style={{ margin: "2px 0 0", fontSize: "0.67rem", color: "#94a3b8" }}>
            📅 {fmtFecha(fecha)}
          </p>
        )}
      </div>

      {/* Botón clasificar */}
      <button
        onClick={() => onClasificar(p)}
        style={{
          padding: "8px 14px",
          borderRadius: "8px",
          border: "none",
          background: "#0f172a",
          color: "#fff",
          fontSize: "0.8rem",
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Clasificar →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Página principal
// ─────────────────────────────────────────────────────────────

export default function PedidosSinDeposito() {
  const navigate = useNavigate();

  const [pedidos,   setPedidos]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [searchQ,   setSearchQ]   = useState("");
  const [modal,     setModal]     = useState(null); // pedido a clasificar

  // ── Listener: pedidos con deposito == null ──
  // También capturamos deposito == "" por si algún sync dejó string vacío.
  // Usamos dos queries separadas y las combinamos.
  useEffect(() => {
    let nullDocs  = [];
    let emptyDocs = [];

    function merge() {
      const seen  = new Set();
      const all   = [];
      for (const d of [...nullDocs, ...emptyDocs]) {
        if (!seen.has(d.id)) { seen.add(d.id); all.push(d); }
      }
      // Excluir estados que ya no necesitan clasificación
      setPedidos(
        all
          .filter(p => !ESTADOS_EXCLUIDOS.has(p.estado))
          .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0))
      );
      setLoading(false);
    }

    const qNull = query(
      collection(db, "pedidos"),
      where("deposito", "==", null),
      limit(300)
    );
    const qEmpty = query(
      collection(db, "pedidos"),
      where("deposito", "==", ""),
      limit(300)
    );

    const unsubNull  = onSnapshot(qNull,
      snap => { nullDocs  = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
      err  => { console.error("[PedidosSinDeposito] null:", err); setLoading(false); }
    );
    const unsubEmpty = onSnapshot(qEmpty,
      snap => { emptyDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
      err  => console.error("[PedidosSinDeposito] empty:", err)
    );

    return () => { unsubNull(); unsubEmpty(); };
  }, []);

  // ── Búsqueda cliente/número ──
  const filtrados = useMemo(() => {
    const nq = searchQ.trim().toLowerCase();
    if (!nq) return pedidos;
    return pedidos.filter(p => {
      const num = String(p.numero || p.id || "").toLowerCase();
      const cli = String(p.cliente || "").toLowerCase();
      const desc = String(p.descripcion || "").toLowerCase();
      return num.includes(nq) || cli.includes(nq) || desc.includes(nq);
    });
  }, [pedidos, searchQ]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "0 20px",
        height: "58px",
        display: "flex", alignItems: "center", gap: "14px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate("/pedidos")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "1.2rem", color: "#64748b", padding: "4px",
          }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>
          Sin clasificar
        </h1>

        {/* Badge con conteo */}
        {!loading && (
          <span style={{
            background: pedidos.length > 0 ? "#ef4444" : "#e2e8f0",
            color: pedidos.length > 0 ? "#fff" : "#94a3b8",
            fontSize: "0.72rem", fontWeight: 800,
            padding: "3px 10px", borderRadius: "999px",
            flexShrink: 0,
          }}>
            {pedidos.length} sin depósito
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Buscador */}
        <input
          placeholder="🔍 Buscar cliente, #pedido o descripción…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: "8px",
            border: "1.5px solid #e2e8f0",
            fontSize: "0.83rem",
            width: "260px",
            background: "#f8fafc",
          }}
        />
      </div>

      {/* Contenido */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px 16px" }}>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            Cargando pedidos…
          </div>
        ) : filtrados.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            background: "#fff", borderRadius: "16px",
            border: "1.5px solid #e2e8f0",
          }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>✅</div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
              {searchQ ? "Sin resultados" : "¡Todo clasificado!"}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              {searchQ
                ? "Ningún pedido coincide con la búsqueda."
                : "No hay pedidos pendientes de clasificación."
              }
            </p>
          </div>
        ) : (
          <>
            {/* Info banner */}
            <div style={{
              background: "#fffbeb", border: "1px solid #fde68a",
              borderRadius: "10px", padding: "10px 14px",
              marginBottom: "14px",
              fontSize: "0.78rem", color: "#92400e",
              display: "flex", alignItems: "center", gap: "8px",
            }}>
              <span>⚠️</span>
              <span>
                Estos pedidos no tienen depósito asignado. La app no pudo clasificar la descripción automáticamente.
                Asigná manualmente el destino y método de entrega.
              </span>
            </div>

            {/* Lista */}
            <div style={{
              background: "#fff",
              borderRadius: "12px",
              border: "1.5px solid #e2e8f0",
              overflow: "hidden",
            }}>
              {/* Encabezado tabla */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                gap: "12px",
                padding: "9px 16px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
              }}>
                {["#Pedido", "Cliente / Descripción", "Detalle", ""].map((h, i) => (
                  <span key={i} style={{
                    fontSize: "0.66rem", fontWeight: 700,
                    color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    {h}
                  </span>
                ))}
              </div>

              {filtrados.map(p => (
                <PedidoRow
                  key={p.id}
                  p={p}
                  onClasificar={setModal}
                />
              ))}
            </div>

            <p style={{
              textAlign: "center",
              marginTop: "14px",
              fontSize: "0.72rem",
              color: "#94a3b8",
            }}>
              {filtrados.length} pedido{filtrados.length !== 1 ? "s" : ""} sin clasificar
            </p>
          </>
        )}
      </div>

      {/* Modal de clasificación */}
      {modal && (
        <AsignarDepositoModal
          pedido={modal}
          titulo="Clasificar pedido"
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)} // desaparece solo del listener
        />
      )}
    </div>
  );
}
