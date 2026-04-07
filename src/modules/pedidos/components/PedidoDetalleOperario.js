import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { getPedido } from "../services/pedidosFS";
import { cambiarEstado, ESTADOS } from "../services/estados";
import { getFlag } from "../services/featureFlags";
import QrScanner from "../../../components/QrScanner";
import { getCatalogoByCodUru } from "../services/catalogo";
import { getStockTiras, confirmarPedidoConStock } from "../services/stockTiras";
import { db } from "../../../firebase";
import { doc, updateDoc } from "firebase/firestore";

import PackConfirmModal from "./PackConfirmModal";
import PackErrorModal from "./PackErrorModal";
import Modal from "./Modal";
import VolverListaPedidos from "./VolverListaPedidos";

// ============== Helpers ==============
function toURUCode(value) {
  const s = String(value ?? "").trim();
  const mNum = s.match(/\b\d{7,}\b/);
  if (mNum) return mNum[0];
  return s.split(/\s+/)[0].replace(/[^\w-]/g, "");
}
function toCustomerNo(uru) {
  return String(uru || "").trim() || "—";
}
function reqQty(it) {
  return it.cant ?? it.cantidad ?? it.qty ?? 0;
}
function keyFor(it, i) {
  return `${(it.cod || it.codigo || it.codigoURU || "IDX")}-${i}`;
}

// Nombre legible del producto: usa descripcion del item o fallback a customerNo del catálogo
function getNombreProducto(it, cat) {
  const desc = it.descripcion || it.desc || it.nombre || "";
  if (desc) return desc;
  return cat?.customerNo || cat?.customer_no || it.cod || it.codigo || it.codigoURU || "Producto";
}

