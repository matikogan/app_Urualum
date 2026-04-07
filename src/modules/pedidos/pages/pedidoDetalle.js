import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { getPedido, asignarOperario, updateEstado } from "../services/pedidosFS";
import { ESTADOS } from "../services/estados";
import { getFlag } from "../services/featureFlags";
import { db } from "../../../firebase";
import { doc, updateDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import { getCatalogoByCodUru } from "../services/catalogo";
import VolverListaPedidos from "../components/VolverListaPedidos";

import QrScanner from "components/QrScanner";        
import PackConfirmModal from "../components/PackConfirmModal";
import PackErrorModal from "../components/PackErrorModal";
import { actualizarMovimientosStockSueltas, confirmarPedidoConStock } from "../services/stockTiras";

import { useNavigate, useLocation } from "react-router-dom";
import { despacharPedido } from "../services/despachoFS";

import ConfirmarDespacho from "./confirmarDespacho";




// — util: sanitiza a “código URU”
function toURUCode(value) {
  const s = String(value ?? "").trim();
  const mNum = s.match(/\b\d{7,}\b/);
  if (mNum) return mNum[0];
  return s.split(/\s+/)[0].replace(/[^\w-]/g, "");
}

// Categorías del operario
const CAT_OPERARIO = ["PERFIL ALUMINIO", "KITS"];

// Normaliza categoría desde catalogoProductos
function getCategoriaEnc(uru, catalogoMap) {
  return (catalogoMap?.[uru]?.categoria || "").toUpperCase().trim();
}

// Divide los productos en grupos
function splitPorCategoria(productos, catalogoMap) {
  const operario = [];
  const encargado = [];

  productos.forEach((it, i) => {
    const raw = it.cod || it.descripcion || it.desc || "";
    const uru = raw.match(/\b\d{7,}\b/)?.[0] || raw.split(" ")[0];
    const cat = getCategoriaEnc(uru, catalogoMap);

    if (CAT_OPERARIO.includes(cat)) operario.push({ it, uru, cat });
    else encargado.push({ it, uru, cat });
  });

  return { operario, encargado };
}


function EncPreparacionPanel({
  pedido,                  // objeto pedido completo
  productos,               // pedido.productos (array)
  catalogIndex,            // índice { codUru -> {customerNo, finish, ...} } si ya lo traés
  onClose,                 // si querés volver atrás
  onPreparacionFinalizada, // callback para cuando se termina (cambia estado)
}) {
  const { featureFlags } = useApp();
  const lite = featureFlags?.MODO_LITE !== false;

  // estado UI compartido (idéntico a Operario)
  const [prep, setPrep] = React.useState({});         // { key: { usarSueltas, usarDePaquete, paquete: {packSize} } }
  const [checks, setChecks] = React.useState({});     // modo lite: tildes
  const [scanForKey, setScanForKey] = React.useState(null);
  const [modalPack, setModalPack] = React.useState(null);   // {key, packSize, remain}
  const [modalError, setModalError] = React.useState(null); // {title, message}




  // helpers
  const toURU = v => String(v || "").match(/\d{6,}/)?.[0] || String(v || "");
  const needMap = React.useMemo(() => {
    const map = {};
    (productos || []).forEach((it, i) => {
      const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
      const key = `${uru}-${i}`;
      map[key] = Number(it.cantidad || it.cant || it.qty || 0);
    });
    return map;
  }, [productos]);

  const allChecked = React.useMemo(() => {
    if (!lite) return false;
    const keys = Object.keys(needMap);
    return keys.length > 0 && keys.every(k => checks[k]);
  }, [lite, needMap, checks]);

  const marcarTodo = () => {
    const next = {};
    (productos || []).forEach((it, i) => {
      const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
      const key = `${uru}-${i}`;
      next[key] = true;
    });
    setChecks(next);
  };

  // === RENDER ITEM (lite y full) ===
  function renderItemLite(it, i) {
    const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
    const key = `${uru}-${i}`;
    const cat = catalogIndex?.[uru];
    const customer = cat?.customerNo || uru;
    const color = cat?.finish || "—";
    const checked = !!checks[key];
    const need = needMap[key] || 0;

    return (
      <div key={key} className="card">
        <div className="order-head">
          <div className="order-number">{customer}</div>
          <span className="product-color" style={{ marginLeft: 8 }}>{color}</span>
          <span className="pill" style={{ marginLeft: "auto" }}>Req: {need}</span>
        </div>

        <div className="order-body">
          <label className="item-check-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={checked}
              onChange={() => setChecks(prev => ({ ...prev, [key]: !prev[key] }))}
            />
            <div className="muted">Marcar como preparado</div>
          </label>
        </div>
      </div>
    );
  }

  function renderItemFull(it, i) {
    const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
    const key = `${uru}-${i}`;
    const cat = catalogIndex?.[uru];
    const customer = cat?.customerNo || uru;
    const color = cat?.finish || "—";
    const need = needMap[key] || 0;

    const p = prep[key] || {};
    const usados = (p.usarSueltas || 0) + (p.usarDePaquete || 0);
    const ok = usados >= need;
    const dispSueltas = Number(it.sueltasDisp || 0); // si lo traés; si no, mostralo como 0

    const setP = updater => {
      setPrep(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...(typeof updater === "function" ? updater(prev[key] || {}) : updater) } }));
    };

    // UI de suma/resta horizontal
    const QtyRow = ({ value, onDec, onInc, disabledMinus, disabledPlus, className }) => (
      <div className={`qty-row ${className || ""}`}>
        <button type="button" className="btn btn--outline btn-sm" onClick={onDec} disabled={disabledMinus}>-</button>
        <div className="qty-value mono">{value}</div>
        <button type="button" className="btn btn--outline btn-sm" onClick={onInc} disabled={disabledPlus}>+</button>
      </div>
    );

    const remainNeed = Math.max(0, need - usados);

    return (
      <div key={key} className="card">
        <div className="order-head">
          <div className="order-number">{customer}</div>
          <span className="product-color" style={{ marginLeft: 8 }}>{color}</span>
          <span className="pill" style={{ marginLeft: "auto" }}>Req: {need}</span>
          <span className={`pill ${ok ? "pill--ok" : ""}`} style={{ marginLeft: 8 }}>Usado: {usados}</span>
        </div>

        <div className="order-body space-y-2">

          {/* Tiras sueltas */}
          <div className="mt-1">
            <div className="meta">Tiras sueltas disponibles: {dispSueltas}</div>
            <QtyRow
              className="mt-1"
              value={p.usarSueltas || 0}
              onDec={() => setP({ usarSueltas: Math.max(0, (p.usarSueltas || 0) - 1) })}
              onInc={() => {
                const max = Math.min(remainNeed - (p.usarDePaquete || 0), dispSueltas);
                const next = Math.min(max, (p.usarSueltas || 0) + 1);
                setP({ usarSueltas: Math.max(0, next) });
              }}
              disabledMinus={(p.usarSueltas || 0) <= 0}
              disabledPlus={(p.usarSueltas || 0) >= Math.min(remainNeed - (p.usarDePaquete || 0), dispSueltas)}
            />
          </div>

          {/* Usar del paquete */}
          <div className="mt-2">
            <div className="meta">Usar del paquete</div>
            <QtyRow
              className="mt-1"
              value={p.usarDePaquete || 0}
              onDec={() => setP({ usarDePaquete: Math.max(0, (p.usarDePaquete || 0) - 1) })}
              onInc={() => {
                const packSize = p.paquete?.packSize || 0;
                const roomInPack = Math.max(0, packSize - (p.usarDePaquete || 0));
                const can = Math.min(remainNeed, roomInPack);
                const next = Math.min(can, (p.usarDePaquete || 0) + 1);
                setP({ usarDePaquete: Math.max(0, next) });
              }}
              disabledMinus={(p.usarDePaquete || 0) <= 0}
              disabledPlus={(() => {
                const packSize = p.paquete?.packSize || 0;
                const roomInPack = Math.max(0, packSize - (p.usarDePaquete || 0));
                return remainNeed <= 0 || roomInPack <= 0;
              })()}
            />
          </div>

          {/* Escanear paquete siempre abajo */}
          <div className="mt-2">
            <button
              type="button"
              className="btn btn--secondary btn-sm w-full"
              onClick={() => setScanForKey(key)}
            >
              Escanear paquete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Render principal del panel
  return (
    <div className="space-y-3">
      {(productos || []).map((it, i) => lite ? renderItemLite(it, i) : renderItemFull(it, i))}

      {/* Acciones finales */}
      {lite ? (
        <div className="mt-3 flex gap-2">
          <button className="btn btn--outline flex-1" onClick={marcarTodo}>Marcar todo</button>
          <button className="btn flex-1 bg-black text-white disabled:opacity-60" disabled={!allChecked} onClick={onPreparacionFinalizada}>
            Finalizar preparación
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <button
            className="btn w-full bg-black text-white"
            onClick={async () => {
              try {
                // Reutilizá acá la misma confirmación que usa Operario
                await confirmarPedidoConStock({ pedido, prep }); // mismo helper que tengas en Operario
                onPreparacionFinalizada();
              } catch (e) {
                setModalError({ title: "Error", message: e?.message || "No se pudo finalizar" });
              }
            }}
          >
            Finalizar preparación
          </button>
        </div>
      )}

      {/* Overlay de escaneo (idéntico al Operario) */}
      {scanForKey && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: "rgba(0,0,0,.62)" }}>
          <div className="card w-[92%] max-w-[520px]">
            <div className="order-head"><div className="order-number">Escanear paquete</div></div>
            <div className="order-body">
              <QrScanner
                onClose={() => setScanForKey(null)}
                onRead={(payload) => {
                  // payload esperado: { codigo_urualum, cantidad }
                  const uru = scanForKey.split("-")[0];
                  if (String(payload?.codigo_urualum) !== String(uru)) {
                    setModalError({
                      title: "Paquete incorrecto",
                      message: "El QR no corresponde a este producto."
                    });
                    return;
                  }
                  const packSize = Number(payload?.cantidad || 0);
                  const usados = (prep[scanForKey]?.usarSueltas || 0) + (prep[scanForKey]?.usarDePaquete || 0);
                  const need = needMap[scanForKey] || 0;
                  const remain = Math.max(0, need - usados);

                  setPrep(prev => ({
                    ...prev,
                    [scanForKey]: { ...(prev[scanForKey] || {}), paquete: { packSize } }
                  }));
                  setModalPack({ key: scanForKey, packSize, remain });
                  setScanForKey(null);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar paquete */}
      {modalPack && (
        <PackConfirmModal
          keyId={modalPack.key}
          packSize={modalPack.packSize}
          remain={modalPack.remain}
          value={prep[modalPack.key]?.usarDePaquete || 0}
          onCancel={() => setModalPack(null)}
          onConfirm={(val) => {
            setPrep(prev => ({ ...prev, [modalPack.key]: { ...(prev[modalPack.key] || {}), usarDePaquete: val } }));
            setModalPack(null);
          }}
        />
      )}

      {/* Modal error */}
      {modalError && (
        <PackErrorModal
          title={modalError.title}
          message={modalError.message}
          onClose={() => setModalError(null)}
        />
      )}
    </div>
  );
}


