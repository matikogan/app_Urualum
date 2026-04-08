import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { norm } from "utils/text";
import SearchBar from "../components/SearchBar";
import { useApp } from "../../../context/AppContext";

/* ── helpers fecha ── */
function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  if (p?.timestamps?.creado?.seconds) return new Date(p.timestamps.creado.seconds * 1000);
  return null;
}

function formatFechaCorta(p) {
  const d = getPedidoDate(p);
  if (!d || isNaN(d)) return null;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysDiff(a, b) { return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000); }

function getUrgencia(p) {
  const d = getPedidoDate(p);
  if (!d) return null;
  const diff = daysDiff(new Date(), d);
  if (diff > 0) return "vencido";
  if (diff === 0) return "hoy";
  return null;
}

function formatTimeAgo(ts) {
  if (!ts) return null;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(date)) return null;
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
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

/* ── componente ── */
export default function PedidosControladosVentas() {
  const { toast } = useApp();
  const navigate  = useNavigate();
  const [controlados, setControlados] = useState([]);
  const [conProblema, setConProblema]  = useState([]);
  const [despsHoy, setDespsHoy]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState("");
  const [debouncedQ, setDebouncedQ]   = useState("");

  // Modal "Avisar cliente"
  const [avisando, setAvisando]       = useState(null); // pedido seleccionado
  const [notaAviso, setNotaAviso]     = useState("");
  const [savingAviso, setSavingAviso] = useState(false);

  /* ── listeners ── */
  useEffect(() => {
    // 1. Pedidos CONTROLADOS
    const unsubCtrl = onSnapshot(
      query(collection(db, "pedidos"), where("estado", "==", "CONTROLADO")),
      (snap) => {
        setControlados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => { console.error(err); setLoading(false); }
    );

    // 2. Pedidos con problema ELEVADO (cualquier estado)
    const unsubProb = onSnapshot(
      query(collection(db, "pedidos"), where("problema.estado", "==", "ELEVADO")),
      (snap) => setConProblema(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[Ventas] problemas:", err)
    );

    // 3. Despachados HOY
    const today = new Date(); today.setHours(0,0,0,0);
    const end   = new Date(today); end.setHours(23,59,59,999);
    const unsubDesp = onSnapshot(
      query(collection(db, "pedidos_despachados"),
        where("despachadoAt", ">=", today),
        where("despachadoAt", "<=", end)),
      (snap) => setDespsHoy(snap.docs.map(d => ({ id: d.id, ...d.data(), estado: "DESPACHADO" }))),
      (err) => console.error("[Ventas] despachados:", err)
    );

    return () => { unsubCtrl(); unsubProb(); unsubDesp(); };
  }, []);

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

  const controladosFiltrados = useMemo(() => filtrar(controlados), [controlados, debouncedQ]);
  const conProblemaFiltrados = useMemo(() => filtrar(conProblema), [conProblema, debouncedQ]);

  /* ── avisar al cliente ── */
  async function confirmarAviso() {
    if (!avisando) return;
    const wid = avisando.webPedidoId || avisando.pedidoWebId || null;
    try {
      setSavingAviso(true);
      // Siempre actualizar el campo en el pedido interno
      await updateDoc(doc(db, "pedidos", avisando.id), {
        "problema.avisadoClienteAt": serverTimestamp(),
        "problema.notaAviso": notaAviso.trim() || null,
      });
      // Si tiene link a pedido web, actualizar ese también
      if (wid) {
        await updateDoc(doc(db, "pedidos_web", wid), {
          estado: "ERROR_STOCK",
          notaError: notaAviso.trim() ||
            `Hay un problema con tu pedido: ${avisando.problema?.productoNombre || "un producto"} (${
              avisando.problema?.tipo === "FALTA_STOCK" ? "falta de stock" : "otro motivo"
            }). Serás contactado por WhatsApp.`,
          errorAt: serverTimestamp(),
        });
      }
      toast.success(wid ? "Cliente avisado en la app ✓" : "Problema registrado ✓ (sin app cliente vinculada)");
      setAvisando(null);
      setNotaAviso("");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo avisar al cliente");
    } finally {
      setSavingAviso(false);
    }
  }

  /* ── card de pedido ── */
  function renderCard(p, tipo) {
    const urgencia = getUrgencia(p);
    const urgColor = urgencia === "vencido" ? "#ef4444" : urgencia === "hoy" ? "#f59e0b" : null;
    const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
    const itemCount = p.productos?.length ?? 0;
    const fechaCorta = formatFechaCorta(p);
    const timeAgo = tipo === "problema"
      ? formatTimeAgo(p.problema?.elevadoAt)
      : formatTimeAgo(p.timestamps?.CONTROLADO);
    const yaAvisado = !!p.problema?.avisadoClienteAt;

    return (
      <div
        key={p.id}
        onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
        style={{
          background: "#fff",
          borderRadius: "14px",
          border: tipo === "problema" ? "1.5px solid #fca5a5" : "1px solid #e2e8f0",
          borderLeft: tipo === "problema"
            ? "4px solid #ef4444"
            : urgColor
            ? `4px solid ${urgColor}`
            : "1px solid #e2e8f0",
          padding: "13px 14px",
          marginBottom: "8px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
          cursor: "pointer",
        }}
      >
        {/* Fila 1: número + método + tiempo */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f172a" }}>
            #{p.numero || p.id}
          </span>
          {p.metodoEntrega && (
            <span style={{
              fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px",
              borderRadius: "999px", letterSpacing: "0.05em", flexShrink: 0,
              background: metodoStyle.bg, color: metodoStyle.color,
            }}>
              {p.metodoEntrega}
            </span>
          )}
          {urgencia && tipo !== "problema" && (
            <span style={{
              marginLeft: "auto", flexShrink: 0, fontSize: "0.63rem", fontWeight: 700,
              padding: "2px 7px", borderRadius: "999px",
              background: urgencia === "vencido" ? "#fef2f2" : "#fefce8", color: urgColor,
            }}>
              {urgencia === "vencido" ? "⚠ Vencido" : "⏰ Hoy"}
            </span>
          )}
          {timeAgo && !urgencia && (
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>
              ⏱ {timeAgo}
            </span>
          )}
        </div>

        {/* Fila 2: cliente */}
        <p style={{
          margin: "0 0 5px", fontSize: "0.95rem", fontWeight: 700, color: "#0f172a",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.cliente || "—"}
        </p>

        {/* Fila 3: ítems + fecha + bultos */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: tipo === "problema" ? "10px" : 0 }}>
          <span style={{ fontSize: "0.76rem", color: "#64748b" }}>
            {itemCount} ítem{itemCount !== 1 ? "s" : ""}
          </span>
          {fechaCorta && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: "0.76rem", color: urgColor || "#64748b" }}>📅 {fechaCorta}</span>
            </>
          )}
          {p.bultos > 0 && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: "0.76rem", color: "#64748b" }}>📦 {p.bultos} bultos</span>
            </>
          )}
          {tipo !== "problema" && (
            <span style={{ marginLeft: "auto", fontSize: "0.8rem", fontWeight: 700, color: "#0891b2" }}>
              Despachar →
            </span>
          )}
        </div>

        {/* Bloque de problema (solo en sección problemas) */}
        {tipo === "problema" && p.problema && (
          <div style={{ background: "#fef2f2", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <span style={{ fontSize: "0.9rem", flexShrink: 0 }}>
                {p.problema.tipo === "FALTA_STOCK" ? "📦" : "⚠️"}
              </span>
              <div>
                <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 700, color: "#dc2626" }}>
                  {p.problema.tipo === "FALTA_STOCK" ? "Falta de stock" : "Otro problema"} — {p.problema.productoNombre || "producto sin nombre"}
                </p>
                {p.problema.descripcion && (
                  <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#7f1d1d", fontStyle: "italic" }}>
                    "{p.problema.descripcion}"
                  </p>
                )}
                {p.problema.notaEncargado && (
                  <p style={{ margin: "3px 0 0", fontSize: "0.76rem", color: "#9a3412" }}>
                    Encargado: "{p.problema.notaEncargado}"
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Acciones en sección problemas */}
        {tipo === "problema" && (
          <div style={{ display: "flex", gap: "8px" }} onClick={e => e.stopPropagation()}>
            <span
              style={{
                flex: 1, padding: "9px", background: "#f8fafc",
                border: "1.5px solid #e2e8f0", borderRadius: "10px",
                fontWeight: 600, fontSize: "0.82rem", color: "#475569",
                textAlign: "center", cursor: "pointer",
              }}
              onClick={() => navigate(`/ventas/para-despachar/${encodeURIComponent(p.id)}`)}
            >
              Ver detalle
            </span>
            {yaAvisado ? (
              <div style={{
                flex: 1, padding: "9px", background: "#f0fdf4",
                border: "1.5px solid #86efac", borderRadius: "10px",
                fontWeight: 600, fontSize: "0.82rem", color: "#16a34a",
                textAlign: "center",
              }}>
                ✓ Avisado
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setAvisando(p); setNotaAviso(""); }}
                style={{
                  flex: 1, padding: "9px", background: "#fef2f2",
                  border: "1.5px solid #fca5a5", borderRadius: "10px",
                  fontWeight: 700, fontSize: "0.82rem", color: "#dc2626",
                  cursor: "pointer",
                }}
              >
                📲 Avisar cliente
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const totalAccion = controladosFiltrados.length + conProblemaFiltrados.length;

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 16px 12px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <a
            href="/inicio"
            title="Volver al inicio"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", flexShrink: 0,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
            }}
          >
            ←
          </a>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", flex: 1 }}>
            Para despachar
          </h1>
          {!loading && totalAccion > 0 && (
            <span style={{ background: "#dc2626", color: "#fff", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: "999px" }}>
              {totalAccion} pendiente{totalAccion !== 1 ? "s" : ""}
            </span>
          )}
          <a
            href="/ventas/despachados"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px",
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
            }}
            title="Histórico de despachos"
          >
            📋
          </a>
        </div>
        <SearchBar
          value={q}
          onChange={setQ}
          onClear={() => setQ("")}
          placeholder="Buscar cliente, #pedido…"
        />
      </div>

      {/* ── Contenido ── */}
      <div style={{ padding: "12px 12px 80px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: "0.9rem" }}>
            Cargando pedidos…
          </div>
        )}

        {!loading && controladosFiltrados.length === 0 && conProblemaFiltrados.length === 0 && despsHoy.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 16px" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>📭</div>
            <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: 0 }}>No hay pedidos para mostrar.</p>
          </div>
        )}

        {/* ── Sección: Problemas elevados ── */}
        {!loading && conProblemaFiltrados.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#dc2626", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                🚨 Requieren atención
              </span>
              <span style={{ background: "#fee2e2", color: "#dc2626", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                {conProblemaFiltrados.length}
              </span>
            </div>
            {conProblemaFiltrados.map(p => renderCard(p, "problema"))}
          </div>
        )}

        {/* ── Sección: Controlados para despachar ── */}
        {!loading && controladosFiltrados.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#0891b2", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                📦 Listos para despachar
              </span>
              <span style={{ background: "#ecfeff", color: "#0891b2", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                {controladosFiltrados.length}
              </span>
            </div>
            {controladosFiltrados.map(p => renderCard(p, "controlado"))}
          </div>
        )}

        {/* ── Sección: Despachados hoy ── */}
        {!loading && despsHoy.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                🚚 Despachados hoy
              </span>
              <span style={{ background: "#f1f5f9", color: "#475569", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                {despsHoy.length}
              </span>
            </div>
            {despsHoy.map(p => {
              const fechaCorta = formatFechaCorta(p);
              const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
              return (
                <div key={p.id} style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "11px 14px", marginBottom: "7px", opacity: 0.8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.87rem", color: "#64748b" }}>#{p.numero || p.id}</span>
                    {p.metodoEntrega && (
                      <span style={{ fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: metodoStyle.bg, color: metodoStyle.color }}>
                        {p.metodoEntrega}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8" }}>✓ Despachado</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.cliente || "—"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Avisar cliente ── */}
      {avisando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "flex-end" }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 16px 40px", width: "100%", maxHeight: "80vh", overflow: "auto" }}>
            {/* Título */}
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

            {/* Info del pedido */}
            <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "12px 14px", marginBottom: "16px" }}>
              <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>
                #{avisando.numero} — {avisando.cliente}
              </p>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#dc2626", fontWeight: 600 }}>
                {avisando.problema?.tipo === "FALTA_STOCK" ? "📦 Falta de stock" : "⚠️ Otro problema"} en {avisando.problema?.productoNombre || "un producto"}
              </p>
            </div>

            {/* Conexión con app */}
            {avisando.webPedidoId ? (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>✅</span>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#15803d", fontWeight: 600 }}>
                  Pedido vinculado a la app del cliente — se actualizará automáticamente
                </p>
              </div>
            ) : (
              <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>⚠️</span>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#92400e" }}>
                  Este pedido no tiene app cliente vinculada — solo quedará registrado el aviso internamente
                </p>
              </div>
            )}

            {/* Mensaje para el cliente */}
            <p style={{ margin: "0 0 8px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Mensaje al cliente (opcional)
            </p>
            <textarea
              value={notaAviso}
              onChange={e => setNotaAviso(e.target.value)}
              placeholder={`Ej: Hay un problema con "${avisando.problema?.productoNombre}". Serás contactado por WhatsApp a la brevedad.`}
              rows={3}
              style={{
                width: "100%", padding: "12px",
                border: "1.5px solid #e2e8f0", borderRadius: "12px",
                fontSize: "0.9rem", resize: "none",
                boxSizing: "border-box", marginBottom: "16px",
              }}
            />

            <p style={{ margin: "0 0 14px", fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
              El cliente verá el aviso en la app y recibirá un contacto por WhatsApp
            </p>

            <button
              type="button"
              onClick={confirmarAviso}
              disabled={savingAviso}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                background: "#dc2626", color: "#fff",
                fontWeight: 700, fontSize: "1rem", cursor: "pointer",
              }}
            >
              {savingAviso ? "Enviando aviso…" : "Confirmar y avisar al cliente"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