// ============== Pantalla ==============
export default function PedidoDetalleOperario() {
  const { id: rawId } = useParams();
  const pedidoId = useMemo(() => decodeURIComponent(rawId || ""), [rawId]);
  const { toast, haptics } = useApp();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [pedido, setPedido]         = useState(null);
  const [lite, setLite]             = useState(true);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [autoStarting, setAutoStarting] = useState(false);
  const autoStartedRef = useRef(false);

  const [prep, setPrep]             = useState({});
  const [catalogoMap, setCatalogoMap] = useState({});
  const [checks, setChecks]         = useState({});

  // overlay (solo modo escáner)
  const [scanForKey, setScanForKey]   = useState(null);
  const [packConfirm, setPackConfirm] = useState(null);
  const [packError, setPackError]     = useState(null);

  // ===== Carga inicial =====
  useEffect(() => {
    (async () => {
      if (!pedidoId) return;
      setLoading(true);
      try {
        const p = await getPedido(pedidoId);
        setPedido(p || null);
      } catch (e) {
        console.error("[Operario] error cargando pedido:", e);
        setPedido(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [pedidoId]);

  useEffect(() => { (async () => setLite(await getFlag("MODO_LITE")))(); }, []);

  // Catálogo para enriquecer nombres (best-effort)
  useEffect(() => {
    if (!pedido?.productos || !Array.isArray(pedido.productos)) return;
    const codigosURU = Array.from(new Set(
      pedido.productos
        .map(p => p.cod || p.codigo || p.codigoURU || p.desc || p.descripcion || p.nombre)
        .filter(Boolean).map(toURUCode).filter(Boolean)
    ));
    if (codigosURU.length === 0) { setCatalogoMap({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          codigosURU.map(async (uru) => [uru, (await getCatalogoByCodUru(uru)) || null])
        );
        if (!cancelled) setCatalogoMap(Object.fromEntries(entries));
      } catch (e) { console.error("[Operario] catálogo error", e?.code || e); }
    })();
    return () => { cancelled = true; };
  }, [pedido?.productos]);

  // Stock para modo escáner
  useEffect(() => {
    if (lite) return; // no hace falta en modo lite
    let cancel = false;
    (async () => {
      if (!pedido?.productos) return;
      const next = {};
      for (let i = 0; i < pedido.productos.length; i++) {
        const it = pedido.productos[i];
        const raw = it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || it.nombre || "";
        const uru = toURUCode(raw);
        if (!uru) continue;
        const stock = await getStockTiras(uru).catch(() => 0);
        next[keyFor(it, i)] = { stock, usarSueltas: 0, paquete: null, usarDePaquete: 0 };
      }
      if (!cancel) setPrep(next);
    })();
    return () => { cancel = true; };
  }, [pedido?.productos, lite]);

  // Auto-transición ASIGNADO → EN_PREPARACION
  useEffect(() => {
    if (!pedido || !user?.uid) return;
    if (pedido.estado !== ESTADOS.ASIGNADO) return;
    if (pedido.operarioId !== user.uid) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    setAutoStarting(true);
    (async () => {
      try {
        await cambiarEstado(pedidoId, ESTADOS.EN_PREPARACION);
        const p = await getPedido(pedidoId);
        setPedido(p);
      } catch (e) {
        console.error("[Operario] auto-transition error:", e);
        toast?.error?.("No se pudo iniciar la preparación. Intentá de nuevo.");
        autoStartedRef.current = false;
      } finally {
        setAutoStarting(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.estado, pedido?.operarioId, user?.uid]);

  // Redirect al completarse
  useEffect(() => {
    if (pedido?.estado === ESTADOS.PREPARADO) {
      setTimeout(() => navigate("/operario/asignados"), 1800);
    }
  }, [pedido?.estado, navigate]);

  // ===== LITE: productos — todos los del pedido =====
  const productosLite = useMemo(() => pedido?.productos || [], [pedido?.productos]);
  const totalProductos = productosLite.length;
  const checkedCount = productosLite.filter((it, i) => !!checks[keyFor(it, i)]).length;
  const allChecked = totalProductos > 0 && checkedCount === totalProductos;
  const progreso = totalProductos > 0 ? Math.round((checkedCount / totalProductos) * 100) : 0;

  // ===== Escáner: productos filtrados por categoría =====
  const productosOperario = useMemo(() => {
    const CAT_OPERARIO = ["PERFIL ALUMINIO", "KITS"];
    return (pedido?.productos || []).filter((it) => {
      const raw = it.cod || it.descripcion || it.desc || "";
      const uru = toURUCode(raw);
      const cat = (catalogoMap?.[uru]?.categoria || "").toUpperCase().trim();
      return CAT_OPERARIO.includes(cat);
    });
  }, [pedido?.productos, catalogoMap]);

  // ===== Helpers escáner =====
  function getItemInfoByKey(k) {
    if (!pedido?.productos) return null;
    const idx = Number(String(k).split("-").pop());
    const it = pedido.productos[idx];
    if (!it) return null;
    const need = reqQty(it);
    const raw = it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || it.nombre || "";
    const uruExpected = toURUCode(raw);
    return { it, idx, need, uruExpected };
  }

  function getRemainingForKey(k) {
    const info = getItemInfoByKey(k);
    if (!info) return 0;
    const p = prep[k] || {};
    return Math.max(0, info.need - Number(p.usarSueltas || 0) - Number(p.usarDePaquete || 0));
  }

  function clampPrepForNeed(k, draft) {
    const p = { ...(prep[k] || {}), ...draft };
    const info = getItemInfoByKey(k);
    if (!info) return p;
    const { need } = info;
    const stock = Number(p.stock || 0);
    const packSize = Number(p.paquete?.packSize || 0);
    let usarSueltas = Math.min(Number(p.usarSueltas || 0), stock);
    let usarDePaquete = Math.min(Number(p.usarDePaquete || 0), packSize);
    const total = usarSueltas + usarDePaquete;
    if (total > need) {
      const exceso = total - need;
      if (usarDePaquete >= exceso) usarDePaquete -= exceso;
      else usarSueltas = Math.max(0, usarSueltas - (exceso - usarDePaquete));
    }
    return { ...p, usarSueltas, usarDePaquete };
  }

  function onScanPaquete(payload) {
    try {
      if (!scanForKey) return;
      const info = getItemInfoByKey(scanForKey);
      if (!info) { toast?.error?.("No se encontró el producto seleccionado"); return; }
      const { uruExpected } = info;
      const codUruQR = toURUCode(payload.codUru || payload.codigo_urualum || payload.codigo || "");
      const packSize = Number(payload.packSize || payload.cantidad || 0);
      if (!codUruQR || !packSize) { toast?.error?.("QR inválido: faltan datos"); return; }
      if (codUruQR !== uruExpected) {
        setPackError({ esperado: uruExpected, qr: codUruQR });
        return;
      }
      const remaining = getRemainingForKey(scanForKey);
      const defaultQty = Math.min(remaining, packSize);
      const nombre = catalogoMap?.[uruExpected]?.customerNo || toCustomerNo(uruExpected);
      setPackConfirm({ key: scanForKey, nombre, packSize, remaining, defaultQty });
      setScanForKey(null);
    } catch (e) {
      console.error(e);
      toast?.error?.("No se pudo procesar el QR");
    }
  }

  // ===== Acciones =====
  function toggleCheck(k) { setChecks(prev => ({ ...prev, [k]: !prev[k] })); }

  function marcarTodo() {
    const next = {};
    productosLite.forEach((it, i) => { next[keyFor(it, i)] = true; });
    setChecks(next);
  }

  async function finalizarPreparacion() {
    if (saving) return;
    try {
      setSaving(true);
      await updateDoc(doc(db, "pedidos", pedido.id || pedidoId), { prepPerfilesOk: true });
      await cambiarEstado(pedidoId, ESTADOS.PREPARADO);
      haptics?.success?.();
      toast?.success?.("¡Pedido preparado!");
      const p = await getPedido(pedidoId);
      setPedido(p);
    } catch (e) {
      console.error(e);
      toast?.error?.(e.message || "No se pudo confirmar la preparación");
    } finally {
      setSaving(false);
    }
  }

  // ===== Estados de carga/acceso =====
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Cargando pedido…</p>
    </div>
  );
  if (!pedido) return (
    <div style={{ padding: "24px", textAlign: "center" }}>
      <p style={{ color: "#ef4444" }}>Pedido no encontrado.</p>
    </div>
  );
  if (pedido.operarioId && pedido.operarioId !== user?.uid) return (
    <div style={{ padding: "24px", textAlign: "center" }}>
      <p style={{ color: "#ef4444" }}>No tenés acceso a este pedido.</p>
    </div>
  );

  // ===== RENDER =====
  const overlayOpen = !!(scanForKey || packError || packConfirm);

  // Estado: pedido completado
  if (pedido.estado === ESTADOS.PREPARADO) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "80vh", padding: "24px", textAlign: "center", gap: "16px"
      }}>
        <div style={{ fontSize: "4rem", lineHeight: 1 }}>✅</div>
        <h2 style={{ fontWeight: 700, fontSize: "1.4rem", margin: 0 }}>¡Pedido preparado!</h2>
        <p style={{ color: "#64748b", margin: 0 }}>Volviendo a tus pedidos…</p>
      </div>
    );
  }

  // Estado: iniciando
  if (pedido.estado === ESTADOS.ASIGNADO || autoStarting) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "80vh", padding: "24px", textAlign: "center", gap: "12px"
      }}>
        <div style={{ fontSize: "2rem" }}>⏳</div>
        <p style={{ color: "#64748b" }}>Iniciando preparación…</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* ── Header ─────────────────────────────── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px" }}>
        <VolverListaPedidos to="/operario/asignados" />
        <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Pedido #{pedido.numero}
            </p>
            <h1 style={{ margin: "2px 0 0", fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
              {pedido.cliente}
            </h1>
          </div>
          <span style={{
            flexShrink: 0,
            background: "#fef9c3", color: "#854d0e",
            fontSize: "0.7rem", fontWeight: 700,
            padding: "3px 10px", borderRadius: "999px",
            letterSpacing: "0.04em", marginTop: "4px"
          }}>
            EN PREPARACIÓN
          </span>
        </div>
        {(pedido.metodoPedido || pedido.deposito) && (
          <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#94a3b8" }}>
            {[pedido.metodoPedido, pedido.deposito].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* ── Progreso ────────────────────────────── */}
      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "0.82rem", color: "#475569", fontWeight: 600 }}>
            {checkedCount === totalProductos && totalProductos > 0
              ? "Todos los productos cargados"
              : `${checkedCount} de ${totalProductos} productos cargados`}
          </span>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: checkedCount === totalProductos ? "#16a34a" : "#475569" }}>
            {progreso}%
          </span>
        </div>
        <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "999px", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: "999px",
            background: checkedCount === totalProductos ? "#16a34a" : "#3b82f6",
            width: `${progreso}%`,
            transition: "width 0.3s ease, background 0.3s ease"
          }} />
        </div>
      </div>

      {/* ── Lista de productos ───────────────────── */}
      {lite ? (
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {totalProductos === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "#94a3b8" }}>
              <p style={{ margin: 0 }}>No hay productos en este pedido.</p>
            </div>
          ) : (
            productosLite.map((it, i) => {
              const k = keyFor(it, i);
              const cargado = !!checks[k];
              const qty = reqQty(it);
              const raw = it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || it.nombre || "";
              const uru = toURUCode(raw);
              const cat = catalogoMap[uru] || {};
              const nombre = getNombreProducto(it, cat);
              const color = cat?.finish || cat?.color || "";

              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleCheck(k)}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px",
                    width: "100%", textAlign: "left",
                    background: cargado ? "#f0fdf4" : "#fff",
                    border: `1.5px solid ${cargado ? "#86efac" : "#e2e8f0"}`,
                    borderRadius: "14px",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    boxShadow: cargado ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  {/* Indicador check */}
                  <div style={{
                    flexShrink: 0,
                    width: "28px", height: "28px",
                    borderRadius: "50%",
                    border: `2px solid ${cargado ? "#16a34a" : "#cbd5e1"}`,
                    background: cargado ? "#16a34a" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s ease",
                  }}>
                    {cargado && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7L5.5 10L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>

                  {/* Info producto */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0,
                      fontSize: "0.9rem",
                      fontWeight: 600,
                      color: cargado ? "#15803d" : "#1e293b",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: cargado ? "line-through" : "none",
                    }}>
                      {nombre}
                    </p>
                    {color && (
                      <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>{color}</p>
                    )}
                  </div>

                  {/* Cantidad */}
                  <div style={{
                    flexShrink: 0,
                    background: cargado ? "#dcfce7" : "#f1f5f9",
                    color: cargado ? "#15803d" : "#475569",
                    fontWeight: 700, fontSize: "0.85rem",
                    padding: "4px 10px", borderRadius: "8px",
                  }}>
                    ×{qty}
                  </div>
                </button>
              );
            })
          )}

          {/* Marcar todo (solo si quedan pendientes) */}
          {totalProductos > 0 && !allChecked && (
            <button
              type="button"
              onClick={marcarTodo}
              style={{
                width: "100%", padding: "10px",
                background: "transparent", border: "1.5px dashed #cbd5e1",
                borderRadius: "12px", color: "#64748b",
                fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              Marcar todos como cargados
            </button>
          )}
        </div>
      ) : (
        /* ── Modo escáner (sin cambios) ── */
        <div style={{ padding: "12px 16px" }}>
          <div className="space-y-2">
            {productosOperario.map((it, i) => {
              const k = keyFor(it, i);
              const need = reqQty(it);
              const raw = it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || it.nombre || "";
              const uru = toURUCode(raw);
              const cat = catalogoMap[uru] || {};
              const customer = cat?.customerNo || cat?.customer_no || "—";
              const color = cat?.finish || cat?.color || "—";
              const p = prep[k] || { stock: 0, usarSueltas: 0, paquete: null, usarDePaquete: 0 };
              const usados = (p.usarSueltas || 0) + (p.usarDePaquete || 0);
              const ok = usados >= need && need > 0;

              const setP = (changes) =>
                setPrep(prev => ({ ...prev, [k]: { ...(prev[k] || {}), ...changes } }));

              return (
                <div key={k} className="card product-card">
                  <div className="product-card__head">
                    <div className="product-card__title">
                      <span className="product-card__sku">{customer}</span>
                      <span className="product-card__color">{color}</span>
                    </div>
                    <div className="product-card__chips">
                      <span className="chip chip--muted">Req: {need}</span>
                      <span className={`chip ${ok ? "chip--ok" : ""}`}>Usado: {usados}</span>
                    </div>
                  </div>
                  <div className="product-card__meta">
                    <span className="meta-pill">Sueltas: <strong>{Number(p.stock || 0)}</strong></span>
                    <span className="meta-pill">Pack: <strong>{p.paquete?.packSize ? `x${p.paquete.packSize}` : "—"}</strong></span>
                  </div>
                  <div className="qty-row">
                    <span className="qty-row__label">Sueltas</span>
                    <div className="qty">
                      <button type="button" className="qty__btn"
                        onClick={() => setPrep(prev => ({ ...prev, [k]: clampPrepForNeed(k, { usarSueltas: Math.max(0, Number((prev[k] || {}).usarSueltas || 0) - 1) }) }))}
                        disabled={Number(p.usarSueltas || 0) <= 0}>−</button>
                      <span className="qty__val">{Number(p.usarSueltas || 0)}</span>
                      <button type="button" className="qty__btn"
                        onClick={() => setPrep(prev => { const cur = prev[k] || {}; const usedNow = Number(cur.usarSueltas || 0) + Number(cur.usarDePaquete || 0); const remaining = Math.max(0, need - usedNow); const stockLeft = Number(cur.stock || 0) - Number(cur.usarSueltas || 0); const step = Math.min(remaining, stockLeft); return { ...prev, [k]: clampPrepForNeed(k, { usarSueltas: Number(cur.usarSueltas || 0) + (step > 0 ? 1 : 0) }) }; })}
                        disabled={(() => { const usedNow = Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0); const remaining = Math.max(0, need - usedNow); const stockLeft = Number(p.stock || 0) - Number(p.usarSueltas || 0); return remaining <= 0 || stockLeft <= 0; })()}>+</button>
                    </div>
                  </div>
                  {p.paquete ? (
                    <div className="qty-row">
                      <span className="qty-row__label">Paquete</span>
                      <div className="qty">
                        <button type="button" className="qty__btn"
                          onClick={() => setPrep(prev => { const cur = prev[k] || {}; return { ...prev, [k]: { ...cur, usarDePaquete: Math.max(0, Number(cur.usarDePaquete || 0) - 1) } }; })}
                          disabled={Number(p.usarDePaquete || 0) <= 0}>−</button>
                        <span className="qty__val">{Number(p.usarDePaquete || 0)}</span>
                        <button type="button" className="qty__btn"
                          onClick={() => setPrep(prev => { const cur = prev[k] || {}; const usedNow = Number(cur.usarSueltas || 0) + Number(cur.usarDePaquete || 0); const remaining = Math.max(0, need - usedNow); const packSize = Number(cur.paquete?.packSize || 0); const roomInPack = Math.max(0, packSize - Number(cur.usarDePaquete || 0)); const stepAllowed = Math.min(remaining, roomInPack); return { ...prev, [k]: { ...cur, usarDePaquete: Number(cur.usarDePaquete || 0) + (stepAllowed > 0 ? 1 : 0) } }; })}
                          disabled={(() => { const usedNow = Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0); const remaining = Math.max(0, need - usedNow); const packSize = Number(p.paquete?.packSize || 0); const roomInPack = Math.max(0, packSize - Number(p.usarDePaquete || 0)); return remaining <= 0 || roomInPack <= 0; })()}>+</button>
                      </div>
                    </div>
                  ) : (
                    <div className="qty-row qty-row--hint">
                      <span className="qty-row__label">Paquete</span>
                      <span className="hint">—</span>
                    </div>
                  )}
                  <button type="button" className="btn btn--secondary btn--full mt-2"
                    onClick={() => setScanForKey(String(k))}>
                    Escanear paquete
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button"
            className="btn w-full bg-black text-white disabled:opacity-60"
            style={{ marginTop: "16px" }}
            onClick={finalizarPreparacion}
            disabled={saving || !(pedido?.productos || []).every((it, i) => {
              const k = keyFor(it, i);
              const p = prep[k] || {};
              return (Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0)) >= reqQty(it);
            })}>
            {saving ? "Guardando…" : "Finalizar preparación"}
          </button>
        </div>
      )}

      {/* ── CTA fijo abajo (solo modo lite) ────── */}
      {lite && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          padding: "12px 16px 20px",
          background: "#fff",
          borderTop: "1px solid #e2e8f0",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
        }}>
          <button
            type="button"
            onClick={finalizarPreparacion}
            disabled={!allChecked || saving}
            style={{
              width: "100%",
              padding: "15px",
              borderRadius: "14px",
              border: "none",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: allChecked ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
              background: allChecked ? "#16a34a" : "#e2e8f0",
              color: allChecked ? "#fff" : "#94a3b8",
            }}
          >
            {saving
              ? "Guardando…"
              : allChecked
              ? "✓ Marcar pedido como preparado"
              : `Faltan ${totalProductos - checkedCount} producto${totalProductos - checkedCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* ── Overlay escáner (solo modo completo) ── */}
      {!lite && overlayOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.62)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
        }}>
          <div className="card" style={{
            width: "100%", maxWidth: 420, maxHeight: "92vh", overflow: "auto",
            background: "#fff", borderRadius: 12,
            boxShadow: "0 20px 50px rgba(0,0,0,.35)",
          }}>
            <div className="subsection-title" style={{ position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
              <span>{scanForKey ? "Escanear paquete" : packError ? "Paquete incorrecto" : "Confirmar paquete"}</span>
              <button type="button" className="btn btn--ghost"
                onClick={() => { setScanForKey(null); setPackError(null); setPackConfirm(null); }}>
                Cerrar
              </button>
            </div>
            <div className="p-3">
              {scanForKey && !packConfirm && !packError && (
                <>
                  <QrScanner
                    key={scanForKey}
                    onScanSuccess={(payload) => onScanPaquete(payload)}
                    onError={(err) => { console.error(err); toast?.error?.("Error con la cámara"); setScanForKey(null); }}
                  />
                  <p className="muted text-center mt-2" style={{ fontSize: "0.8rem" }}>
                    Apuntá la cámara al código QR del paquete
                  </p>
                </>
              )}
              {packError && (
                <PackErrorModal
                  esperado={packError.esperado}
                  qr={packError.qr}
                  onRetry={() => { setPackError(null); setScanForKey(scanForKey); }}
                  onClose={() => { setPackError(null); setScanForKey(null); }}
                />
              )}
              {packConfirm && (
                <PackConfirmModal
                  {...packConfirm}
                  onConfirm={(qty) => {
                    const k = packConfirm.key;
                    setPrep(prev => {
                      const cur = prev[k] || {};
                      return { ...prev, [k]: clampPrepForNeed(k, { paquete: { packSize: packConfirm.packSize }, usarDePaquete: qty }) };
                    });
                    setPackConfirm(null);
                  }}
                  onClose={() => setPackConfirm(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
