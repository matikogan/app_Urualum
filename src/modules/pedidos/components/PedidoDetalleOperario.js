// src/modules/pedidos/pages/PedidoDetalleOperario.js
import { useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
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
import { useNavigate } from "react-router-dom";



// Modales que ya tenés en /components
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

// Control de cantidad horizontal (± 1)
function QtyRow({
  value,
  onDec,
  onInc,
  disabledMinus = false,
  disabledPlus = false,
  className = "",
}) {
  return (
    <div className={`qty ${className}`}>
      <button
        type="button"
        className="btn btn--outline qty__btn"
        onClick={onDec}
        disabled={disabledMinus}
        aria-label="Restar"
      >
        −
      </button>

      <span className="qty__num" aria-live="polite">{value}</span>

      <button
        type="button"
        className="btn btn--outline qty__btn"
        onClick={onInc}
        disabled={disabledPlus}
        aria-label="Sumar"
      >
        +
      </button>
    </div>
  );
}


// ============== Pantalla ==============
export default function PedidoDetalleOperario() {
  const { id : rawId } = useParams();
  const pedidoId = useMemo(() => decodeURIComponent(rawId || ""), [rawId]);
  const { toast, haptics } = useApp();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [pedido, setPedido] = useState(null);
  const [lite, setLite] = useState(true);
  const [loading, setLoading] = useState(true);
  const [autoStarting, setAutoStarting] = useState(false);
  const autoStartedRef = useRef(false); // evitar doble llamada a cambiarEstado

  // estado por ítem
  const [prep, setPrep] = useState({});

    // catálogo
  const [catalogoMap, setCatalogoMap] = useState({});


  // === CATEGORÍAS PERMITIDAS PARA OPERARIO ===
  const CAT_OPERARIO = ["PERFIL ALUMINIO", "KITS"];

  // Normalizar categoría desde el catálogo
  function getCategoria(uru) {
    const d = catalogoMap?.[uru];
    return (d?.categoria || "").toUpperCase().trim();
  }

  // Extraer código URU de un texto del item (viene desde Finnegans)
  function toURUCode(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/\b\d{7,}\b/);
    return m ? m[0] : s.split(" ")[0];
  }

  // Filtrar productos del pedido que pertenecen al operario
  const productosOperario = useMemo(() => {
    const src = pedido?.productos || [];
    return src.filter((it) => {
      const raw = it.cod || it.descripcion || it.desc || "";
      const uru = toURUCode(raw);
      const cat = getCategoria(uru);
      return CAT_OPERARIO.includes(cat);
    });
  }, [pedido?.productos, catalogoMap]);

  // LITE
  const [checks, setChecks] = useState({});
  const totalProductos = productosOperario.length;
  const checkedCount = Object.values(checks).filter(Boolean).length;
  const allChecked = totalProductos > 0 && checkedCount === totalProductos;


  // overlay flow
  const [scanForKey, setScanForKey] = useState(null); // string|null
  const [packConfirm, setPackConfirm] = useState(null); // { key, nombre, packSize, remaining, defaultQty } | null
  const [packError, setPackError] = useState(null); // { esperado, qr } | null

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



  // ===== util por item =====
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
    const { need } = info;
    const p = prep[k] || {};
    const usados = Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0);
    return Math.max(0, need - usados);
  }

  // clamp según “lo que falta” y límites (stock/pack)
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

  // ===== escaneo =====
  function onScanPaquete(payload) {
    try {
      if (!scanForKey) return;

      const info = getItemInfoByKey(scanForKey);
      if (!info) { toast?.error?.("No se encontró el producto seleccionado"); return; }
      const { uruExpected } = info;

      const codUruQR = toURUCode(payload.codUru || payload.codigo_urualum || payload.codigo || "");
      const packSize = Number(payload.packSize || payload.cantidad || 0);

      if (!codUruQR || !packSize) {
        toast?.error?.("QR inválido: faltan datos");
        return;
      }

      if (codUruQR !== uruExpected) {
        // QR incorrecto → muestro error SIN cerrar la cámara (seguir reintento)
        setPackError({ esperado: uruExpected, qr: codUruQR });
        return;
      }

      // QR correcto → cierro cámara y abro confirm
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

  // ===== efectos =====
  // Auto-transición: al abrir un pedido ASIGNADO, comenzar preparación automáticamente
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
        autoStartedRef.current = false; // permitir reintento manual
      } finally {
        setAutoStarting(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.estado, pedido?.operarioId, user?.uid]);

  useEffect(() => { (async () => setLite(await getFlag("MODO_LITE")))(); }, []);

  useEffect(() => {
    if (!pedido?.productos || !Array.isArray(pedido.productos)) return;
    const codigosURU = Array.from(
      new Set(
        pedido.productos
          .map(p => p.cod || p.codigo || p.codigoURU || p.desc || p.descripcion || p.nombre)
          .filter(Boolean)
          .map(toURUCode)
          .filter(Boolean)
      )
    );
    if (codigosURU.length === 0) { setCatalogoMap({}); return; }

    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          codigosURU.map(async (uru) => {
            const d = await getCatalogoByCodUru(uru);
            return [uru, d || null];
          })
        );
        if (!cancelled) setCatalogoMap(Object.fromEntries(entries));
      } catch (e) { console.error("[Operario] catálogo error", e?.code || e); }
    })();
    return () => { cancelled = true; };
  }, [pedido?.productos]);

  useEffect(() => {
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
  }, [pedido?.productos]);

  // ===== UI helpers =====
  if (loading) return <p className="p-3">Cargando…</p>;
  if (!pedido) return <p className="p-3">Pedido no encontrado.</p>;
  if (pedido.operarioId && pedido.operarioId !== user?.uid) {
    return <p className="p-3">No tenés acceso a este pedido.</p>;
  }

  async function onComenzar() {
    try {
      await cambiarEstado(pedidoId, ESTADOS.EN_PREPARACION);
      haptics?.success?.();
      toast?.success?.("Preparación iniciada");
      const p = await getPedido(pedidoId);
      setPedido(p);
    } catch (e) { toast?.error?.(e.message); }
  }
  function toggleCheck(k) { setChecks(prev => ({ ...prev, [k]: !prev[k] })); }
  function marcarTodo() {
    const next = {};
    (pedido?.productos || []).forEach((it, i) => { next[keyFor(it, i)] = true; });
    setChecks(next);
  }
  async function onFinalizarLite() {
    await finalizarPreparacion();
  }
  

  async function finalizarPreparacion() {
    try {
      // marcar perfiles/kits como preparados
      await updateDoc(doc(db, "pedidos", pedido.id || pedidoId), {
        prepPerfilesOk: true,
      });

      // cambiar estado del pedido
      await cambiarEstado(pedidoId, ESTADOS.PREPARADO);

      // feedback al usuario (suena + vibra)
      haptics?.success?.();
      toast?.success?.("Pedido preparado");

      // redirigir después de un pequeño delay
      setTimeout(() => {  
        navigate("/operario/asignados");
      }, 900);

    } catch (e) {
      console.error(e);
      toast?.error?.(e.message || "No se pudo confirmar la preparación");
    }
  }


  // ===== Overlay único (arriba de todo) =====
  const overlayOpen = !!(scanForKey || packError || packConfirm);

  return (
    <div className="p-3 space-y-3">
      <header>
        <VolverListaPedidos to="/operario/asignados" />
        <h1 className="font-bold">Pedido #{pedido.numero}</h1>
        <p className="text-sm text-gray-600">{pedido.cliente}</p>
      </header>

      {pedido.estado === ESTADOS.ASIGNADO && (
        <div className="card card--compact" style={{ textAlign: "center", padding: "16px" }}>
          {autoStarting ? (
            <p className="muted">⏳ Iniciando preparación…</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 8 }}>Iniciando preparación automáticamente…</p>
              <button className="btn btn--primary" onClick={onComenzar}>
                Comenzar ahora
              </button>
            </>
          )}
        </div>
      )}

      {pedido.estado === ESTADOS.EN_PREPARACION && (
        <div className="space-y-3">
          <div className="card">
            <div className="subsection-title">
              <span>{lite ? "Preparación (modo LITE)" : "Preparación (escaneo)"}</span>
              <span className="muted">
                {lite
                  ? `${checkedCount}/${totalProductos}`
                  : `${(pedido?.productos || []).reduce((a, it) => a + reqQty(it), 0)} / ${
                      (pedido?.productos || []).reduce((a, it, i) => {
                        const k = keyFor(it, i);
                        const p = prep[k] || {};
                        return a + Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0);
                      }, 0)
                    }`
                }
              </span>
            </div>

            <div className="subsection-body space-y-3">
              {/* --------- LITE --------- */}
              {lite && (
                <>
                  <div className="product-grid">
                    {productosOperario.map((it, i) => {
                      const qty = reqQty(it);
                      const raw = it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || it.nombre || "";
                      const uru = toURUCode(raw);
                      const cat = catalogoMap[uru] || {};
                      const customer = cat?.customerNo || cat?.customer_no || toURUCode(raw) || "—";
                      const color = cat?.finish || cat?.color || "—";
                      const k = keyFor(it, i);
                      const cargado = !!checks[k];
                      return (
                        <div
                          key={k}
                          className="card product-card"
                          style={{ opacity: cargado ? 0.7 : 1 }}
                        >
                          <div className="product-heading">
                            <span className="product-customer">{customer}</span>
                            <span className="product-color">{color}</span>
                            <span className="pill" style={{ marginLeft: "auto" }}>x{qty}</span>
                          </div>
                          <button
                            type="button"
                            className={`btn w-full mt-2 ${cargado ? "btn--success" : "btn--primary"}`}
                            style={cargado ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}}
                            onClick={() => toggleCheck(k)}
                          >
                            {cargado ? "✓ Cargado en pedido" : "Cargar en pedido"}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <button className="btn btn--outline flex-1" onClick={marcarTodo}>Marcar todo</button>
                    <button
                      className="btn flex-1 bg-black text-white disabled:opacity-60"
                      onClick={onFinalizarLite}
                      disabled={!allChecked}
                    >
                      Finalizar preparación
                    </button>
                  </div>
                </>
              )}

              {/* --------- COMPLETO (ESCÁNER) --------- */}
              {!lite && (
                <>
                  <div className="space-y-2">
                    {(productosOperario.map || []).map((it, i) => {
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
                          {/* Header compacto */}
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

                          {/* Meta breve */}
                          <div className="product-card__meta">
                            <span className="meta-pill">
                              Sueltas: <strong>{Number(p.stock || 0)}</strong>
                            </span>
                            <span className="meta-pill">
                              Pack: <strong>{p.paquete?.packSize ? `x${p.paquete.packSize}` : "—"}</strong>
                            </span>
                          </div>

                          {/* Cantidades — sueltas */}
                          <div className="qty-row">
                            <span className="qty-row__label">Sueltas</span>
                            <div className="qty">
                              <button
                                type="button"
                                className="qty__btn"
                                aria-label="Quitar tira suelta"
                                onClick={() =>
                                  setPrep(prev => {
                                    const cur = prev[k] || {};
                                    const val = Math.max(0, Number(cur.usarSueltas || 0) - 1);
                                    return { ...prev, [k]: { ...cur, usarSueltas: val } };
                                  })
                                }
                                disabled={Number(p.usarSueltas || 0) <= 0}
                              >−</button>
                              <span className="qty__val">{Number(p.usarSueltas || 0)}</span>
                              <button
                                type="button"
                                className="qty__btn"
                                aria-label="Agregar tira suelta"
                                onClick={() =>
                                  setPrep(prev => {
                                    const cur = prev[k] || {};
                                    const stockSueltas = Number(cur.stock || 0);
                                    const remaining = Math.max(0, need - Number(cur.usarDePaquete || 0));
                                    const next = Math.min(
                                      stockSueltas,
                                      remaining,
                                      Number(cur.usarSueltas || 0) + 1
                                    );
                                    return { ...prev, [k]: { ...cur, usarSueltas: next } };
                                  })
                                }
                                disabled={(() => {
                                  const stockSueltas = Number(p.stock || 0);
                                  const remaining = Math.max(0, need - Number(p.usarDePaquete || 0));
                                  return Number(p.usarSueltas || 0) >= Math.min(stockSueltas, remaining);
                                })()}
                              >+</button>
                            </div>
                          </div>

                          {/* Cantidades — paquete (aparece solo si hay pack escaneado) */}
                          {p.paquete ? (
                            <div className="qty-row">
                              <span className="qty-row__label">Paquete</span>
                              <div className="qty">
                                <button
                                  type="button"
                                  className="qty__btn"
                                  aria-label="Quitar del paquete"
                                  onClick={() =>
                                    setPrep(prev => {
                                      const cur = prev[k] || {};
                                      const val = Math.max(0, Number(cur.usarDePaquete || 0) - 1);
                                      return { ...prev, [k]: { ...cur, usarDePaquete: val } };
                                    })
                                  }
                                  disabled={Number(p.usarDePaquete || 0) <= 0}
                                >−</button>
                                <span className="qty__val">{Number(p.usarDePaquete || 0)}</span>
                                <button
                                  type="button"
                                  className="qty__btn"
                                  aria-label="Agregar del paquete"
                                  onClick={() =>
                                    setPrep(prev => {
                                      const cur = prev[k] || {};
                                      const usedNow = Number(cur.usarSueltas || 0) + Number(cur.usarDePaquete || 0);
                                      const remaining = Math.max(0, need - usedNow);
                                      const packSize = Number(cur.paquete?.packSize || 0);
                                      const roomInPack = Math.max(0, packSize - Number(cur.usarDePaquete || 0));
                                      const stepAllowed = Math.min(remaining, roomInPack);
                                      const val = Number(cur.usarDePaquete || 0) + (stepAllowed > 0 ? 1 : 0);
                                      return {
                                        ...prev,
                                        [k]: { ...cur, usarDePaquete: Math.min(val, packSize) },
                                      };
                                    })
                                  }
                                  disabled={(() => {
                                    const usedNow = Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0);
                                    const remaining = Math.max(0, need - usedNow);
                                    const packSize = Number(p.paquete?.packSize || 0);
                                    const roomInPack = Math.max(0, packSize - Number(p.usarDePaquete || 0));
                                    return remaining <= 0 || roomInPack <= 0;
                                  })()}
                                >+</button>
                              </div>
                            </div>
                          ) : (
                            <div className="qty-row qty-row--hint">
                              <span className="qty-row__label">Paquete</span>
                              <span className="hint">—</span>
                            </div>
                          )}

                          {/* Siempre al fondo */}
                          <button
                            type="button"
                            className="btn btn--secondary btn--full mt-2"
                            onClick={() => setScanForKey(String(k))}
                          >
                            Escanear paquete
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="btn w-full bg-black text-white disabled:opacity-60"
                    onClick={finalizarPreparacion}
                    disabled={
                      !(pedido?.productos || []).every((it, i) => {
                        const k = keyFor(it, i);
                        const p = prep[k] || {};
                        return (Number(p.usarSueltas || 0) + Number(p.usarDePaquete || 0)) >= reqQty(it);
                      })
                    }
                  >
                    Finalizar preparación
                  </button>

                </>
              )}
            </div>
          </div>
        </div>
      )}

      {pedido.estado === ESTADOS.PREPARADO && (
        <div className="card card--compact" style={{ textAlign: "center", padding: "16px" }}>
          <p style={{ fontSize: "2rem", marginBottom: 4 }}>✅</p>
          <p className="font-bold">¡Pedido preparado!</p>
          <p className="muted">Volviendo a tu lista…</p>
        </div>
      )}

      {/* ================= Overlay ÚNICO (SIEMPRE ENCIMA) — solo en modo escáner ================= */}
      {!lite && overlayOpen && (
        <div
          className="overlay-fixed"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.62)",
            zIndex: 9999,               // <<— ENSIMA DE TODO
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 420,
              maxHeight: "92vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 20px 50px rgba(0,0,0,.35)",
              border: "1px solid rgba(0,0,0,.08)",
            }}
          >
            <div className="subsection-title" style={{ position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
              <span>
                {scanForKey ? "Escanear paquete" : packError ? "Paquete incorrecto" : "Confirmar paquete"}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => { setScanForKey(null); setPackError(null); setPackConfirm(null); }}
              >
                Cerrar
              </button>
            </div>

            <div className="p-3">
              {/* === Cámara === */}
              {scanForKey && !packConfirm && !packError && (
                <>
                  <QrScanner
                    key={scanForKey}
                    onScanSuccess={(payload) => onScanPaquete(payload)}
                    onError={(err) => {
                      console.error("[QR] error:", err);
                      alert("No se pudo abrir la cámara.\nVerificá permisos/HTTPS o probá en móvil.");
                    }}
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Si la cámara no aparece, verificá HTTPS y permisos de cámara.
                  </p>
                </>
              )}

              {/* === Error === */}
              {!scanForKey && packError && (
                <div className="space-y-3">
                  <div className="muted">Este paquete no corresponde al producto.</div>
                  <div className="card" style={{ background: "#fafafa" }}>
                    <div className="p-2 text-sm">
                      <div><b>Esperado:</b> {packError.esperado}</div>
                      <div><b>Escaneado:</b> {packError.qr}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn--outline flex-1"
                      onClick={() => setPackError(null)} // cierro error y dejo overlay porque podrías reabrir cámara
                    >
                      Entendido
                    </button>
                    <button
                      className="btn flex-1"
                      onClick={() => { setPackError(null); setScanForKey(String(packConfirm?.key || "")); }}
                      disabled={!packConfirm?.key && !scanForKey}
                    >
                      Reintentar
                    </button>
                  </div>
                </div>
              )}

              {/* === Confirmación === */}
              {!scanForKey && !packError && packConfirm && (
                <ConfirmCard
                  data={packConfirm}
                  onCancel={() => setPackConfirm(null)}
                  onConfirm={(qty) => {
                    const k = packConfirm.key;
                    setPrep((prev) => {
                      const cur = prev[k] || {};
                      const next = clampPrepForNeed(k, {
                        ...cur,
                        paquete: { packSize: Number(packConfirm.packSize || 0) },
                        usarDePaquete: Math.max(Number(cur.usarDePaquete || 0), Number(qty || 0)),
                      });
                      return { ...prev, [k]: next };
                    });
                    setPackConfirm(null);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================== Card de Confirmación (auto-contenida) ==================
function ConfirmCard({ data, onCancel, onConfirm }) {
  const { nombre, packSize, remaining, defaultQty = 0 } = data || {};
  const maxQty = Math.max(0, Math.min(Number(remaining || 0), Number(packSize || 0)));

  const [qty, setQty] = useState(Math.min(defaultQty, maxQty));

  // no hooks condicionales: este componente es siempre montado de forma directa por el padre
  const dec = () => setQty((q) => Math.max(0, q - 1));
  const inc = () => setQty((q) => Math.min(maxQty, q + 1));

  return (
    <div className="space-y-3">
      <div className="card" style={{ background: "#fafafa" }}>
        <div className="p-2 text-sm">
          <div><b>{nombre || "Producto"}</b></div>
          <div className="muted">El paquete trae <b>{packSize}</b> tiras</div>
          <div className="muted">Te faltan <b>{remaining}</b> tiras</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="muted">Seleccioná cuántas tiras retirar</div>
        <div className="flex items-center gap-2">
          <button className="btn btn--outline" onClick={dec} disabled={qty <= 0}>-</button>
          <input
            type="number"
            className="input mono"
            value={qty}
            min={0}
            max={maxQty}
            onChange={(e) => {
              const v = Number(e.target.value || 0);
              const clamped = Math.max(0, Math.min(maxQty, v));
              setQty(clamped);
            }}
            style={{ width: 90, textAlign: "center" }}
          />
          <button className="btn btn--outline" onClick={inc} disabled={qty >= maxQty}>+</button>
        </div>
        <div className="text-xs muted">Máximo permitido: {maxQty} (min(remaining, packSize))</div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn--ghost flex-1" onClick={onCancel}>Cancelar</button>
        <button
          className="btn flex-1"
          onClick={() => onConfirm(qty)}
          disabled={qty <= 0 || qty > maxQty}
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}