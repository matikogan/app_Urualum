/**
 * Panel de administración — /admin/panel
 *
 * Permite al administrador:
 *   · Panel:       Ver el estado global de pedidos en tiempo real,
 *                  detectar pedidos atascados y errores activos.
 *   · Pedidos:     Buscar cualquier pedido y forzar cambios de estado
 *                  (el "ctrl+z") con registro de motivo para auditoría.
 *   · Herramientas: Configurar el rango de sync con Finnegans,
 *                  forzar sync manual, accesos rápidos.
 */

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, limit, where } from "firebase/firestore";
import { Navigate } from "react-router-dom";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { ORDEN_ESTADOS } from "../modules/pedidos/services/agrupaciones";
import { ESTADOS } from "../modules/pedidos/services/estados";
import {
  adminForzarEstado,
  getSyncConfig,
  saveSyncConfig,
  listarOperarios,
} from "../modules/admin/services/adminFS";
import { syncPendientesDeHoy } from "../modules/pedidos/services/syncFinnegans";

// ─────────────────────────────────────────────
//  Constantes visuales
// ─────────────────────────────────────────────

const ESTADO_CFG = {
  PENDIENTE_ASIGNAR: { label: "Pendiente",   color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
  ASIGNADO:          { label: "Asignado",    color: "#7c3aed", bg: "#f5f3ff", border: "#c4b5fd" },
  EN_PREPARACION:    { label: "En prep.",    color: "#0369a1", bg: "#e0f2fe", border: "#7dd3fc" },
  CON_ERROR:         { label: "Con error",   color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
  PREPARADO:         { label: "Preparado",   color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  CONTROLADO:        { label: "Controlado",  color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  DESPACHADO:        { label: "Despachado",  color: "#15803d", bg: "#f0fdf4", border: "#86efac" },
  ANULADO:           { label: "Anulado",     color: "#94a3b8", bg: "#f8fafc", border: "#e2e8f0" },
  CANCELADO:         { label: "Cancelado",   color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
};

// Estados que puede elegir el admin en el dropdown (todos excepto DESPACHADO, que requiere otro flujo)
const ESTADOS_OVERRIDE = [...ORDEN_ESTADOS, "CANCELADO"];

function EstadoBadge({ estado, small }) {
  const cfg = ESTADO_CFG[estado] || { label: estado, color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" };
  return (
    <span style={{
      display: "inline-block",
      padding: small ? "2px 8px" : "3px 10px",
      borderRadius: "999px",
      fontSize: small ? "0.65rem" : "0.72rem",
      fontWeight: 700,
      color: cfg.color,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function formatTsAgo(ts) {
  if (!ts) return "—";
  const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(d)) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

// ─────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────

export default function AdminPanel() {
  const { user, profile } = useAuth();

  // ── Todos los hooks PRIMERO (antes de cualquier return condicional) ──
  const [tab, setTab] = useState("panel");

  // Datos globales
  const [pedidos, setPedidos]     = useState([]);
  const [loadingPed, setLoadingPed] = useState(true);

  // Panel tab
  const [stuckHours, setStuckHours] = useState(6);

  // Pedidos tab
  const [searchQ, setSearchQ]           = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterDeposito, setFilterDeposito] = useState("");
  const [incluirCancelados, setIncluirCancelados] = useState(false);

  // Override modal
  const [selectedP, setSelectedP]         = useState(null);
  const [overrideEstado, setOverrideEstado] = useState("");
  const [overrideMotivo, setOverrideMotivo] = useState("");
  const [overriding, setOverriding]         = useState(false);
  const [overrideMsg, setOverrideMsg]       = useState(null); // { ok, text }

  // Panel ISABELA — pedidos_despachados
  const [despachadosIsabela, setDespachadosIsabela] = useState([]);

  // Herramientas tab
  const [syncConfig, setSyncConfig]     = useState({ diasAtras: 15 });
  const [savingCfg, setSavingCfg]       = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncResult, setSyncResult]     = useState(null);
  const [operarios, setOperarios]       = useState([]);

  // ── Carga de pedidos (últimos 200 por updatedAt) ──
  useEffect(() => {
    const q = query(collection(db, "pedidos"), orderBy("updatedAt", "desc"), limit(200));
    const unsub = onSnapshot(q,
      (snap) => { setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoadingPed(false); },
      (err)  => { console.error("[AdminPanel]", err); setLoadingPed(false); }
    );
    return () => unsub();
  }, []);

  // ── Listener pedidos_despachados ISABELA (para Panel ISABELA) ──
  useEffect(() => {
    const q = query(
      collection(db, "pedidos_despachados"),
      where("deposito", "==", "ISABELA"),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setDespachadosIsabela(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err)  => console.error("[AdminPanel] pedidos_despachados ISABELA:", err)
    );
    return () => unsub();
  }, []);

  // ── Carga de config sync ──
  useEffect(() => {
    getSyncConfig().then(setSyncConfig);
    listarOperarios().then(setOperarios);
  }, []);

  // ── Computed ──

  // Lista de depósitos detectados automáticamente de los datos
  const deposits = useMemo(() =>
    [...new Set(pedidos.map(p => p.deposito).filter(Boolean))].sort()
  , [pedidos]);

  // Base filtrada por depósito — aplica a TODAS las pestañas
  const pedidosBase = useMemo(() => {
    if (!filterDeposito) return pedidos;
    return pedidos.filter(p => p.deposito === filterDeposito);
  }, [pedidos, filterDeposito]);

  const statsByEstado = useMemo(() => {
    const c = {};
    for (const p of pedidosBase) { const e = p.estado || "PENDIENTE_ASIGNAR"; c[e] = (c[e] || 0) + 1; }
    return c;
  }, [pedidosBase]);

  const atascados = useMemo(() => {
    const threshold = stuckHours * 3600 * 1000;
    const ahora = Date.now();
    return pedidosBase.filter(p => {
      if (!p.updatedAt?.seconds) return false;
      if (p.estado === "DESPACHADO" || p.estado === "ANULADO") return false;
      return ahora - p.updatedAt.seconds * 1000 > threshold;
    }).sort((a, b) => (a.updatedAt?.seconds || 0) - (b.updatedAt?.seconds || 0));
  }, [pedidosBase, stuckHours]);

  const pedidosFiltrados = useMemo(() => {
    const nq = searchQ.trim().toLowerCase();
    return pedidosBase.filter(p => {
      if (!incluirCancelados && p.estado === "CANCELADO") return false;
      if (filterEstado && p.estado !== filterEstado) return false;
      if (nq) {
        const num = String(p.numero || p.id || "").toLowerCase();
        const cli = String(p.cliente || "").toLowerCase();
        if (!num.includes(nq) && !cli.includes(nq)) return false;
      }
      return true;
    });
  }, [pedidosBase, searchQ, filterEstado, incluirCancelados]);

  // Stats específicos de ISABELA — combina pedidos (collection principal) + pedidos_despachados
  const isabelaStats = useMemo(() => {
    // Para el panel ISABELA siempre filtramos a ese depósito, independientemente del chip global
    const base = pedidos.filter(p => p.deposito === "ISABELA");
    return {
      pendientePreparar: base.filter(p =>
        ["PENDIENTE_ASIGNAR", "ASIGNADO", "EN_PREPARACION"].includes(p.estado)
      ).length,
      paraDespachar: base.filter(p =>
        ["PREPARADO", "CONTROLADO"].includes(p.estado)
      ).length,
      conError: base.filter(p => p.estado === "CON_ERROR").length,
      // pedidos_despachados: esperando control físico de entrega
      despachados: despachadosIsabela.filter(p => p.necesitaControl !== false).length,
      // pedidos_despachados: control confirmado — ya entregados
      entregados: despachadosIsabela.filter(p => p.necesitaControl === false).length,
      // listas para el panel de atascados (ya filtradas a ISABELA)
      atascadosIsabela: base.filter(p => {
        if (!p.updatedAt?.seconds) return false;
        if (["DESPACHADO", "ANULADO"].includes(p.estado)) return false;
        return Date.now() - p.updatedAt.seconds * 1000 > stuckHours * 3600 * 1000;
      }).sort((a, b) => (a.updatedAt?.seconds || 0) - (b.updatedAt?.seconds || 0)),
    };
  }, [pedidos, despachadosIsabela, stuckHours]);

  // ── Handlers ──

  function abrirOverride(p) {
    setSelectedP(p);
    setOverrideEstado(p.estado || "PENDIENTE_ASIGNAR");
    setOverrideMotivo("");
    setOverrideMsg(null);
  }

  function cerrarOverride() {
    if (overriding) return;
    setSelectedP(null);
    setOverrideMsg(null);
  }

  async function aplicarOverride() {
    if (!selectedP || !overrideMotivo.trim()) return;
    setOverriding(true);
    setOverrideMsg(null);
    try {
      const { estadoAnterior } = await adminForzarEstado(
        selectedP.id, overrideEstado, overrideMotivo, user?.uid
      );
      setOverrideMsg({
        ok: true,
        text: `✓ Cambio aplicado: ${ESTADO_CFG[estadoAnterior]?.label || estadoAnterior} → ${ESTADO_CFG[overrideEstado]?.label || overrideEstado}`,
      });
      // Actualiza la card inline
      setSelectedP(prev => ({ ...prev, estado: overrideEstado }));
    } catch (e) {
      setOverrideMsg({ ok: false, text: "❌ " + e.message });
    } finally {
      setOverriding(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncPendientesDeHoy({ debug: false });
      setSyncResult({ ok: true, text: `Sync completada. Procesados: ${res?.total ?? "—"} pedidos.` });
    } catch (e) {
      setSyncResult({ ok: false, text: "Error en sync: " + e.message });
    } finally {
      setSyncing(false);
    }
  }

  async function guardarSyncConfig() {
    setSavingCfg(true);
    try {
      await saveSyncConfig(syncConfig);
    } catch (e) {
      alert("Error guardando config: " + e.message);
    } finally {
      setSavingCfg(false);
    }
  }

  // Calcula el estado anterior de un pedido a partir de sus timestamps
  function getPrevEstado(p) {
    const ts = p.timestamps || {};
    const current = p.estado;
    let prevState = null;
    let prevTime = -Infinity;
    for (const [estado, timestamp] of Object.entries(ts)) {
      if (estado === current) continue;
      const t = timestamp?.seconds || 0;
      if (t > prevTime) { prevTime = t; prevState = estado; }
    }
    return prevState;
  }

  // ────────────────────────────────────────────
  //  Render: Tab "Panel" — vista ISABELA
  // ────────────────────────────────────────────

  function renderPanelIsabela() {
    const { pendientePreparar, paraDespachar, conError, despachados, entregados, atascadosIsabela } = isabelaStats;

    const kpis = [
      {
        label: "Pendientes de preparar",
        sublabel: "Sin asignar · En prep.",
        value: pendientePreparar,
        icon: "⏳",
        color: "#64748b",
        bg: "#f1f5f9",
        border: "#cbd5e1",
      },
      {
        label: "Para despachar",
        sublabel: "Preparado · Controlado",
        value: paraDespachar,
        icon: "📦",
        color: "#0891b2",
        bg: "#ecfeff",
        border: "#a5f3fc",
      },
      {
        label: "Para entregar",
        sublabel: "Despachado, pendiente control",
        value: despachados,
        icon: "🚚",
        color: "#d97706",
        bg: "#fffbeb",
        border: "#fde68a",
      },
      {
        label: "Entregados",
        sublabel: "Control físico confirmado",
        value: entregados,
        icon: "✅",
        color: "#15803d",
        bg: "#f0fdf4",
        border: "#86efac",
      },
    ];

    return (
      <div>
        {/* Alerta de errores */}
        {conError > 0 && (
          <div
            style={{
              background: "#fef2f2",
              border: "1.5px solid #fca5a5",
              borderRadius: "12px",
              padding: "14px 16px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
            }}
            onClick={() => { setFilterEstado("CON_ERROR"); setTab("pedidos"); }}
          >
            <span style={{ fontSize: "1.3rem", flexShrink: 0 }}>🔴</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "#dc2626" }}>
                {conError} pedido{conError !== 1 ? "s" : ""} con error en ISABELA
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#ef4444" }}>
                Tocá para ver en la pestaña Pedidos →
              </p>
            </div>
          </div>
        )}

        {/* KPI cards — flujo ISABELA */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {kpis.map(kpi => (
            <div
              key={kpi.label}
              style={{
                background: kpi.bg,
                border: `1.5px solid ${kpi.border}`,
                borderRadius: "14px",
                padding: "18px 18px 16px",
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {kpi.icon} {kpi.label}
              </p>
              <p style={{ margin: "0 0 6px", fontSize: "2rem", fontWeight: 800, color: kpi.color, lineHeight: 1 }}>
                {loadingPed ? "…" : kpi.value}
              </p>
              <p style={{ margin: 0, fontSize: "0.68rem", color: "#94a3b8" }}>{kpi.sublabel}</p>
            </div>
          ))}
        </div>

        {/* Flujo visual ISABELA */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "18px", marginBottom: "20px" }}>
          <p style={{ margin: "0 0 14px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Flujo ISABELA · estado actual
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0" }}>
            {[
              { label: "Preparar",      value: pendientePreparar, color: "#64748b" },
              { label: "Despachar",     value: paraDespachar,     color: "#0891b2" },
              { label: "Para entregar", value: despachados,       color: "#d97706" },
              { label: "Entregados",    value: entregados,        color: "#15803d" },
            ].map((step, i, arr) => (
              <div key={step.label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                <div style={{
                  flex: 1,
                  background: step.value > 0 ? step.color : "#e2e8f0",
                  borderRadius: i === 0 ? "8px 0 0 8px" : i === arr.length - 1 ? "0 8px 8px 0" : "0",
                  padding: "10px 8px",
                  textAlign: "center",
                  transition: "background 0.2s",
                }}>
                  <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: step.value > 0 ? "#fff" : "#94a3b8" }}>
                    {step.value}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: "0.65rem", fontWeight: 600, color: step.value > 0 ? "rgba(255,255,255,0.85)" : "#94a3b8", textTransform: "uppercase" }}>
                    {step.label}
                  </p>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ width: "20px", height: "8px", background: "#e2e8f0", position: "relative", flexShrink: 0 }}>
                    <div style={{ position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "0.7rem" }}>▶</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Pedidos atascados ISABELA */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
            <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1 }}>
              ⚠️ Pedidos ISABELA atascados (sin cambio de estado)
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label style={{ fontSize: "0.75rem", color: "#64748b", whiteSpace: "nowrap" }}>Umbral:</label>
              <select
                value={stuckHours}
                onChange={e => setStuckHours(Number(e.target.value))}
                style={{ padding: "4px 8px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "0.78rem", color: "#0f172a", background: "#f8fafc" }}
              >
                {[2, 4, 6, 8, 12, 24].map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          </div>

          {atascadosIsabela.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", color: "#94a3b8" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>✅ Sin pedidos atascados en ISABELA (umbral {stuckHours}h)</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {atascadosIsabela.slice(0, 15).map(p => (
                <div
                  key={p.id}
                  onClick={() => { abrirOverride(p); setTab("pedidos"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 12px", borderRadius: "10px",
                    background: "#fff7ed", border: "1px solid #fed7aa",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#9a3412", flexShrink: 0 }}>
                    #{p.numero || p.id}
                  </span>
                  <span style={{ flex: 1, fontSize: "0.82rem", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.cliente || "—"}
                  </span>
                  <EstadoBadge estado={p.estado} small />
                  <span style={{ fontSize: "0.72rem", color: "#ea580c", flexShrink: 0, fontWeight: 600 }}>
                    {formatTsAgo(p.updatedAt)}
                  </span>
                </div>
              ))}
              {atascadosIsabela.length > 15 && (
                <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#94a3b8", textAlign: "center" }}>
                  + {atascadosIsabela.length - 15} más — usá la pestaña Pedidos para ver todos
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  Render: Tab "Panel"
  // ────────────────────────────────────────────

  function renderPanel() {
    // Vista adaptada cuando se selecciona ISABELA
    if (filterDeposito === "ISABELA") return renderPanelIsabela();

    const conError = statsByEstado["CON_ERROR"] || 0;
    const controlados = statsByEstado["CONTROLADO"] || 0;
    const enPrep = statsByEstado["EN_PREPARACION"] || 0;
    const pendientes = statsByEstado["PENDIENTE_ASIGNAR"] || 0;

    return (
      <div>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {[
            { label: "Con error",        value: conError,    color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
            { label: "Listos despachar", value: controlados, color: "#0891b2", bg: "#ecfeff", icon: "📦" },
            { label: "En preparación",   value: enPrep,      color: "#0369a1", bg: "#e0f2fe", icon: "⚙️"  },
            { label: "Pendientes",       value: pendientes,  color: "#64748b", bg: "#f1f5f9", icon: "⏳" },
          ].map(kpi => (
            <div key={kpi.label} style={{
              background: kpi.bg,
              border: `1.5px solid ${ESTADO_CFG[Object.keys(ESTADO_CFG).find(k => ESTADO_CFG[k].bg === kpi.bg)]?.border || "#e2e8f0"}`,
              borderRadius: "14px",
              padding: "16px 18px",
            }}>
              <p style={{ margin: "0 0 4px", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {kpi.icon} {kpi.label}
              </p>
              <p style={{ margin: 0, fontSize: "2rem", fontWeight: 800, color: kpi.color, lineHeight: 1 }}>
                {loadingPed ? "…" : kpi.value}
              </p>
            </div>
          ))}
        </div>

        {/* Distribución por estado */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "18px", marginBottom: "20px" }}>
          <p style={{ margin: "0 0 14px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Estado actual · {filterDeposito || "todos los depósitos"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {ORDEN_ESTADOS.map(est => {
              const cnt = statsByEstado[est] || 0;
              const cfg = ESTADO_CFG[est] || {};
              const total = pedidos.length || 1;
              const pct = Math.round((cnt / total) * 100);
              return (
                <div key={est} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ width: "90px", fontSize: "0.75rem", fontWeight: 600, color: cfg.color, flexShrink: 0 }}>
                    {cfg.label}
                  </span>
                  <div style={{ flex: 1, height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: cfg.color, borderRadius: "4px", transition: "width 0.3s ease" }} />
                  </div>
                  <span style={{ width: "32px", textAlign: "right", fontSize: "0.78rem", fontWeight: 700, color: cfg.color, flexShrink: 0 }}>
                    {cnt}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", color: "#94a3b8" }}>
            Total visible: {pedidos.length} pedidos (últimos 200 por fecha de actualización)
          </p>
        </div>

        {/* Pedidos atascados */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
            <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1 }}>
              ⚠️ Pedidos atascados (sin cambio de estado)
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label style={{ fontSize: "0.75rem", color: "#64748b", whiteSpace: "nowrap" }}>Umbral:</label>
              <select
                value={stuckHours}
                onChange={e => setStuckHours(Number(e.target.value))}
                style={{ padding: "4px 8px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "0.78rem", color: "#0f172a", background: "#f8fafc" }}
              >
                {[2, 4, 6, 8, 12, 24].map(h => (
                  <option key={h} value={h}>{h}h</option>
                ))}
              </select>
            </div>
          </div>

          {atascados.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", color: "#94a3b8" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>✅ Sin pedidos atascados con umbral de {stuckHours}h</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {atascados.slice(0, 15).map(p => (
                <div
                  key={p.id}
                  onClick={() => { abrirOverride(p); setTab("pedidos"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 12px", borderRadius: "10px",
                    background: "#fff7ed", border: "1px solid #fed7aa",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#9a3412", flexShrink: 0 }}>
                    #{p.numero || p.id}
                  </span>
                  <span style={{ flex: 1, fontSize: "0.82rem", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.cliente || "—"}
                  </span>
                  <EstadoBadge estado={p.estado} small />
                  <span style={{ fontSize: "0.72rem", color: "#ea580c", flexShrink: 0, fontWeight: 600 }}>
                    {formatTsAgo(p.updatedAt)}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>{p.deposito || "—"}</span>
                </div>
              ))}
              {atascados.length > 15 && (
                <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#94a3b8", textAlign: "center" }}>
                  + {atascados.length - 15} más — acotar el umbral o usar la pestaña Pedidos
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  Render: Tab "Pedidos"
  // ────────────────────────────────────────────

  function renderPedidos() {
    return (
      <div>
        {/* Filtros */}
        <div style={{
          background: "#fff",
          border: "1.5px solid #e2e8f0",
          borderRadius: "14px",
          padding: "14px 16px",
          marginBottom: "16px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          alignItems: "center",
        }}>
          <input
            placeholder="🔍 Buscar cliente o #pedido…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            style={{
              flex: 1, minWidth: "200px",
              padding: "9px 12px", borderRadius: "10px",
              border: "1.5px solid #e2e8f0", fontSize: "0.88rem",
              color: "#0f172a", background: "#f8fafc",
            }}
          />
          <select
            value={filterEstado}
            onChange={e => setFilterEstado(e.target.value)}
            style={{ padding: "9px 12px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "0.85rem", color: "#334155", background: "#f8fafc" }}
          >
            <option value="">Todos los estados</option>
            {ORDEN_ESTADOS.map(e => (
              <option key={e} value={e}>{ESTADO_CFG[e]?.label || e}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "#64748b", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={incluirCancelados}
              onChange={e => setIncluirCancelados(e.target.checked)}
              style={{ width: "15px", height: "15px", accentColor: "#6b7280", cursor: "pointer" }}
            />
            Ver cancelados
          </label>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
            {pedidosFiltrados.length} resultado{pedidosFiltrados.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Lista */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "80px 1fr 120px 80px 90px 70px",
            gap: "8px",
            padding: "10px 16px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            fontSize: "0.68rem",
            fontWeight: 700,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}>
            <span>#</span>
            <span>Cliente</span>
            <span>Estado</span>
            <span>Depósito</span>
            <span>Actualizado</span>
            <span>Acción</span>
          </div>

          {loadingPed ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>Cargando…</div>
          ) : pedidosFiltrados.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>Sin resultados</div>
          ) : (
            pedidosFiltrados.slice(0, 100).map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 120px 80px 90px 70px",
                  gap: "8px",
                  padding: "10px 16px",
                  alignItems: "center",
                  borderBottom: i < pedidosFiltrados.length - 1 ? "1px solid #f1f5f9" : "none",
                  background: p.estado === "CON_ERROR" ? "#fff7ed" : "transparent",
                }}
              >
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a" }}>
                  #{p.numero || p.id}
                </span>
                <span style={{ fontSize: "0.85rem", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.cliente || "—"}
                </span>
                <span><EstadoBadge estado={p.estado} small /></span>
                <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{p.deposito || "—"}</span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{formatTsAgo(p.updatedAt)}</span>
                <button
                  type="button"
                  onClick={() => abrirOverride(p)}
                  style={{
                    padding: "5px 10px", borderRadius: "8px",
                    border: "1.5px solid #e2e8f0", background: "#f8fafc",
                    fontSize: "0.72rem", fontWeight: 700, color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Editar
                </button>
              </div>
            ))
          )}
          {pedidosFiltrados.length > 100 && (
            <div style={{ padding: "12px 16px", textAlign: "center", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#94a3b8" }}>
                Mostrando 100 de {pedidosFiltrados.length}. Usá el buscador para acotar.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  Render: Tab "Herramientas"
  // ────────────────────────────────────────────

  function renderHerramientas() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "640px" }}>

        {/* Sync Finnegans */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "20px" }}>
          <p style={{ margin: "0 0 4px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            🔄 Sincronización con Finnegans
          </p>
          <p style={{ margin: "0 0 16px", fontSize: "0.82rem", color: "#64748b" }}>
            Configura cuántos días hacia atrás se consultan al sincronizar. Pedidos más viejos que ese rango no se detectarán como nuevos ni como anulados.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#334155", whiteSpace: "nowrap" }}>
              Días hacia atrás:
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={syncConfig.diasAtras ?? 15}
              onChange={e => setSyncConfig(c => ({ ...c, diasAtras: Number(e.target.value) }))}
              style={{
                width: "80px", padding: "8px 12px",
                borderRadius: "10px", border: "1.5px solid #e2e8f0",
                fontSize: "0.9rem", color: "#0f172a",
                textAlign: "center",
              }}
            />
            <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
              (actual: {syncConfig.diasAtras ?? 15} días)
            </span>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={guardarSyncConfig}
              disabled={savingCfg}
              style={{
                flex: 1, padding: "10px", borderRadius: "10px",
                border: "none", background: "#0f172a", color: "#fff",
                fontWeight: 700, fontSize: "0.88rem",
                cursor: savingCfg ? "not-allowed" : "pointer",
                opacity: savingCfg ? 0.7 : 1,
              }}
            >
              {savingCfg ? "Guardando…" : "Guardar configuración"}
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              style={{
                flex: 1, padding: "10px", borderRadius: "10px",
                border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#334155",
                fontWeight: 700, fontSize: "0.88rem",
                cursor: syncing ? "not-allowed" : "pointer",
                opacity: syncing ? 0.7 : 1,
              }}
            >
              {syncing ? "⏳ Sincronizando…" : "🔄 Forzar sync ahora"}
            </button>
          </div>

          {syncResult && (
            <div style={{
              marginTop: "12px", padding: "10px 14px", borderRadius: "10px",
              background: syncResult.ok ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${syncResult.ok ? "#86efac" : "#fca5a5"}`,
              fontSize: "0.82rem", fontWeight: 600,
              color: syncResult.ok ? "#15803d" : "#dc2626",
            }}>
              {syncResult.text}
            </div>
          )}
        </div>

        {/* Accesos rápidos */}
        <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "20px" }}>
          <p style={{ margin: "0 0 14px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            🔗 Accesos rápidos
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              { label: "🗑️ Resetear depósito (testing)", href: "/admin/reset-deposito" },
              { label: "📋 Histórico de despachos",       href: "/ventas/despachados" },
              { label: "⚠️ Errores de preparación",       href: "/encargado/errores" },
            ].map(link => (
              <a
                key={link.href}
                href={link.href}
                style={{
                  display: "block", padding: "12px 14px",
                  borderRadius: "10px", border: "1.5px solid #e2e8f0",
                  fontSize: "0.88rem", fontWeight: 600, color: "#334155",
                  textDecoration: "none", background: "#f8fafc",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
                onMouseLeave={e => e.currentTarget.style.background = "#f8fafc"}
              >
                {link.label} →
              </a>
            ))}
          </div>
        </div>

        {/* Info del admin */}
        <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#94a3b8" }}>
            Admin: <strong>{user?.email || "—"}</strong> · Sesión activa
          </p>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  Modal de override
  // ────────────────────────────────────────────

  function renderOverrideModal() {
    if (!selectedP) return null;
    const prevEstado = getPrevEstado(selectedP);
    const cfgActual = ESTADO_CFG[selectedP.estado] || {};
    const hayCambio = overrideEstado !== selectedP.estado;

    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        onClick={cerrarOverride}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: "#fff",
            borderRadius: "20px",
            padding: "24px",
            width: "100%", maxWidth: "520px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
            maxHeight: "90vh",
            overflowY: "auto",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px" }}>
            <div>
              <p style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
                Override de estado
              </p>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#0f172a" }}>
                Pedido #{selectedP.numero || selectedP.id}
              </h2>
            </div>
            <button
              onClick={cerrarOverride}
              style={{ background: "none", border: "none", fontSize: "1.3rem", color: "#94a3b8", cursor: "pointer", padding: "4px" }}
            >
              ✕
            </button>
          </div>

          {/* Info pedido */}
          <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "12px 14px", marginBottom: "16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>
              {selectedP.cliente || "—"}
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <EstadoBadge estado={selectedP.estado} />
              {selectedP.deposito && (
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>📍 {selectedP.deposito}</span>
              )}
              {selectedP.metodoEntrega && (
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>🚚 {selectedP.metodoEntrega}</span>
              )}
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>act. {formatTsAgo(selectedP.updatedAt)}</span>
            </div>
          </div>

          {/* Acciones rápidas */}
          {(selectedP.estado === "CON_ERROR" || prevEstado) && (
            <div style={{ marginBottom: "14px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {selectedP.estado === "CON_ERROR" && (
                <button
                  type="button"
                  onClick={() => setOverrideEstado("PENDIENTE_ASIGNAR")}
                  style={{
                    padding: "6px 12px", borderRadius: "8px",
                    border: overrideEstado === "PENDIENTE_ASIGNAR" ? "2px solid #0f172a" : "1.5px solid #e2e8f0",
                    background: overrideEstado === "PENDIENTE_ASIGNAR" ? "#0f172a" : "#f8fafc",
                    color: overrideEstado === "PENDIENTE_ASIGNAR" ? "#fff" : "#475569",
                    fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  🔄 Limpiar error → Pendiente
                </button>
              )}
              {prevEstado && prevEstado !== selectedP.estado && (
                <button
                  type="button"
                  onClick={() => setOverrideEstado(prevEstado)}
                  style={{
                    padding: "6px 12px", borderRadius: "8px",
                    border: overrideEstado === prevEstado ? "2px solid #0f172a" : "1.5px solid #e2e8f0",
                    background: overrideEstado === prevEstado ? "#0f172a" : "#f8fafc",
                    color: overrideEstado === prevEstado ? "#fff" : "#475569",
                    fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  ↩ Volver a {ESTADO_CFG[prevEstado]?.label || prevEstado}
                </button>
              )}
            </div>
          )}

          {/* Selector de estado */}
          <div style={{ marginBottom: "14px" }}>
            <p style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Nuevo estado
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ESTADOS_OVERRIDE.map(e => {
                const cfg = ESTADO_CFG[e] || {};
                const active = overrideEstado === e;
                const isCurrent = selectedP.estado === e;
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setOverrideEstado(e)}
                    style={{
                      padding: "5px 11px", borderRadius: "8px",
                      border: active ? `2px solid ${cfg.color}` : `1.5px solid ${cfg.border || "#e2e8f0"}`,
                      background: active ? cfg.bg : "#fafafa",
                      color: active ? cfg.color : "#64748b",
                      fontSize: "0.75rem", fontWeight: active ? 800 : 600,
                      cursor: "pointer", position: "relative",
                    }}
                  >
                    {cfg.label || e}
                    {isCurrent && (
                      <span style={{ position: "absolute", top: "-6px", right: "-4px", fontSize: "0.55rem", background: "#0f172a", color: "#fff", padding: "1px 4px", borderRadius: "4px" }}>
                        actual
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Motivo */}
          <div style={{ marginBottom: "16px" }}>
            <p style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Motivo del cambio <span style={{ color: "#ef4444" }}>*</span>
            </p>
            <textarea
              value={overrideMotivo}
              onChange={e => setOverrideMotivo(e.target.value)}
              placeholder="Ej: El operario marcó como preparado por error. Se revierte para re-preparar."
              rows={3}
              style={{
                width: "100%", padding: "10px 12px", boxSizing: "border-box",
                borderRadius: "10px", border: "1.5px solid #e2e8f0",
                fontSize: "0.85rem", resize: "none", color: "#0f172a",
                fontFamily: "inherit",
              }}
            />
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94a3b8" }}>
              Obligatorio. Queda registrado en el pedido para auditoría.
            </p>
          </div>

          {/* Resultado */}
          {overrideMsg && (
            <div style={{
              marginBottom: "14px", padding: "10px 14px", borderRadius: "10px",
              background: overrideMsg.ok ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${overrideMsg.ok ? "#86efac" : "#fca5a5"}`,
              fontSize: "0.85rem", fontWeight: 600,
              color: overrideMsg.ok ? "#15803d" : "#dc2626",
            }}>
              {overrideMsg.text}
            </div>
          )}

          {/* Botones */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={cerrarOverride}
              style={{
                flex: 1, padding: "11px", borderRadius: "10px",
                border: "1.5px solid #e2e8f0", background: "#f8fafc",
                color: "#475569", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={aplicarOverride}
              disabled={overriding || !overrideMotivo.trim() || !hayCambio}
              style={{
                flex: 2, padding: "11px", borderRadius: "10px",
                border: "none", background: "#0f172a", color: "#fff",
                fontWeight: 700, fontSize: "0.88rem",
                cursor: (overriding || !overrideMotivo.trim() || !hayCambio) ? "not-allowed" : "pointer",
                opacity: (overriding || !overrideMotivo.trim() || !hayCambio) ? 0.6 : 1,
              }}
            >
              {overriding ? "Aplicando…" : "Aplicar cambio"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  //  Render principal
  // ────────────────────────────────────────────

  // Guardia: solo admin (después de todos los hooks)
  if (profile && profile.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const TABS = [
    { id: "panel",       label: "📊 Panel"       },
    { id: "pedidos",     label: "📦 Pedidos"     },
    { id: "herramientas",label: "🔧 Herramientas"},
  ];

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px 0",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
            <a
              href="/inicio"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "34px", height: "34px", flexShrink: 0,
                background: "#f8fafc", border: "1px solid #e2e8f0",
                borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
              }}
            >
              ←
            </a>
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#0f172a" }}>
                Panel de administración
              </h1>
            </div>
            {!loadingPed && (statsByEstado["CON_ERROR"] || 0) > 0 && (
              <span style={{ background: "#dc2626", color: "#fff", fontSize: "0.72rem", fontWeight: 700, padding: "4px 12px", borderRadius: "999px" }}>
                {statsByEstado["CON_ERROR"]} errores activos
              </span>
            )}
          </div>

          {/* Tabs + filtro de depósito en la misma fila */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "0" }}>
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: "10px 18px",
                    border: "none",
                    borderBottom: tab === t.id ? "3px solid #0f172a" : "3px solid transparent",
                    background: "none",
                    fontSize: "0.85rem",
                    fontWeight: tab === t.id ? 700 : 500,
                    color: tab === t.id ? "#0f172a" : "#94a3b8",
                    cursor: "pointer",
                    transition: "color 0.1s",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Chips de depósito — filtro global */}
            <div style={{ display: "flex", gap: "6px", paddingBottom: "8px" }}>
              {["", ...deposits].map(dep => {
                const active = filterDeposito === dep;
                return (
                  <button
                    key={dep || "__todos__"}
                    type="button"
                    onClick={() => setFilterDeposito(dep)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: "999px",
                      border: active ? "2px solid #0f172a" : "1.5px solid #e2e8f0",
                      background: active ? "#0f172a" : "#f8fafc",
                      color: active ? "#fff" : "#475569",
                      fontSize: "0.78rem",
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.12s",
                    }}
                  >
                    {dep || "Todos"}
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Contenido */}
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "24px" }}>
        {tab === "panel"        && renderPanel()}
        {tab === "pedidos"      && renderPedidos()}
        {tab === "herramientas" && renderHerramientas()}
      </div>

      {/* Override modal */}
      {renderOverrideModal()}
    </div>
  );
}
