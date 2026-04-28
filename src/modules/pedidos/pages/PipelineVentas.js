/**
 * PipelineVentas — vista principal del usuario ventas.
 *
 * Kanban full-screen que muestra todos los estados del flujo de pedidos.
 * Se adapta automáticamente a cada depósito:
 *   · R8      — flujo completo con asignación de operario
 *   · ISABELA  — sin asignación, estados simplificados + entregados desde pedidos_despachados
 *
 * Columnas con fondo coloreado = requieren acción de VENTAS (despachar, verificar error).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  collection, onSnapshot, query,
  orderBy, where, limit,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { useNavigate } from "react-router-dom";
import { syncPendientesDeHoy } from "../services/syncFinnegans";
import { FLUJO_ISABELA, FLUJO_R8 } from "../services/estadosConfig";

// Aliases locales para mantener los nombres que usa este componente
const STATES_ISABELA = FLUJO_ISABELA;
const STATES_R8      = FLUJO_R8;

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

const STUCK_MS = 2 * 24 * 3600 * 1000;

function isStuck(p) {
  if (!p.updatedAt?.seconds) return false;
  const final = ["DESPACHADO", "CANCELADO", "ANULADO", "DESP_ENTREGADO"];
  if (final.includes(p.estado)) return false;
  return Date.now() - p.updatedAt.seconds * 1000 > STUCK_MS;
}

function formatTimeAgo(ts) {
  if (!ts) return null;
  const d = ts?.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(d)) return null;
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  return null;
}

function formatFechaCorta(d) {
  if (!d) return null;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

// ─────────────────────────────────────────────────────────────
//  PipelineCard
// ─────────────────────────────────────────────────────────────

function PipelineCard({ p, cfg }) {
  const navigate = useNavigate();
  const stuck = isStuck(p);
  const items = p.productos?.length ?? p.items?.length ?? 0;
  const timeAgo = formatTimeAgo(p.timestamps?.[p.estado] || p.updatedAt);
  const creacion = getPedidoDate(p);

  const metodoColors = {
    AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
    RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
    CAMION:  { bg: "#fef3c7", color: "#92400e" },
    GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
  };
  const mc = metodoColors[p.metodoEntrega] || { bg: "#f1f5f9", color: "#475569" };

  // Destino al hacer click
  const href = `/pedidos/${encodeURIComponent(p.id)}`;

  return (
    <div
      onClick={() => navigate(href)}
      style={{
        background: "#fff",
        border: stuck
          ? "2px solid #f97316"
          : `1px solid ${cfg.border}`,
        borderRadius: "10px",
        padding: "10px 12px",
        marginBottom: "7px",
        cursor: "pointer",
        boxShadow: stuck
          ? "0 2px 8px rgba(249,115,22,0.18)"
          : "0 1px 3px rgba(0,0,0,0.05)",
        position: "relative",
        transition: "transform 0.1s, box-shadow 0.1s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = stuck
          ? "0 4px 12px rgba(249,115,22,0.25)"
          : "0 4px 10px rgba(0,0,0,0.1)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = stuck
          ? "0 2px 8px rgba(249,115,22,0.18)"
          : "0 1px 3px rgba(0,0,0,0.05)";
      }}
    >
      {/* Badge atascado */}
      {stuck && (
        <div style={{
          position: "absolute", top: -9, right: 8,
          background: "#f97316", color: "#fff",
          fontSize: "0.56rem", fontWeight: 800,
          padding: "2px 7px", borderRadius: "999px",
          letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          +2 días
        </div>
      )}

      {/* Fila 1: # pedido + tiempo en estado */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
        <span style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0f172a" }}>
          #{p.numero || p.id}
        </span>
        {timeAgo && (
          <span style={{
            fontSize: "0.65rem",
            color: stuck ? "#f97316" : "#94a3b8",
            fontWeight: stuck ? 700 : 500,
          }}>
            ⏱ {timeAgo}
          </span>
        )}
      </div>

      {/* Fila 2: cliente */}
      <p style={{
        margin: "0 0 5px",
        fontSize: "0.85rem", fontWeight: 600, color: "#1e293b",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        lineHeight: 1.3,
      }}>
        {p.cliente || "—"}
      </p>

      {/* Fila 3: ítems + método + fecha creación + depósito */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
        {items > 0 && (
          <span style={{ fontSize: "0.67rem", color: "#64748b" }}>
            {items} ítem{items !== 1 ? "s" : ""}
          </span>
        )}
        {p.metodoEntrega && (
          <span style={{
            fontSize: "0.6rem", fontWeight: 700,
            background: mc.bg, color: mc.color,
            padding: "1px 6px", borderRadius: "999px",
          }}>
            {p.metodoEntrega}
          </span>
        )}
        {/* Fecha de creación (referencia) */}
        {creacion && p.estado !== "PENDIENTE_ASIGNAR" && (
          <span style={{ fontSize: "0.6rem", color: "#94a3b8", marginLeft: "auto" }}>
            📅 {formatFechaCorta(creacion)}
          </span>
        )}
        {/* Depósito — solo cuando se ven todos los depósitos */}
        {p.deposito && !p._hideDeposito && (
          <span style={{
            fontSize: "0.58rem", color: "#94a3b8",
            marginLeft: creacion ? "0" : "auto",
          }}>
            {p.deposito}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PipelineColumn
// ─────────────────────────────────────────────────────────────

function PipelineColumn({ cfg, items, colHeight }) {
  const stuckCount = items.filter(isStuck).length;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      background: "#fff",
      borderRadius: "14px",
      border: cfg.ventasAction
        ? `2px solid ${cfg.border}`
        : "1.5px solid #e2e8f0",
      overflow: "hidden",
      boxShadow: cfg.ventasAction
        ? `0 0 0 3px ${cfg.border}40`
        : "none",
      /* Columna crece para ocupar todo el alto disponible */
      minHeight: "120px",
      height: colHeight,
    }}>

      {/* Cabecera de columna */}
      <div style={{
        background: cfg.ventasAction ? cfg.headerBg : "#f8fafc",
        borderBottom: `1px solid ${cfg.ventasAction ? cfg.border : "#f1f5f9"}`,
        padding: "11px 13px 10px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: cfg.ventasAction || cfg.sublabel ? "4px" : 0 }}>
          <span style={{ fontSize: "0.88rem", lineHeight: 1 }}>{cfg.icon}</span>
          <span style={{
            flex: 1,
            fontWeight: 700,
            fontSize: "0.78rem",
            color: cfg.ventasAction ? cfg.color : "#475569",
            letterSpacing: "-0.01em",
          }}>
            {cfg.label}
          </span>
          {/* Badge atascados en columna */}
          {stuckCount > 0 && (
            <span style={{
              background: "#f97316", color: "#fff",
              fontSize: "0.58rem", fontWeight: 800,
              padding: "1px 5px", borderRadius: "999px",
            }}>
              ⚠{stuckCount}
            </span>
          )}
          {/* Contador de pedidos */}
          <span style={{
            background: items.length > 0
              ? cfg.color + "22"
              : "#f1f5f9",
            color: items.length > 0 ? cfg.color : "#94a3b8",
            fontSize: "0.72rem", fontWeight: 700,
            padding: "1px 8px", borderRadius: "999px",
            minWidth: "22px", textAlign: "center",
          }}>
            {items.length}
          </span>
        </div>
        {/* Sub-label para columnas con acción de ventas */}
        {cfg.sublabel && (
          <p style={{
            margin: 0,
            fontSize: "0.6rem",
            fontWeight: 700,
            color: cfg.ventasAction ? cfg.color : "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}>
            {cfg.ventasAction ? "▶ " : ""}{cfg.sublabel}
          </p>
        )}
      </div>

      {/* Cuerpo scrolleable */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "9px",
        background: items.length === 0 ? "#fafafa" : "transparent",
      }}>
        {items.length === 0 ? (
          <p style={{
            textAlign: "center",
            color: "#d1d5db",
            fontSize: "0.75rem",
            padding: "16px 0",
            margin: 0,
          }}>
            Sin pedidos
          </p>
        ) : (
          items.map(p => (
            <PipelineCard key={p.id} p={p} cfg={cfg} />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export default function PipelineVentas() {
  const { profile } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();

  // Si el usuario tiene un depósito asignado en su perfil, lo usamos como filtro inicial
  // Normalizamos a UPPERCASE para que coincida con los chips de depósito
  const depositoInicial = profile?.deposito ? String(profile.deposito).trim().toUpperCase() : "";

  const [pedidos, setPedidos]               = useState([]);
  const [despachadosAll, setDespachadosAll] = useState([]);
  const [entregadosAll, setEntregadosAll]   = useState([]);
  const [loading, setLoading]               = useState(true);
  const [searchQ, setSearchQ]               = useState("");
  const [filterDeposito, setFilterDeposito] = useState(depositoInicial);
  const [syncing, setSyncing]               = useState(false);
  const [lastSync, setLastSync]             = useState(null);
  const syncRunRef                          = useRef(false);

  // ── Auto-sync al entrar a la página (una vez por sesión) ──
  useEffect(() => {
    if (syncRunRef.current) return;
    syncRunRef.current = true;
    (async () => {
      setSyncing(true);
      try { await syncPendientesDeHoy(); setLastSync(new Date()); }
      catch (e) { console.error("[PipelineVentas] sync auto error:", e); }
      finally { setSyncing(false); }
    })();
  }, []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncPendientesDeHoy();
      setLastSync(new Date());
      toast.success("Pedidos actualizados ✓");
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron sincronizar los pedidos");
    } finally {
      setSyncing(false);
    }
  }

  // Medir el TopBar para calcular la altura disponible exacta
  const [topbarH, setTopbarH] = useState(60);
  useEffect(() => {
    const measure = () => {
      const tb = document.querySelector(".topbar");
      if (tb) setTopbarH(tb.offsetHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // ── Listener pedidos activos (colección principal) ──
  // Cuando hay un depósito seleccionado usamos where("deposito", ==) igual que el
  // encargado — esto garantiza reactividad en tiempo real sin depender de índices
  // compuestos ni de que updatedAt ya esté confirmado por el servidor.
  // Cuando se ve "Todos" usamos orderBy + limit como antes.
  useEffect(() => {
    setLoading(true);
    let q;
    if (filterDeposito) {
      q = query(
        collection(db, "pedidos"),
        where("deposito", "==", filterDeposito)
      );
    } else {
      q = query(
        collection(db, "pedidos"),
        orderBy("updatedAt", "desc"),
        limit(500)
      );
    }
    const unsub = onSnapshot(q,
      snap => {
        setPedidos(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(p => !["CANCELADO", "ANULADO"].includes(p.estado))
        );
        setLoading(false);
      },
      err => { console.error("[PipelineVentas]", err); setLoading(false); }
    );
    return () => unsub();
  }, [filterDeposito]); // ← reactivo: se re-subscribe cuando cambia el depósito

  // ── Listener pedidos_despachados ──
  // Se usan DOS listeners:
  //   1. ISABELA: sin filtro de fecha — muestra TODOS los pendientes de entrega sin importar cuándo se despacharon
  //   2. R8: últimos 30 días — solo para la columna "Despachados hoy"
  useEffect(() => {
    // Listener ISABELA — sin restricción de fecha, todos los despachados de ese depósito
    // Sin orderBy para evitar requerir índice compuesto; el orden se aplica en JS (byEstado)
    const qIsabela = query(
      collection(db, "pedidos_despachados"),
      where("deposito", "==", "ISABELA"),
      limit(500)
    );

    // Listener R8 — últimos 30 días
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    const qR8 = query(
      collection(db, "pedidos_despachados"),
      where("despachadoAt", ">=", since),
      orderBy("despachadoAt", "desc"),
      limit(300)
    );

    // Mantenemos dos Sets para combinarlos sin duplicados
    let isabelaDocs = [];
    let r8Docs      = [];

    function merge() {
      const seen = new Set();
      const combined = [];
      for (const d of [...isabelaDocs, ...r8Docs]) {
        if (!seen.has(d.id)) { seen.add(d.id); combined.push(d); }
      }
      setDespachadosAll(combined);
    }

    const unsubIsabela = onSnapshot(qIsabela,
      snap => { isabelaDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
      err  => console.error("[PipelineVentas] despachos ISABELA:", err)
    );
    const unsubR8 = onSnapshot(qR8,
      snap => { r8Docs = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
      err  => console.error("[PipelineVentas] despachos R8:", err)
    );

    return () => { unsubIsabela(); unsubR8(); };
  }, []);

  // ── Listener pedidos_entregados — solo HOY para el pipeline ──
  // El histórico completo está en /ventas/entregados
  useEffect(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, "pedidos_entregados"),
      where("entregadoAt", ">=", hoy),
      limit(300)
    );
    const unsub = onSnapshot(q,
      snap => setEntregadosAll(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => console.error("[PipelineVentas] entregados:", err)
    );
    return () => unsub();
  }, []);

  // ── Depósitos disponibles ──
  // Base fija para que los chips siempre aparezcan aunque no haya pedidos activos.
  // Se complementa con cualquier depósito extra que aparezca en Firestore.
  const DEPOSITOS_BASE = ["ISABELA", "R8"];
  const deposits = useMemo(() => {
    const fromPedidos = pedidos
      .map(p => p.deposito ? String(p.deposito).trim().toUpperCase() : null)
      .filter(Boolean);
    return [...new Set([...DEPOSITOS_BASE, ...fromPedidos])].sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  // ── ¿Estamos viendo ISABELA? ──
  const isIsabela = filterDeposito.toUpperCase() === "ISABELA";

  // Config de estados según depósito seleccionado
  const stateConfig = isIsabela ? STATES_ISABELA : STATES_R8;

  // ── Filtro base de pedidos ──
  const pedidosFiltrados = useMemo(() => {
    const nq = searchQ.trim().toLowerCase();
    return pedidos.filter(p => {
      // Filtro por depósito: comparación case-insensitive y trim para evitar falsos negativos
      if (filterDeposito) {
        const dep = String(p.deposito || "").trim().toUpperCase();
        if (dep !== filterDeposito.trim().toUpperCase()) return false;
      }
      if (nq) {
        const num = String(p.numero || p.id || "").toLowerCase();
        const cli = String(p.cliente || "").toLowerCase();
        return num.includes(nq) || cli.includes(nq);
      }
      return true;
    }).map(p => ({ ...p, _hideDeposito: !!filterDeposito }));
  }, [pedidos, searchQ, filterDeposito]);

  // ── Filtro base de despachados ──
  const despsFiltradas = useMemo(() => {
    const nq = searchQ.trim().toLowerCase();
    return despachadosAll.filter(p => {
      if (filterDeposito) {
        const dep = String(p.deposito || "").trim().toUpperCase();
        if (dep !== filterDeposito.trim().toUpperCase()) return false;
      }
      if (nq) {
        const num = String(p.numero || p.id || "").toLowerCase();
        const cli = String(p.cliente || "").toLowerCase();
        return num.includes(nq) || cli.includes(nq);
      }
      return true;
    });
  }, [despachadosAll, searchQ, filterDeposito]);

  // ── Set de números de pedido que siguen activos en 'pedidos' (no terminados) ──
  // Evita que un pedido aparezca a la vez en 'Para despachar' y en las columnas
  // de pedidos_despachados cuando la operación de despacho quedó incompleta.
  const ESTADOS_TERMINADOS = new Set(["DESPACHADO", "ANULADO", "CANCELADO"]);
  const activosNums = useMemo(() => {
    const s = new Set();
    for (const p of pedidos) {
      if (!ESTADOS_TERMINADOS.has(p.estado)) {
        const num = String(p.numero || p.id || "").trim().toLowerCase();
        if (num) s.add(num);
      }
    }
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  // Filtra despsFiltradas excluyendo pedidos que todavía están activos en 'pedidos'
  const despsNoActivos = useMemo(() =>
    despsFiltradas.filter(p => {
      const num = String(p.numero || p.id || "").trim().toLowerCase();
      return !activosNums.has(num);
    })
  , [despsFiltradas, activosNums]);

  // ── Pedidos de hoy (para columna DESPACHADO de R8) ──
  const despachosHoy = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return despsNoActivos.filter(p => {
      if (!p.despachadoAt?.seconds) return false;
      return new Date(p.despachadoAt.seconds * 1000) >= hoy;
    }).map(p => ({ ...p, estado: "DESPACHADO", _hideDeposito: !!filterDeposito }));
  }, [despsNoActivos, filterDeposito]);

  // ── Virtuales ISABELA ──
  const isabelaPendienteEntrega = useMemo(() =>
    despsNoActivos
      .filter(p => p.necesitaControl !== false)
      .map(p => ({ ...p, estado: "DESP_PENDIENTE", _hideDeposito: !!filterDeposito }))
  , [despsNoActivos, filterDeposito]);

  // ── Helper: filtra entregadosAll por depósito y búsqueda ──
  const entregadosFiltrados = useMemo(() => {
    const nq = searchQ.trim().toLowerCase();
    return entregadosAll.filter(p => {
      if (filterDeposito) {
        const dep = String(p.deposito || "").trim().toUpperCase();
        if (dep !== filterDeposito.trim().toUpperCase()) return false;
      }
      if (nq) {
        const num = String(p.numero || p.id || "").toLowerCase();
        const cli = String(p.cliente || "").toLowerCase();
        return num.includes(nq) || cli.includes(nq);
      }
      return true;
    });
  }, [entregadosAll, searchQ, filterDeposito]);

  // ISABELA → estado virtual "DESP_ENTREGADO"
  const isabelaEntregados = useMemo(() =>
    entregadosFiltrados.map(p => ({ ...p, estado: "DESP_ENTREGADO", _hideDeposito: !!filterDeposito }))
  , [entregadosFiltrados, filterDeposito]);

  // R8 → estado virtual "ENTREGADO"
  const r8Entregados = useMemo(() =>
    entregadosFiltrados.map(p => ({ ...p, estado: "ENTREGADO", _hideDeposito: !!filterDeposito }))
  , [entregadosFiltrados, filterDeposito]);

  // ── Agrupación por estado → columna ──
  const byEstado = useMemo(() => {
    const out = {};
    for (const cfg of stateConfig) out[cfg.id] = [];

    for (const p of pedidosFiltrados) {
      const e = p.estado || "PENDIENTE_ASIGNAR";
      if (out[e] !== undefined) out[e].push(p);
    }

    // Columnas derivadas de pedidos_despachados / pedidos_entregados
    if (isIsabela) {
      // ISABELA — DESP_PENDIENTE: pedidos_despachados + fallback desde colección pedidos
      const despFromPedidos = pedidosFiltrados
        .filter(p => p.estado === "DESPACHADO")
        .map(p => ({ ...p, estado: "DESP_PENDIENTE", _hideDeposito: !!filterDeposito }));
      const idsFromDespachos = new Set(isabelaPendienteEntrega.map(p => p.id));
      out["DESP_PENDIENTE"] = [
        ...isabelaPendienteEntrega,
        ...despFromPedidos.filter(p => !idsFromDespachos.has(p.id)),
      ];
      out["DESP_ENTREGADO"] = isabelaEntregados;
    } else {
      // R8 — DESPACHADO: todos los pendientes de entrega (necesitaControl !== false)
      const r8PendienteEntrega = despsNoActivos
        .filter(p => p.necesitaControl !== false)
        .map(p => ({ ...p, estado: "DESPACHADO", _hideDeposito: !!filterDeposito }));
      // Fallback: pedidos que quedaron con estado DESPACHADO en la colección principal
      const despFromPedidosR8 = pedidosFiltrados
        .filter(p => p.estado === "DESPACHADO")
        .map(p => ({ ...p, _hideDeposito: !!filterDeposito }));
      const idsDespachadosR8 = new Set(r8PendienteEntrega.map(p => p.id));
      out["DESPACHADO"] = [
        ...r8PendienteEntrega,
        ...despFromPedidosR8.filter(p => !idsDespachadosR8.has(p.id)),
      ];
      // R8 — ENTREGADO: desde pedidos_entregados
      out["ENTREGADO"] = r8Entregados;
    }

    // Ordenar cada columna: atascados primero, luego updatedAt desc
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => {
        if (isStuck(a) !== isStuck(b)) return isStuck(a) ? -1 : 1;
        return (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);
      });
    }

    return out;
  }, [pedidosFiltrados, stateConfig, isIsabela, isabelaPendienteEntrega, isabelaEntregados, r8Entregados, despsNoActivos, despachosHoy, filterDeposito]);

  // ── Totales para el header ──
  const totalPedidos = pedidosFiltrados.length;
  const totalAtascados = pedidosFiltrados.filter(isStuck).length;
  const totalAccion = useMemo(() =>
    stateConfig
      .filter(c => c.ventasAction)
      .reduce((acc, c) => acc + (byEstado[c.id]?.length || 0), 0)
  , [stateConfig, byEstado]);

  // ── Altura disponible: viewport - TopBar (medido dinámicamente) ──
  // Pipeline header interno: 58px | Grid padding top+bottom: 20px
  const availH    = `calc(100vh - ${topbarH}px)`;
  const colHeight = `calc(100vh - ${topbarH}px - 58px - 20px)`;

  // ─────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: "#f1f5f9",
      height: availH,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Header compacto ── */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "0 20px",
        height: "58px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "14px",
        zIndex: 10,
      }}>

        {/* Título + badges */}
        <h1 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>
          Pedidos
        </h1>

        {/* Badge: pedidos con acción */}
        {!loading && totalAccion > 0 && (
          <span style={{
            background: "#15803d", color: "#fff",
            fontSize: "0.7rem", fontWeight: 800,
            padding: "3px 10px", borderRadius: "999px",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {totalAccion} para despachar
          </span>
        )}

        {/* Badge: atascados */}
        {!loading && totalAtascados > 0 && (
          <span style={{
            background: "#f97316", color: "#fff",
            fontSize: "0.7rem", fontWeight: 800,
            padding: "3px 10px", borderRadius: "999px",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            ⚠️ {totalAtascados} atascado{totalAtascados !== 1 ? "s" : ""}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Chips de depósito */}
        <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
          {["", ...deposits].map(dep => {
            const active = filterDeposito === dep;
            return (
              <button
                key={dep || "__todos__"}
                onClick={() => setFilterDeposito(dep)}
                style={{
                  padding: "4px 12px",
                  borderRadius: "999px",
                  border: "none",
                  background: active ? "#0f172a" : "#f1f5f9",
                  color: active ? "#fff" : "#64748b",
                  fontSize: "0.74rem",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
              >
                {dep || "Todos"}
              </button>
            );
          })}
        </div>

        {/* Búsqueda */}
        <input
          placeholder="🔍 Buscar cliente o #pedido…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: "8px",
            border: "1.5px solid #e2e8f0",
            fontSize: "0.83rem",
            width: "210px",
            background: "#f8fafc",
            flexShrink: 0,
          }}
        />

        {/* Total pedidos */}
        {!loading && (
          <span style={{ fontSize: "0.72rem", color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
            {totalPedidos} pedido{totalPedidos !== 1 ? "s" : ""}
          </span>
        )}

        {/* Botón sync Finnegans */}
        <button
          onClick={handleSync}
          disabled={syncing}
          title={lastSync
            ? `Última actualización: ${lastSync.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
            : "Actualizar pedidos desde Finnegans"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "5px",
            height: "32px",
            padding: "0 12px",
            background: syncing ? "#f1f5f9" : "#0f172a",
            border: "none",
            borderRadius: "8px",
            color: syncing ? "#94a3b8" : "#fff",
            fontSize: "0.76rem",
            fontWeight: 700,
            cursor: syncing ? "not-allowed" : "pointer",
            flexShrink: 0,
            transition: "all 0.15s",
          }}
        >
          <span style={{
            display: "inline-block",
            animation: syncing ? "spin 0.8s linear infinite" : "none",
          }}>
            🔄
          </span>
          {syncing ? "Actualizando…" : "Actualizar"}
          {lastSync && !syncing && (
            <span style={{ fontSize: "0.65rem", fontWeight: 400, opacity: 0.7, marginLeft: "2px" }}>
              {lastSync.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </button>

        {/* Link al histórico de despachos */}
        <a
          href="/ventas/despachados"
          title="Histórico de despachos"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "32px", height: "32px",
            background: "#f8fafc", border: "1px solid #e2e8f0",
            borderRadius: "8px", textDecoration: "none",
            fontSize: "0.9rem", flexShrink: 0,
          }}
        >
          📋
        </a>

        {/* Link al histórico de entregados */}
        <a
          href="/ventas/entregados"
          title="Histórico de pedidos entregados"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "5px",
            height: "32px",
            padding: "0 11px",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: "8px", textDecoration: "none",
            fontSize: "0.74rem", fontWeight: 700,
            color: "#15803d", flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          📦 Entregados
        </a>
      </div>

      {/* ── Kanban board ── */}
      {loading ? (
        <div style={{
          flex: 1, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "#94a3b8", fontSize: "0.9rem",
        }}>
          Cargando pedidos…
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: "grid",
          /* Columnas distribuyen el ancho disponible equitativamente.
             minmax garantiza que no se compriman demasiado (mín 160px). */
          gridTemplateColumns: `repeat(${stateConfig.length}, minmax(160px, 1fr))`,
          gap: "10px",
          padding: "10px 16px",
          overflowX: "auto",
          alignItems: "stretch",
          boxSizing: "border-box",
        }}>
          {stateConfig.map(cfg => (
            <PipelineColumn
              key={cfg.id}
              cfg={cfg}
              items={byEstado[cfg.id] || []}
              colHeight={colHeight}
            />
          ))}
        </div>
      )}
    </div>
  );
}