export default function PedidoDetalle() {
  const { haptics, toast } = useApp();
  const { user, profile } = useAuth();

  const role = (profile?.role || "").toLowerCase();
  const isVentas = role === "ventas";
  const isEncargado = role === "encargado";

  

  const navigate = useNavigate();
  const location = useLocation();
  const [sending, setSending] = useState(false);
    // === Accesorios controlados por el encargado ===
  const [accChecks, setAccChecks] = useState({});


  function handleBack() {
    // Si el usuario es de ventas, forzamos la lista de "CONTROLADOS" de ventas
    if (isVentas) {
      navigate("/ventas/para-despachar", { replace: true });
      return;
    }
    // Para otros roles (encargado/operario), podés ajustar esta ruta si tu app usa otra
    navigate("/encargado/pedidos", { replace: true });
  }



  // id desde la URL (decodificado)
  const { id: encodedId } = useParams();
  const id = decodeURIComponent(encodedId || "");

  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState(null);
  const [lite, setLite] = useState(false);

  // selector de operario
  const [operarios, setOperarios] = useState([]);
  const [selectedOperario, setSelectedOperario] = useState(null);
  const [loadingOps, setLoadingOps] = useState(false);
  const [saving, setSaving] = useState(false);

  const [bultos, setBultos] = useState(pedido?.bultos || "");
  const [paquetes, setPaquetes] = useState(pedido?.paquetes || "");


  // catálogo enriquecido: { [uru]: { customerNo, finish, ... } }
  const [catalogoMap, setCatalogoMap] = useState({});

  // --- Control de pedido (checklist)
  const [checks, setChecks] = useState({});

  // --- Reporte de error en preparación
  const [showErrForm, setShowErrForm] = useState(false);
  const [detalleErr, setDetalleErr] = useState("");
  const [savingErr, setSavingErr] = useState(false);

  const [cambiandoOperario, setCambiandoOperario] = useState(false);




  // resetear checks cuando cambia el pedido
  useEffect(() => {
    setChecks({});
  }, [id, pedido?.numero, Array.isArray(pedido?.productos) ? pedido.productos.length : 0]);

  function toggleCheck(key) {
    setChecks(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const totalProductos = Array.isArray(pedido?.productos) ? pedido.productos.length : 0;
  const checkedCount = useMemo(() => Object.values(checks).filter(Boolean).length, [checks]);
  const allChecked = totalProductos > 0 && checkedCount === totalProductos;

  async function guardarBultosYPaquetes() {
    try {
      const docRef = doc(db, "pedidos", id);
      await updateDoc(docRef, {
        bultos: Number(bultos),
        paquetes: Number(paquetes),
      });
      toast.success("Datos guardados");
    } catch (e) {
      console.error("Error guardando bultos/paquetes", e);
      toast.error("No se pudieron guardar los datos");
    }
  }


  // confirmar control → pasa a CONTROLADO
  async function confirmControl() {
  try {
    await updateDoc(doc(db, "pedidos", id), {
      prepAccesoriosOk: true,
    });

    await updateEstado(id, ESTADOS.CONTROLADO);
    toast.success("Pedido controlado");
  } catch (e) {
    toast.error(e.message);
  }
}


  async function submitErrorPreparacion() {
    if (!detalleErr.trim()) {
      toast.error("Escribí el detalle del error.");
      return;
    }
    try {
      setSavingErr(true);
      const respNombre = profile?.nombre || user?.displayName || user?.email || "—";
      await addDoc(collection(db, "errores_preparacion"), {
        pedidoId: id,
        numero: pedido.numero || null,
        cliente: pedido.cliente || null,
        deposito: pedido.deposito || null,
        responsableUid: user?.uid || null,
        responsableNombre: respNombre,
        estadoPedido: pedido.estado || null,
        finFecha: pedido.finFecha || null,
        metodoEntrega: pedido.metodoEntrega || null,
        detalle: detalleErr.trim(),
        fechaReporte: serverTimestamp(),
      });
      setShowErrForm(false);
      setDetalleErr("");
      toast.success("Error registrado");
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo registrar el error");
    } finally {
      setSavingErr(false);
    }
  }




  // placeholder para el flujo de incidente (lo conectamos luego)
  function reportarErrorPreparacion() {
    toast.info("Luego conectamos este botón al registro de incidentes.");
  }


  // flag lite (seguro)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await getFlag("MODO_LITE");
        if (!alive) return;
        const parsed = String(v ?? "").toLowerCase().trim() === "true" || v === true;
        setLite(parsed);
      } catch {
        if (alive) setLite(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // cargar pedido
  useEffect(() => {
    let cancelled = false;
    if (!id) { setError("ID inválido"); return; }
    (async () => {
      try {
        const p = await getPedido(id);
        if (cancelled) return;
        if (!p) { setError("Pedido no encontrado"); setPedido(null); }
        else { setError(null); setPedido(p); }
      } catch (e) {
        console.error("[PedidoDetalle] getPedido error", e);
        if (!cancelled) setError("Error cargando pedido");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Cargar catálogo para los códigos URU del pedido
  useEffect(() => {
    if (!pedido?.productos || !Array.isArray(pedido.productos)) return;

    const codigos = Array.from(
      new Set(
        pedido.productos
          .map(p => p.cod || p.codigo || p.codigoURU || p.desc || p.descripcion || p.nombre)
          .filter(Boolean)
          .map(toURUCode)
          .filter(Boolean)
      )
    );

    if (codigos.length === 0) { setCatalogoMap({}); return; }

    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          codigos.map(async uru => {
            const doc = await getCatalogoByCodUru(uru);
            return [uru, doc || null];
          })
        );
        if (!cancelled) {
          const map = Object.fromEntries(entries);
          setCatalogoMap(map);
        }
      } catch (e) {
        console.error("[PedidoDetalle] catálogo error", e?.code || e);
        toast.error("No se pudo cargar información del catálogo");
      }
    })();

    return () => { cancelled = true; };
  }, [pedido?.productos, toast]);

  // cargar operarios del depósito del pedido (solo cuando realmente hace falta)
  useEffect(() => {
    // Cargamos la lista SOLO si:
    // 1) hay depósito, 2) el estado requiere asignación, 3) el rol es ENCARGADO
    if (!pedido?.deposito) return;
    if (![ESTADOS.PENDIENTE_ASIGNAR, ESTADOS.ASIGNADO].includes(pedido?.estado)) return;
    if ((profile?.rol || "").toLowerCase() !== "encargado") return;

    let cancelled = false;
    setLoadingOps(true);
    (async () => {
      try {
        const qOps = query(
          collection(db, "users"),
          where("rol", "==", "operario"),
          where("deposito", "==", pedido.deposito)
        );
        const snap = await getDocs(qOps);
        if (cancelled) return;
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setOperarios(list);
        if (pedido.operarioId) {
          const found = list.find(o => o.id === pedido.operarioId);
          if (found) setSelectedOperario({ uid: found.id, nombre: found.nombre || found.email });
        }
      } catch (e) {
        console.error("[PedidoDetalle] cargar operarios error", e);
        if (!cancelled) toast.error("No se pudieron cargar operarios");
      } finally {
        if (!cancelled) setLoadingOps(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pedido?.deposito, pedido?.estado, pedido?.operarioId, profile?.rol, toast]);


  // buscador de operarios
const [searchOp, setSearchOp] = useState("");

const filteredOperarios = useMemo(() => {
  const q = searchOp.trim().toLowerCase();
  if (!q) return operarios;
  return operarios.filter(o => {
    const s = `${o.nombre || ""} ${o.email || ""}`.toLowerCase();
    return s.includes(q);
  });
}, [searchOp, operarios]);


  const puedeAsignarAlguien = useMemo(() => {
    const role = (profile?.rol || "").toLowerCase();
    return role === "encargado"; // solo encargado puede asignar a otros
  }, [profile?.rol]);

  const puedeAutoAsignarse = useMemo(() => {
    const role = (profile?.rol || "").toLowerCase();
    // encargado u operario pueden auto-asignarse si el depósito coincide
    return !!pedido?.deposito && (role === "encargado" || role === "operario") &&
      profile?.deposito === pedido.deposito;
  }, [profile?.rol, profile?.deposito, pedido?.deposito]);

  async function handleConfirmarAsignacion() {
    if (!selectedOperario?.uid) {
      toast.error("Seleccioná un operario");
      return;
    }
    if (!puedeAsignarAlguien) {
      toast.error("No tenés permisos para asignar");
      return;
    }
    try {
      setSaving(true);
      await asignarOperario(id, selectedOperario.uid, selectedOperario.nombre || "Operario");
      await updateEstado(id, ESTADOS.ASIGNADO);
      haptics?.success?.();
      toast.success("Pedido asignado");
      // refrescar local
      setPedido(prev => prev ? {
        ...prev,
        operarioId: selectedOperario.uid,
        operarioNombre: selectedOperario.nombre || "Operario",
        estado: ESTADOS.ASIGNADO
      } : prev);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Error al asignar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoAsignarme() {
    if (!puedeAutoAsignarse) {
      toast.error("No podés autoasignarte este pedido");
      return;
    }
    try {
      setSaving(true);
      const nombre = profile?.nombre || user?.displayName || user?.email || "Operario";
      await asignarOperario(id, user.uid, nombre);
      await updateEstado(id, ESTADOS.ASIGNADO);
      haptics?.success?.();
      toast.success("Te asignaste el pedido");
      setPedido(prev => prev ? {
        ...prev,
        operarioId: user.uid,
        operarioNombre: nombre,
        estado: ESTADOS.ASIGNADO
      } : prev);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo auto-asignar");
    } finally {
      setSaving(false);
    }
  }

  async function onComenzar() {
    try {
      setSaving(true);
      await updateEstado(id, ESTADOS.EN_PREPARACION);
      haptics?.success?.();
      toast.success("Preparación iniciada");
      setPedido(prev => prev ? { ...prev, estado: ESTADOS.EN_PREPARACION } : prev);
    } catch (e) {
      toast.error(e.message || "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  }

  async function onFinalizar() {
    try {
      setSaving(true);
      await updateEstado(id, ESTADOS.PREPARADO);
      haptics?.success?.();
      toast.success("Pedido preparado");
      setPedido(prev => prev ? { ...prev, estado: ESTADOS.PREPARADO } : prev);
    } catch (e) {
      toast.error(e.message || "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="p-3 text-red-600">{error}</div>;
  if (!pedido) return <p className="p-3">Cargando…</p>;

  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

  return (
    <div className="p-3 space-y-4">
      {/* Header + volver */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-bold text-xl">
          {pedido.numero || id}
        </h1>
        <VolverListaPedidos className="btn btn--outline btn-sm" to= "/pedidos" />
      </div>

      {/* Detalle general */}
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

      {/* Productos (Customer No, Color, Cantidad) — ocultar en EN_PREPARACION para no duplicar */}
        {pedido.estado !== ESTADOS.EN_PREPARACION && (
          <div className="card">
            <div className="subsection-title">
              <span>Productos</span>
              <span className="muted">
                {pedido.estado === ESTADOS.PREPARADO ? `${checkedCount}/${totalProductos}` : totalProductos}
              </span>
            </div>

            <div className="subsection-body">
              {(() => {
                const { operario, encargado } = splitPorCategoria(productos, catalogoMap);

                return (
                  <>
                    {/* === Sección Operario === */}
                    <div className="subsection-title">Perfiles y Kits</div>
                    <div className="product-grid">
                      {operario.map(({ it, uru, cat }, i) => (
                        <div key={`op-${uru}-${i}`} className="card product-card">
                          <div className="product-heading">
                            <span className="product-customer">{catalogoMap?.[uru]?.customerNo || uru}</span>
                            <span className="product-color">{catalogoMap?.[uru]?.finish || "—"}</span>
                            <span className="pill" style={{ marginLeft: "auto" }}>
                              x{it.cant ?? it.cantidad ?? it.qty ?? 0}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* === Sección Encargado === */}
                    <div className="subsection-title">Accesorios / PVC / Vidrios / Refuerzos</div>
                    <div className="product-grid">
                      {encargado.map(({ it, uru, cat }, i) => (
                        <div key={`enc-${uru}-${i}`} className="card product-card">
                          <div className="product-heading">
                            <span className="product-customer">{catalogoMap?.[uru]?.customerNo || uru}</span>
                            <span className="product-color">{catalogoMap?.[uru]?.finish || "—"}</span>
                            <span className="pill" style={{ marginLeft: "auto" }}>
                              x{it.cant ?? it.cantidad ?? it.qty ?? 0}
                            </span>
                          </div>

                          {/* Checkbox del ENCARGADO */}
                          <div className="p-2">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={!!accChecks[`${uru}-${i}`]}
                                onChange={() => {
                                  const key = `${uru}-${i}`;

                                  // actualizamos los checks usados para allChecked
                                  setChecks(prev => ({
                                    ...prev,
                                    [key]: !prev[key],
                                  }));

                                  // mantenemos accChecks para UI del encargado
                                  setAccChecks(prev => ({
                                    ...prev,
                                    [key]: !prev[key],
                                  }));
                                }}
                              />
                              <span className="muted text-sm">Confirmar</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}


              {/* Acciones del control SOLO visibles en PREPARADO */}
              {pedido.estado === ESTADOS.PREPARADO && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="card card--preparacion card--compact card--centrada space-y-2">
                    <div className="subsection-title">
                      <span>Datos de preparación</span>
                    </div>
                    <div className="subsection-body preparacion-fields">
                      <div className="field-group">
                        <label className="order-label">Cantidad de bultos</label>
                        <input
                          type="number"
                          min="0"
                          className="input input--sm"
                          value={bultos}
                          onChange={e => setBultos(e.target.value)}
                        />
                      </div>

                      <div className="field-group">
                        <label className="order-label">Cantidad de paquetes</label>
                        <input
                          type="number"
                          min="0"
                          className="input input--sm"
                          value={paquetes}
                          onChange={e => setPaquetes(e.target.value)}
                        />
                      </div>

                      <button
                        className="btn btn--sm w-full bg-black text-white"
                        onClick={guardarBultosYPaquetes}
                      >
                        Guardar datos
                      </button>
                    </div>
                  </div>


                  <button
                    className="btn bg-black text-white disabled:opacity-60"
                    onClick={confirmControl}
                    disabled={!allChecked || saving}
                  >
                    Confirmar control
                  </button>
                  <button
                    className="btn btn--outline"
                    onClick={() => setShowErrForm(v => !v)}
                  >
                    {showErrForm ? "Cancelar" : "Error en la preparación"}
                  </button>

                  {showErrForm && (
                    <div className="card" style={{ marginTop: 8 }}>
                      <div className="subsection-title"><span>Reportar error</span></div>
                      <div className="subsection-body space-y-2">
                        <p className="text-sm muted">
                          Se guardará el pedido, el responsable y la fecha del reporte.
                        </p>
                        <textarea
                          className="w-full border rounded px-3 py-2"
                          rows={4}
                          placeholder="Describe el error…"
                          value={detalleErr}
                          onChange={(e)=>setDetalleErr(e.target.value)}
                        />
                        <button
                          className="btn w-full bg-black text-white disabled:opacity-60"
                          onClick={submitErrorPreparacion}
                          disabled={savingErr || !detalleErr.trim()}
                        >
                          Guardar reporte
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}




      {/* === Vista según estado === */}

      {pedido.estado === ESTADOS.PENDIENTE_ASIGNAR && (
        <div className="space-y-3">
          <div className="card">
            <div className="subsection-title">
              <span>Asignación</span>
            </div>

            <div className="subsection-body space-y-3">
              <p className="text-sm muted">
                Depósito: <b>{pedido.deposito || "—"}</b>. Elegí un responsable para este pedido.
              </p>

              {/* SELECT nativo (grande y tocable) */}
              <label className="order-label" htmlFor="op-select">Operario responsable</label>
              {loadingOps ? (
                <div className="muted">Cargando operarios…</div>
              ) : (
                <select
                  id="op-select"
                  className="w-full border rounded px-3 py-3 text-base"
                  value={selectedOperario?.uid || ""}
                  onChange={(e) => {
                    const uid = e.target.value;
                    const o = operarios.find(x => x.id === uid);
                    setSelectedOperario(uid ? { uid, nombre: (o?.nombre || o?.email || "Operario") } : null);
                  }}
                  disabled={!puedeAsignarAlguien || saving}
                >
                  <option value="">— Seleccionar —</option>
                  {/* agrupado alfabético simple */}
                  {operarios
                    .slice()
                    .sort((a,b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                    .map(o => (
                      <option key={o.id} value={o.id}>
                        {o.nombre || o.email}
                      </option>
                    ))}
                </select>
              )}

              {/* Resumen de selección */}
              <div className="order-field">
                <span className="order-label">Seleccionado</span>
                <span className="order-value">
                  {selectedOperario?.nombre || "—"}
                </span>
              </div>

              {/* Acciones: apiladas (mobile-first) */}
              <div className="flex flex-col gap-3">
                <button
                  className="btn btn--asignacion-secundaria"
                  onClick={handleAutoAsignarme}
                  disabled={!puedeAutoAsignarse || saving}
                >
                  Auto-asignarme
                </button>

                <button
                  className={`btn btn--asignacion-principal ${(!puedeAsignarAlguien || !selectedOperario || saving) ? "btn-disabled" : ""}`}
                  onClick={handleConfirmarAsignacion}
                  disabled={!puedeAsignarAlguien || !selectedOperario || saving}
                >
                  Confirmar asignación
                </button>
              </div>

              {/* Ayuda contextual */}
              {!puedeAsignarAlguien && (
                <p className="text-xs muted">
                  Solo un <b>encargado</b> puede asignar operarios.
                </p>
              )}
            </div>
          </div>
        </div>
      )}



      {pedido.estado === ESTADOS.ASIGNADO && (
        <div className="card space-y-3">
          <div>
            <p className="text-sm text-gray-600 mb-1">
              Responsable: <b>{pedido.operarioNombre || "—"}</b>
            </p>
            {isEncargado && !cambiandoOperario && (
              <button
                className="btn btn--outline btn-sm"
                onClick={() => setCambiandoOperario(true)}
              >
                Cambiar operario
              </button>
            )}
          </div>

          {cambiandoOperario && (
            <div className="space-y-2">
              <label className="order-label" htmlFor="select-op">Nuevo operario</label>
              <select
                id="select-op"
                className="w-full border rounded px-3 py-2"
                value={selectedOperario?.uid || ""}
                onChange={(e) => {
                  const uid = e.target.value;
                  const op = operarios.find(o => o.id === uid);
                  setSelectedOperario(uid ? { uid, nombre: op?.nombre || op?.email || "Operario" } : null);
                }}
              >
                <option value="">— Seleccionar —</option>
                {operarios
                    .slice()
                    .sort((a,b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                    .map(o => (
                      <option key={o.id} value={o.id}>
                        {o.nombre || o.email}
                      </option>
                    ))}
              </select>

              <div className="flex gap-2">
                <button
                  className="btn btn--outline flex-1"
                  onClick={() => setCambiandoOperario(false)}
                >
                  Cancelar
                </button>

                <button
                  className="btn flex-1 bg-black text-white disabled:opacity-60"
                  disabled={!selectedOperario?.uid}
                  onClick={async () => {
                    try {
                      setSaving(true);
                      await asignarOperario(id, selectedOperario.uid, selectedOperario.nombre || "Operario");
                      toast.success("Operario reasignado");
                      setPedido(prev => prev ? {
                        ...prev,
                        operarioId: selectedOperario.uid,
                        operarioNombre: selectedOperario.nombre
                      } : prev);
                      setCambiandoOperario(false);
                    } catch (e) {
                      console.error(e);
                      toast.error("No se pudo reasignar");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Confirmar cambio
                </button>
              </div>
            </div>
          )}

          <button
            className="w-full py-3 rounded bg-black text-white disabled:opacity-60"
            onClick={onComenzar}
            disabled={saving}
          >
            {saving ? "Iniciando…" : "Comenzar preparación"}
          </button>
        </div>
      )}


      {pedido.estado === ESTADOS.EN_PREPARACION && (
        <EncPreparacionPanel
          pedido={pedido}
          productos={productos}
          catalogIndex={catalogoMap}                  // mapa { codUru -> {customerNo, finish, ...} }
          onPreparacionFinalizada={async () => {      // qué hacer cuando se termina
            try {
              await updateEstado(id, ESTADOS.PREPARADO);
              setPedido(prev => prev ? { ...prev, estado: ESTADOS.PREPARADO } : prev);
              toast.success("Pedido preparado");
            } catch (e) {
              toast.error(e?.message || "No se pudo finalizar la preparación");
            }
          }}
        />
      )}




      {pedido.estado === ESTADOS.CONTROLADO && (
        isVentas ? (
          // === CONTROLADO — VENTAS ===
          <>
            {/* Acción principal para ventas */}
            <div className="card">
              <div className="order-body">
                
                  <ConfirmarDespacho pedidoId={id} />
                
              </div>
            </div>
          </>
        ) : (
          // === CONTROLADO — ENCARGADO ===
          <div className="card">
            <p className="text-sm text-gray-600 mb-2">
              Estado: <b>CONTROLADO</b>. Listo para despacho.
            </p>
          </div>
        )
      )}
  


      {pedido.estado === ESTADOS.DESPACHADO && (
        <div className="card">
          <p className="text-sm text-gray-600 mb-2">
            Estado: <b>DESPACHADO</b>. Pedido finalizado.
          </p>
        </div>
      )}
    </div>
  );
}
