import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { norm } from "utils/text";
import SearchBar from "../components/SearchBar";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { bucketFecha, BUCKET_ORDER } from "../services/agrupaciones";

/* ── helpers fecha ── */
function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  if (p?.timestamps?.creado?.seconds) return new Date(p.timestamps.creado.seconds * 1000);
  return null;
}

function formatTimeAgo(ts) {
  if (!ts) return null;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(date)) return null;
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const METODO_COLORS = {
  AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
  RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
  CAMION:  { bg: "#fef3c7", color: "#92400e" },
  GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
};

// Umbral en ms para marcar pedido como "atascado" en ventas (2 días)
const STUCK_MS = 2 * 24 * 3600 * 1000;
function isStuck(p) {
  if (!p.updatedAt?.seconds) return false;
  return Date.now() - p.updatedAt.seconds * 1000 > STUCK_MS;
}

/* ── Columna reutilizable ── */
function Column({ title, icon, color, bg, border, count, children, emptyMsg }) {
  return (
    <div style={{
      background: "#fff",
      border: `1.5px solid ${border}`,
      borderRadius: "16px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      minHeight: "120px",
    }}>
      {/* Header de columna */}
      <div style={{
        background: bg,
        borderBottom: `1.5px solid ${border}`,
        padding: "14px 16px 12px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "1.1rem" }}>{icon}</span>
        <span style={{ flex: 1, fontWeight: 800, fontSize: "0.82rem", color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </span>
        <span style={{
          background: color + "22", color,
          fontSize: "0.75rem", fontWeight: 700,
          padding: "2px 10px", borderRadius: "999px",
          border: `1px solid ${border}`,
        }}>
          {count}
        </span>
      </div>

      {/* Cuerpo */}
      <div style={{ padding: "10px", flex: 1, overflowY: "auto" }}>
        {count === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 12px", color: "#94a3b8" }}>
            <div style={{ fontSize: "1.6rem", marginBottom: "6px", opacity: 0.5 }}>—</div>
            <p style={{ margin: 0, fontSize: "0.78rem" }}>{emptyMsg || "Sin pedidos"}</p>
          </div>
        ) : children}
      </div>
    </div>
  );
}

/* ── componente ── */
export default function PedidosControladosVentas() {
  const { toast } = useApp();
  const { profile } = useAuth();
  const navigate  = useNavigate();
  const deposito = profile?.deposito || null;

  const [controlados, setControlados] = useState([]);
  const [conProblema, setConProblema]  = useState([]);
  const [conError, setConError]        = useState([]);
  const [despsHoy, setDespsHoy]       = useState([]);
  const [entregados, setEntregados]    = useState([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState("");
  const [debouncedQ, setDebouncedQ]   = useState("");

  // Modal "Avisar cliente"
  const [avisando, setAvisando]       = useState(null);
  const [notaAviso, setNotaAviso]     = useState("");
  const [savingAviso, setSavingAviso] = useState(false);

  /* ── listeners ── */
  useEffect(() => {
    let qCtrl = query(collection(db, "pedidos"), where("estado", "==", "CONTROLADO"));
    if (deposito) qCtrl = query(qCtrl, where("deposito", "==", deposito));
    const unsubCtrl = onSnapshot(
      qCtrl,
      (snap) => { setControlados(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error(err); setLoading(false); }
    );

    let qProb = query(collection(db, "pedidos"), where("problema.estado", "==", "ELEVADO"));
    if (deposito) qProb = query(qProb, where("deposito", "==", deposito));
    const unsubProb = onSnapshot(
      qProb,
      (snap) => setConProblema(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[Ventas] problemas:", err)
    );

    let qErr = query(collection(db, "pedidos"), where("estado", "==", "CON_ERROR"));
    if (deposito) qErr = query(qErr, where("deposito", "==", deposito));
    const unsubErr = onSnapshot(
      qErr,
      (snap) => setConError(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[Ventas] conError:", err)
    );

    // Traemos los últimos 30 días de pedidos_despachados para capturar
    // tanto los despachados hoy (pendientes de control) como los entregados
    // en días anteriores.
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30); hace30.setHours(0,0,0,0);
    const today  = new Date(); today.setHours(0,0,0,0);
    const unsubDesp = onSnapshot(
      query(collection(db, "pedidos_despachados"),
        where("despachadoAt", ">=", hace30)),
      (snap) => {
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data(), estado: "DESPACHADO" }))
          .filter(d => !deposito || d.deposito === deposito);
        // Entregados: cualquier pedido confirmado como entregado (necesitaControl === false)
        setEntregados(all.filter(d => d.necesitaControl === false));
        // Pendientes de entrega: solo los despachados HOY que aún no fueron confirmados
        setDespsHoy(all.filter(d => {
          if (d.necesitaControl === false) return false; // ya entregado, no duplicar
          const ts = d.despachadoAt?.seconds
            ? new Date(d.despachadoAt.seconds * 1000)
            : d.despachadoAt ? new Date(d.despachadoAt) : null;
          return ts && ts >= today;
        }));
      },
      (err) => console.error("[Ventas] despachados:", err)
    );

    return () => { unsubCtrl(); unsubProb(); unsubErr(); unsubDesp(); };
  }, [deposito]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(id);
  }, [q]);

  /* ── filtrado ── */
  function filtrar(lista) {
    if (!debouncedQ) return lista;
    const nq = norm(debouncedQ);
    return lista.filter(p =>
      norm(p.numero || p.id || "").includes(nq) ||
      norm(p.cliente || "").includes(nq) ||
      norm(p.metodoEntrega || "").includes(nq)
    );
  }

  const controladosFiltrados  = useMemo(() => filtrar(controlados), [controlados, debouncedQ]);
  const conProblemaFiltrados  = useMemo(() => filtrar(conProblema), [conProblema, debouncedQ]);
  const conErrorFiltrados     = useMemo(() => filtrar(conError),    [conError, debouncedQ]);
  const entregadosFiltrados   = useMemo(() => filtrar(entregados),  [entregados, debouncedQ]);
  const despsHoyFiltrados     = useMemo(() => filtrar(despsHoy),    [despsHoy, debouncedQ]);

  const totalAlertas = conProblemaFiltrados.length + conErrorFiltrados.length;
  const totalAccion  = controladosFiltrados.length + totalAlertas;

  /* ── avisar al cliente ── */
  async function confirmarAviso() {
    if (!avisando) return;
    const wid = avisando.webPedidoId || avisando.pedidoWebId || null;
    try {
      setSavingAviso(true);
      await updateDoc(doc(db, "pedidos", avisando.id), {
        "problema.avisadoClienteAt": serverTimestamp(),
        "problema.notaAviso": notaAviso.trim() || null,
      });
      if (wid) {
        await updateDoc(doc(db, "pedidos_web", wid), {
          estado: "ERROR_STOCK",
          notaError: notaAviso.trim() || `Hay un problema con tu pedido. Serás contactado por WhatsApp.`,
          errorAt: serverTimestamp(),
        });
      }
      toast.success(wid ? "Cliente avisado ✓" : "Registrado ✓");
      setAvisando(null); setNotaAviso("");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo avisar al cliente");
    } finally {
      setSavingAviso(false);
    }
  }

  /* ── Lista agrupada por fecha (HOY / AYER / ÚLTIMA SEMANA / ÚLTIMO MES) ── */
  function BucketedList({ items, getTs, renderItem, accentColor, dividerColor }) {
    const grouped = {};
    for (const p of items) {
      const ts = getTs(p);
      const bucket = bucketFecha(ts);
      grouped[bucket] = grouped[bucket] || [];
      grouped[bucket].push(p);
    }
    return BUCKET_ORDER
      .filter(b => (grouped[b] || []).length > 0)
      .map(b => (
        <div key={b}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 0 4px" }}>
            <span style={{ fontSize: "0.64rem", fontWeight: 700, color: accentColor, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {b}
            </span>
            <div style={{ flex: 1, height: "1px", background: dividerColor }} />
            <span style={{ fontSize: "0.62rem", fontWeight: 700, color: accentColor }}>
              {grouped[b].length}
            </span>
          </div>
          {grouped[b].map(renderItem)}
        </div>
      ));
  }

  /* ── Card: pedido listo para despachar ── */
  function CardControlado({ p }) {
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const timeAgo = formatTimeAgo(p.timestamps?.CONTROLADO);
    const itemCount = p.productos?.length ?? 0;
    const stuck = isStuck(p);

    return (
      <div
        onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
        style={{
          background: "#fff",
          borderRadius: "12px",
          border: stuck ? "2px solid #f97316" : "1.5px solid #e2e8f0",
          borderLeft: stuck ? "4px solid #f97316" : "4px solid #0891b2",
          padding: "12px 14px",
          marginBottom: "8px",
          cursor: "pointer",
          transition: "box-shadow 0.12s ease",
          boxShadow: stuck ? "0 2px 8px rgba(249,115,22,0.15)" : "0 1px 3px rgba(0,0,0,0.04)",
          position: "relative",
        }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.10)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = stuck ? "0 2px 8px rgba(249,115,22,0.15)" : "0 1px 3px rgba(0,0,0,0.04)"}
      >
        {stuck && (
          <div style={{
            position: "absolute", top: -8, right: 8,
            background: "#f97316", color: "#fff",
            fontSize: "0.58rem", fontWeight: 800,
            padding: "2px 7px", borderRadius: "999px",
            letterSpacing: "0.04em",
          }}>
            +2d
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f172a" }}>
            #{p.numero || p.id}
          </span>
          {p.metodoEntrega && (
            <span style={{
              fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px",
              borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color, flexShrink: 0,
            }}>
              {p.metodoEntrega}
            </span>
          )}
          {timeAgo && (
            <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: stuck ? "#f97316" : "#94a3b8", flexShrink: 0, fontWeight: stuck ? 700 : 400 }}>⏱ {timeAgo}</span>
          )}
        </div>

        <p style={{
          margin: "0 0 6px", fontSize: "0.95rem", fontWeight: 700, color: "#0f172a",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.cliente || "—"}
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
            {itemCount} ítem{itemCount !== 1 ? "s" : ""}
            {p.bultos > 0 ? ` · 📦 ${p.bultos} bultos` : ""}
          </span>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#0891b2" }}>
            Despachar →
          </span>
        </div>
      </div>
    );
  }

  /* ── Card: pedido CON_ERROR ── */
  function CardError({ p }) {
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const timeAgo = formatTimeAgo(p.timestamps?.CON_ERROR);

    return (
      <div
        onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
        style={{
          background: "#fff7ed",
          borderRadius: "12px",
          border: "1.5px solid #fed7aa",
          borderLeft: "4px solid #ea580c",
          padding: "12px 14px",
          marginBottom: "8px",
          cursor: "pointer",
          transition: "box-shadow 0.12s ease",
          boxShadow: "0 1px 3px rgba(234,88,12,0.06)",
        }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(234,88,12,0.14)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(234,88,12,0.06)"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f172a" }}>#{p.numero || p.id}</span>
          {p.metodoEntrega && (
            <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color, flexShrink: 0 }}>
              {p.metodoEntrega}
            </span>
          )}
          {timeAgo && <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#94a3b8", flexShrink: 0 }}>⏱ {timeAgo}</span>}
        </div>

        <p style={{ margin: "0 0 8px", fontSize: "0.95rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.cliente || "—"}
        </p>

        {/* Producto con error */}
        <div style={{
          background: "#ffedd5",
          border: "1px solid #fdba74",
          borderRadius: "8px",
          padding: "8px 10px",
          marginBottom: "6px",
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
        }}>
          <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: "1px" }}>⚠️</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 700, color: "#c2410c", textTransform: "uppercase" }}>
              Producto con error
            </p>
            <p style={{
              margin: 0, fontSize: "0.85rem", fontWeight: 700, color: "#7c2d12",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {p.errorProductoNombre || "Producto no especificado"}
              {p.errorProductoCod && (
                <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "#9a3412", marginLeft: "5px" }}>
                  (cod. {p.errorProductoCod})
                </span>
              )}
            </p>
            {p.errorDetalle && (
              <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#9a3412", fontStyle: "italic" }}>
                "{p.errorDetalle}"
              </p>
            )}
          </div>
        </div>

        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#ea580c" }}>Ver detalle →</span>
      </div>
    );
  }

  /* ── Card: pedido con problema elevado (legacy) ── */
  function CardProblema({ p }) {
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const yaAvisado = !!p.problema?.avisadoClienteAt;

    return (
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          border: "1.5px solid #fca5a5",
          borderLeft: "4px solid #ef4444",
          padding: "12px 14px",
          marginBottom: "8px",
          cursor: "pointer",
          transition: "box-shadow 0.12s ease",
        }}
        onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(239,68,68,0.14)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f172a" }}>#{p.numero || p.id}</span>
          {p.metodoEntrega && (
            <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color, flexShrink: 0 }}>
              {p.metodoEntrega}
            </span>
          )}
        </div>
        <p style={{ margin: "0 0 8px", fontSize: "0.95rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.cliente || "—"}
        </p>
        {p.problema && (
          <div style={{ background: "#fef2f2", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px" }}>
            <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 700, color: "#dc2626" }}>
              {p.problema.tipo === "FALTA_STOCK" ? "📦 Falta de stock" : "⚠️ Otro problema"} — {p.problema.productoNombre || "producto sin especificar"}
            </p>
            {p.problema.descripcion && (
              <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#7f1d1d", fontStyle: "italic" }}>
                "{p.problema.descripcion}"
              </p>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px" }} onClick={e => e.stopPropagation()}>
          <span
            onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
            style={{
              flex: 1, padding: "7px", background: "#f8fafc",
              border: "1.5px solid #e2e8f0", borderRadius: "8px",
              fontWeight: 600, fontSize: "0.8rem", color: "#475569",
              textAlign: "center", cursor: "pointer",
            }}
          >
            Ver detalle
          </span>
          {yaAvisado ? (
            <div style={{
              flex: 1, padding: "7px", background: "#f0fdf4",
              border: "1.5px solid #86efac", borderRadius: "8px",
              fontWeight: 600, fontSize: "0.8rem", color: "#16a34a", textAlign: "center",
            }}>
              ✓ Avisado
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setAvisando(p); setNotaAviso(""); }}
              style={{
                flex: 1, padding: "7px", background: "#fef2f2",
                border: "1.5px solid #fca5a5", borderRadius: "8px",
                fontWeight: 700, fontSize: "0.8rem", color: "#dc2626", cursor: "pointer",
              }}
            >
              📲 Avisar
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Card: despachado (pendiente de confirmación) ── */
  function CardDespachado({ p }) {
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const timeAgo = formatTimeAgo(p.despachadoAt);
    return (
      <div style={{
        background: "#fff",
        borderRadius: "10px",
        border: "1px solid #e2e8f0",
        borderLeft: "3px solid #64748b",
        padding: "10px 12px",
        marginBottom: "6px",
        opacity: 0.9,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "2px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#475569" }}>
            #{p.numero || p.id}
          </span>
          {p.metodoEntrega && (
            <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 6px", borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color }}>
              {p.metodoEntrega}
            </span>
          )}
          {timeAgo && (
            <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: "#94a3b8" }}>⏱ {timeAgo}</span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.cliente || "—"}
        </p>
      </div>
    );
  }

  /* ── Card: entregado (confirmado por encargado) ── */
  function CardEntregado({ p }) {
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const timeEntrega = formatTimeAgo(p.controlFisicoAt || p.despachadoAt);

    // Fecha legible del despacho
    const fechaDespacho = (() => {
      const ts = p.despachadoAt?.seconds
        ? new Date(p.despachadoAt.seconds * 1000)
        : p.despachadoAt ? new Date(p.despachadoAt) : null;
      if (!ts) return null;
      return ts.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
    })();

    return (
      <div style={{
        background: "#f0fdf4",
        borderRadius: "10px",
        border: "1px solid #bbf7d0",
        borderLeft: "3px solid #16a34a",
        padding: "10px 12px",
        marginBottom: "6px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "2px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#15803d" }}>
            #{p.numero || p.id}
          </span>
          {p.metodoEntrega && (
            <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 6px", borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color }}>
              {p.metodoEntrega}
            </span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#16a34a" }}>✓ Entregado</span>
            {timeEntrega && (
              <span style={{ fontSize: "0.65rem", color: "#86efac" }}>· {timeEntrega}</span>
            )}
          </span>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: "0.88rem", fontWeight: 600, color: "#15803d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.cliente || "—"}
        </p>
        {fechaDespacho && (
          <p style={{ margin: 0, fontSize: "0.7rem", color: "#4ade80" }}>
            Despachado el {fechaDespacho}
            {p.controladoPor && <span> · Confirmado por encargado</span>}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px 12px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", alignItems: "center", gap: "12px" }}>
          <a
            href="/ventas/pipeline"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", flexShrink: 0,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
            }}
          >
            ←
          </a>
          <h1 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", flex: 1 }}>
            Para despachar
          </h1>
          {!loading && totalAccion > 0 && (
            <span style={{ background: "#dc2626", color: "#fff", fontSize: "0.72rem", fontWeight: 700, padding: "4px 12px", borderRadius: "999px" }}>
              {totalAccion} pendiente{totalAccion !== 1 ? "s" : ""}
            </span>
          )}
          <div style={{ width: "260px", flexShrink: 0 }}>
            <SearchBar value={q} onChange={setQ} onClear={() => setQ("")} placeholder="Buscar cliente, #pedido…" />
          </div>
          <a
            href="/ventas/pipeline"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "34px", flexShrink: 0,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "0.75rem",
              fontWeight: 700, color: "#475569", padding: "0 12px", gap: "5px",
            }}
            title="Ver pipeline completo"
          >
            🗂 Pipeline
          </a>
          <a
            href="/ventas/despachados"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", flexShrink: 0,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
            }}
            title="Histórico de despachos"
          >
            📋
          </a>
        </div>
      </div>

      {/* ── Contenido ── */}
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px 24px 40px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
            Cargando pedidos…
          </div>
        )}

        {/* ── Banner: pedidos atascados (>2 días sin cambio) ── */}
        {!loading && (() => {
          const atascados = controladosFiltrados.filter(isStuck);
          if (atascados.length === 0) return null;
          return (
            <div style={{
              background: "#fff7ed",
              border: "1.5px solid #fed7aa",
              borderRadius: "12px",
              padding: "12px 16px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 2px", fontSize: "0.82rem", fontWeight: 700, color: "#c2410c" }}>
                  {atascados.length} pedido{atascados.length !== 1 ? "s" : ""} sin movimiento por más de 2 días
                </p>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#ea580c" }}>
                  {atascados.map(p => `#${p.numero || p.id}`).join(" · ")}
                </p>
              </div>
            </div>
          );
        })()}

        {!loading && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr 1fr",
            gap: "16px",
            alignItems: "start",
          }}>

            {/* ── Columna 1: Alertas (errores + problemas) ── */}
            <Column
              title="Requieren atención"
              icon="⚠️"
              color="#ea580c"
              bg="#fff7ed"
              border="#fed7aa"
              count={conErrorFiltrados.length + conProblemaFiltrados.length}
              emptyMsg="Sin errores ni problemas"
            >
              {conErrorFiltrados.length > 0 && (
                <>
                  {conProblemaFiltrados.length > 0 && (
                    <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#ea580c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Error de preparación
                    </p>
                  )}
                  <BucketedList
                    items={conErrorFiltrados}
                    getTs={p => p.timestamps?.CON_ERROR || p.updatedAt}
                    renderItem={p => <CardError key={p.id} p={p} />}
                    accentColor="#ea580c"
                    dividerColor="#fed7aa"
                  />
                </>
              )}
              {conProblemaFiltrados.length > 0 && (
                <>
                  {conErrorFiltrados.length > 0 && (
                    <div style={{ borderTop: "1px dashed #fed7aa", margin: "8px 0 10px" }} />
                  )}
                  <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Problemas elevados
                  </p>
                  <BucketedList
                    items={conProblemaFiltrados}
                    getTs={p => p.updatedAt}
                    renderItem={p => <CardProblema key={p.id} p={p} />}
                    accentColor="#dc2626"
                    dividerColor="#fca5a5"
                  />
                </>
              )}
            </Column>

            {/* ── Columna 2: Listos para despachar ── */}
            <Column
              title="Listos para despachar"
              icon="📦"
              color="#0891b2"
              bg="#ecfeff"
              border="#a5f3fc"
              count={controladosFiltrados.length}
              emptyMsg="No hay pedidos listos aún"
            >
              <BucketedList
                items={controladosFiltrados}
                getTs={p => p.timestamps?.CONTROLADO || p.updatedAt}
                renderItem={p => <CardControlado key={p.id} p={p} />}
                accentColor="#0891b2"
                dividerColor="#a5f3fc"
              />
            </Column>

            {/* ── Columna 3: Entregados + Despachados ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

              {/* Sub-columna: Entregados */}
              <Column
                title="Entregados"
                icon="✅"
                color="#16a34a"
                bg="#f0fdf4"
                border="#bbf7d0"
                count={entregadosFiltrados.length}
                emptyMsg="Sin entregas confirmadas"
              >
                {entregadosFiltrados.map(p => (
                  <CardEntregado key={p.id} p={p} />
                ))}
              </Column>

              {/* Sub-columna: Despachados sin confirmar */}
              <Column
                title="En camino"
                icon="🚚"
                color="#475569"
                bg="#f8fafc"
                border="#e2e8f0"
                count={despsHoyFiltrados.length}
                emptyMsg="Sin despachos pendientes"
              >
                {despsHoyFiltrados.map(p => (
                  <CardDespachado key={p.id} p={p} />
                ))}
              </Column>

            </div>

          </div>
        )}
      </div>

      {/* ── Modal: Avisar cliente ── */}
      {avisando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "28px 24px 24px", width: "100%", maxWidth: "480px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <h2 style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem", color: "#0f172a" }}>
                📲 Avisar al cliente
              </h2>
              <button
                type="button"
                onClick={() => { setAvisando(null); setNotaAviso(""); }}
                style={{ background: "none", border: "none", fontSize: "1.2rem", color: "#94a3b8", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "12px 14px", marginBottom: "16px" }}>
              <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>
                #{avisando.numero} — {avisando.cliente}
              </p>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#dc2626", fontWeight: 600 }}>
                {avisando.problema?.tipo === "FALTA_STOCK" ? "📦 Falta de stock" : "⚠️ Problema"} en {avisando.problema?.productoNombre || "un producto"}
              </p>
            </div>

            {avisando.webPedidoId ? (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", display: "flex", gap: "8px" }}>
                <span>✅</span>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#15803d", fontWeight: 600 }}>
                  Pedido vinculado a la app del cliente
                </p>
              </div>
            ) : (
              <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", display: "flex", gap: "8px" }}>
                <span>⚠️</span>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#92400e" }}>
                  Sin app cliente vinculada — se registrará solo internamente
                </p>
              </div>
            )}

            <p style={{ margin: "0 0 8px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Mensaje al cliente (opcional)
            </p>
            <textarea
              value={notaAviso}
              onChange={e => setNotaAviso(e.target.value)}
              placeholder="Ej: Hay un problema con tu pedido. Serás contactado por WhatsApp."
              rows={3}
              style={{
                width: "100%", padding: "12px",
                border: "1.5px solid #e2e8f0", borderRadius: "12px",
                fontSize: "0.9rem", resize: "none",
                boxSizing: "border-box", marginBottom: "16px",
              }}
            />

            <button
              type="button"
              onClick={confirmarAviso}
              disabled={savingAviso}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: "#dc2626", color: "#fff",
                fontWeight: 700, fontSize: "1rem", cursor: savingAviso ? "not-allowed" : "pointer",
                opacity: savingAviso ? 0.7 : 1,
              }}
            >
              {savingAviso ? "Enviando…" : "Confirmar y avisar al cliente"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
