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

// Categorías del operario — singular y plural para compatibilidad con Firestore
const CAT_OPERARIO = ["PERFIL ALUMINIO", "PERFILES ALUMINIO", "KITS"];

// Normaliza categoría: usa "padre" cuando categoria es genérica o vacía
function getCategoriaEnc(uru, catalogoMap) {
  const doc = catalogoMap?.[uru];
  const cat = (doc?.categoria || "").toUpperCase().trim();
  const padre = (doc?.padre || "").toUpperCase().trim();
  if (cat && cat !== "SIN_CATEGORIA") return cat;
  return padre;
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

  const role = (profile?.rol || "").toLowerCase();
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
  const [elevarProblema, setElevarProblema] = useState(false);
  const [notaElevacion, setNotaElevacion] = useState("");
  const [savingProblema, setSavingProblema] = useState(false);
  const [showAnularModal, setShowAnularModal] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");
  const [savingAnulacion, setSavingAnulacion] = useState(false);




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
  async function anularPedido() {
    if (!motivoAnulacion.trim()) return;
    try {
      setSavingAnulacion(true);
      await updateDoc(doc(db, "pedidos", id), {
        estado: "ANULADO",
        anuladoAt: serverTimestamp(),
        anuladoMotivo: motivoAnulacion.trim(),
        anuladoOrigen: "encargado-manual",
        anuladoPor: profile?.uid || null,
        updatedAt: serverTimestamp(),
      });
      toast.success("Pedido anulado");
      setShowAnularModal(false);
      navigate("/pedidos");
    } catch (e) {
      console.error(e);
      toast.error("Error al anular el pedido");
    } finally {
      setSavingAnulacion(false);
    }
  }

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
        // Consultamos ambos campos para compatibilidad con documentos viejos (role) y nuevos (rol)
        const [snapRol, snapRole] = await Promise.all([
          getDocs(query(collection(db, "users"), where("rol", "==", "operario"), where("deposito", "==", pedido.deposito))),
          getDocs(query(collection(db, "users"), where("role", "==", "operario"), where("deposito", "==", pedido.deposito))),
        ]);
        if (cancelled) return;
        const seen = new Set();
        const list = [...snapRol.docs, ...snapRole.docs]
          .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
          .map(d => ({ id: d.id, ...d.data() }));
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

  // ── Vista especial PENDIENTE_ASIGNAR para encargado ──────────────────────
  if (pedido.estado === ESTADOS.PENDIENTE_ASIGNAR) {
    const { operario: prodsOperario, encargado: prodsEncargado } = splitPorCategoria(productos, catalogoMap);
    const catalogoListo = Object.keys(catalogoMap).length > 0;

    const getNombre = (it, uru) => {
      const desc = it.descripcion || it.desc || it.nombre || "";
      if (desc) return desc;
      return catalogoMap?.[uru]?.customerNo || uru || "—";
    };
    const getColor = (uru) => catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";

    const formatFecha = (f) => {
      if (!f) return "—";
      // Soporta "YYYY-MM-DD" y "DD/MM/YYYY"
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const ProductRow = ({ it, uru }) => {
      const nombre = getNombre(it, uru);
      const color = getColor(uru);
      const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {nombre}
            </p>
            {color && <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
          </div>
          <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>
            ×{qty}
          </span>
        </div>
      );
    };

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef3c7", color: "#92400e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              PENDIENTE
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 16px 0" }}>

          {/* ── Contenido del pedido ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido del pedido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>

          {/* Sección operario */}
          {prodsOperario.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", padding: "3px 8px", borderRadius: "999px", letterSpacing: "0.05em" }}>
                  OPERARIO
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Perfiles y Kits · {prodsOperario.length} ítem{prodsOperario.length !== 1 ? "s" : ""}</span>
              </div>
              {prodsOperario.map(({ it, uru }, i) => (
                <ProductRow key={`op-${uru}-${i}`} it={it} uru={uru} />
              ))}
            </div>
          )}

          {/* Sección encargado */}
          {prodsEncargado.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, background: "#ffedd5", color: "#9a3412", padding: "3px 8px", borderRadius: "999px", letterSpacing: "0.05em" }}>
                  ENCARGADO
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Accesorios / PVC / Otros · {prodsEncargado.length} ítem{prodsEncargado.length !== 1 ? "s" : ""}</span>
              </div>
              {prodsEncargado.map(({ it, uru }, i) => (
                <ProductRow key={`enc-${uru}-${i}`} it={it} uru={uru} />
              ))}
            </div>
          )}

          {/* Si el catálogo no cargó todavía, mostrar todos sin categorizar */}
          {!catalogoListo && productos.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.72rem", color: "#94a3b8" }}>Cargando categorías…</p>
              {productos.map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                return <ProductRow key={i} it={it} uru={uru} />;
              })}
            </div>
          )}

          {productos.length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>Sin productos registrados.</p>
          )}

          {/* ── Asignar operario ── */}
          <p style={{ margin: "18px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Asignar responsable
          </p>

          {loadingOps ? (
            <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Cargando operarios…</p>
          ) : operarios.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", textAlign: "center" }}>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>No hay operarios disponibles para el depósito <strong>{pedido.deposito}</strong>.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
              {operarios
                .slice()
                .sort((a, b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                .map(o => {
                  const selected = selectedOperario?.uid === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedOperario(selected ? null : { uid: o.id, nombre: o.nombre || o.email || "Operario" })}
                      disabled={!puedeAsignarAlguien || saving}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "14px 16px", textAlign: "left", width: "100%",
                        background: selected ? "#eff6ff" : "#fff",
                        border: `1.5px solid ${selected ? "#3b82f6" : "#e2e8f0"}`,
                        borderRadius: "12px", cursor: "pointer",
                        transition: "all 0.15s ease",
                        boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
                      }}
                    >
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                        background: selected ? "#3b82f6" : "#f1f5f9",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.85rem", fontWeight: 700, color: selected ? "#fff" : "#64748b",
                        transition: "all 0.15s ease",
                      }}>
                        {(o.nombre || o.email || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: selected ? "#1d4ed8" : "#1e293b" }}>
                          {o.nombre || o.email}
                        </p>
                        {o.deposito && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>Depósito {o.deposito}</p>}
                      </div>
                      {selected && (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                          <circle cx="9" cy="9" r="9" fill="#3b82f6"/>
                          <path d="M5 9l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
            </div>
          )}

          {/* Auto-asignarme */}
          {puedeAutoAsignarse && (
            <button
              type="button"
              onClick={handleAutoAsignarme}
              disabled={saving}
              style={{
                width: "100%", padding: "12px", marginBottom: "8px",
                background: "transparent", border: "1.5px dashed #cbd5e1",
                borderRadius: "12px", color: "#475569",
                fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              {saving ? "Guardando…" : "Tomarme el pedido yo mismo"}
            </button>
          )}

          {!puedeAsignarAlguien && !puedeAutoAsignarse && (
            <p style={{ fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
              Solo un encargado puede asignar operarios.
            </p>
          )}
        </div>

        {/* ── CTA fijo ── */}
        {puedeAsignarAlguien && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              type="button"
              onClick={handleConfirmarAsignacion}
              disabled={!selectedOperario || saving}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                fontWeight: 700, fontSize: "1rem",
                background: selectedOperario ? "#0f172a" : "#e2e8f0",
                color: selectedOperario ? "#fff" : "#94a3b8",
                cursor: selectedOperario ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
              }}
            >
              {saving ? "Asignando…" : selectedOperario ? `Asignar a ${selectedOperario.nombre}` : "Seleccioná un operario"}
            </button>
          </div>
        )}
      </div>
    );
  }
  // ── Fin vista PENDIENTE_ASIGNAR ──────────────────────────────────────────

  // ── Vista especial ASIGNADO para encargado ───────────────────────────────
  if (pedido.estado === ESTADOS.ASIGNADO && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    // Tiempo transcurrido desde asignación
    const getElapsedStr = () => {
      const ts = pedido.timestamps?.ASIGNADO;
      if (!ts) return null;
      const asignadoAt = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(asignadoAt)) return null;
      const mins = Math.floor((Date.now() - asignadoAt.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const elapsed = getElapsedStr();

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario sin nombre";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: cambiandoOperario ? "88px" : "24px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dbeafe", color: "#1e40af", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              ASIGNADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Operario asignado ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Responsable de preparación
          </p>

          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0,
                background: "#3b82f6",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem", fontWeight: 700, color: "#fff",
              }}>
                {avatarInitial}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                  {operarioNombre}
                </p>
                {elapsed && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    🕐 Asignado {elapsed}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Resumen del pedido ── */}
          <p style={{ margin: "16px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.slice(0, 5).map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < Math.min(productos.length, 5) - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nombre}
                    </p>
                    <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>
                      ×{qty}
                    </span>
                  </div>
                );
              })
            )}
            {productos.length > 5 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
                y {productos.length - 5} productos más…
              </p>
            )}
          </div>

          {/* ── Cambiar operario ── */}
          {!cambiandoOperario ? (
            <button
              type="button"
              onClick={() => setCambiandoOperario(true)}
              style={{
                width: "100%", padding: "12px", marginBottom: "8px",
                background: "transparent", border: "1.5px dashed #cbd5e1",
                borderRadius: "12px", color: "#475569",
                fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              Cambiar operario
            </button>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  Elegir nuevo operario
                </p>
                <button
                  type="button"
                  onClick={() => { setCambiandoOperario(false); setSelectedOperario(null); }}
                  style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "0.8rem", cursor: "pointer", padding: "4px 8px" }}
                >
                  Cancelar
                </button>
              </div>

              {loadingOps ? (
                <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Cargando operarios…</p>
              ) : operarios.length === 0 ? (
                <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", textAlign: "center" }}>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>No hay operarios disponibles.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
                  {operarios
                    .slice()
                    .sort((a, b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                    .map(o => {
                      const selected = selectedOperario?.uid === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setSelectedOperario(selected ? null : { uid: o.id, nombre: o.nombre || o.email || "Operario" })}
                          disabled={saving}
                          style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "14px 16px", textAlign: "left", width: "100%",
                            background: selected ? "#eff6ff" : "#fff",
                            border: `1.5px solid ${selected ? "#3b82f6" : "#e2e8f0"}`,
                            borderRadius: "12px", cursor: "pointer",
                            transition: "all 0.15s ease",
                            boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
                          }}
                        >
                          <div style={{
                            width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                            background: selected ? "#3b82f6" : "#f1f5f9",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "0.85rem", fontWeight: 700, color: selected ? "#fff" : "#64748b",
                            transition: "all 0.15s ease",
                          }}>
                            {(o.nombre || o.email || "?")[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: selected ? "#1d4ed8" : "#1e293b" }}>
                              {o.nombre || o.email}
                            </p>
                            {o.deposito && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>Depósito {o.deposito}</p>}
                          </div>
                          {selected && (
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                              <circle cx="9" cy="9" r="9" fill="#3b82f6"/>
                              <path d="M5 9l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── CTA fijo — confirmar cambio de operario ── */}
        {cambiandoOperario && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              type="button"
              disabled={!selectedOperario || saving}
              onClick={async () => {
                try {
                  setSaving(true);
                  await asignarOperario(id, selectedOperario.uid, selectedOperario.nombre || "Operario");
                  toast.success("Operario reasignado");
                  setPedido(prev => prev ? { ...prev, operarioId: selectedOperario.uid, operarioNombre: selectedOperario.nombre } : prev);
                  setCambiandoOperario(false);
                  setSelectedOperario(null);
                } catch (e) {
                  console.error(e);
                  toast.error("No se pudo reasignar el operario");
                } finally {
                  setSaving(false);
                }
              }}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                fontWeight: 700, fontSize: "1rem",
                background: selectedOperario ? "#0f172a" : "#e2e8f0",
                color: selectedOperario ? "#fff" : "#94a3b8",
                cursor: selectedOperario ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
              }}
            >
              {saving ? "Guardando…" : selectedOperario ? `Reasignar a ${selectedOperario.nombre}` : "Elegí un operario"}
            </button>
          </div>
        )}
      </div>
    );
  }
  // ── Fin vista ASIGNADO ───────────────────────────────────────────────────

  // ── Vista especial EN_PREPARACION para encargado ─────────────────────────
  if (pedido.estado === ESTADOS.EN_PREPARACION && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const problema = pedido.problema || null;
    const tieneProblemaActivo = problema && problema.estado === "PENDIENTE";
    const tieneProblemaElevado = problema && problema.estado === "ELEVADO";
    const tieneProblemaRevisado = problema && problema.estado === "REVISADO";

    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const elapsedPrep = getElapsedStr(pedido.timestamps?.EN_PREPARACION || pedido.timestamps?.ASIGNADO);

    async function marcarProblemaRevisado() {
      try {
        setSavingProblema(true);
        await updateDoc(doc(db, "pedidos", pedido.id || id), {
          "problema.estado": "REVISADO",
        });
        setPedido(prev => prev ? { ...prev, problema: { ...prev.problema, estado: "REVISADO" } } : prev);
      } catch (e) {
        toast.error("No se pudo marcar como revisado");
      } finally {
        setSavingProblema(false);
      }
    }

    async function confirmarElevacion() {
      try {
        setSavingProblema(true);
        await updateDoc(doc(db, "pedidos", pedido.id || id), {
          "problema.estado": "ELEVADO",
          "problema.notaEncargado": notaElevacion.trim(),
          "problema.elevadoAt": serverTimestamp(),
        });
        setPedido(prev => prev ? {
          ...prev,
          problema: { ...prev.problema, estado: "ELEVADO", notaEncargado: notaElevacion.trim() },
        } : prev);
        setElevarProblema(false);
        setNotaElevacion("");
        toast.success("Problema elevado al vendedor");
      } catch (e) {
        toast.error("No se pudo elevar el problema");
      } finally {
        setSavingProblema(false);
      }
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: elevarProblema ? "120px" : "24px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef9c3", color: "#854d0e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              EN PREPARACIÓN
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Banner de problema activo ── */}
          {tieneProblemaActivo && (
            <div style={{ background: "#fff7ed", border: "1.5px solid #fb923c", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.92rem", color: "#9a3412" }}>
                  Problema reportado por {problema.reportadoNombre || "el operario"}
                </p>
                <span style={{ marginLeft: "auto", flexShrink: 0, background: problema.tipo === "FALTA_STOCK" ? "#fef2f2" : "#fef3c7", color: problema.tipo === "FALTA_STOCK" ? "#dc2626" : "#92400e", fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {problema.tipo === "FALTA_STOCK" ? "Falta stock" : "Otro"}
                </span>
              </div>
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#7c2d12", fontWeight: 600 }}>
                Producto: {problema.productoNombre || "—"}
              </p>
              {problema.descripcion && (
                <p style={{ margin: "4px 0 12px", fontSize: "0.82rem", color: "#9a3412", fontStyle: "italic" }}>
                  "{problema.descripcion}"
                </p>
              )}

              {!elevarProblema ? (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={marcarProblemaRevisado}
                    disabled={savingProblema}
                    style={{ flex: 1, padding: "10px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#475569", cursor: "pointer" }}
                  >
                    {savingProblema ? "…" : "Marcar revisado"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setElevarProblema(true)}
                    style={{ flex: 1, padding: "10px", background: "#dc2626", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#fff", cursor: "pointer" }}
                  >
                    Elevar al vendedor
                  </button>
                </div>
              ) : (
                <div>
                  <textarea
                    value={notaElevacion}
                    onChange={e => setNotaElevacion(e.target.value)}
                    placeholder="Agregá una nota para el vendedor (opcional)…"
                    style={{ width: "100%", minHeight: "70px", padding: "10px", border: "1.5px solid #fca5a5", borderRadius: "10px", fontSize: "0.85rem", resize: "none", boxSizing: "border-box", marginBottom: "8px", background: "#fff" }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => { setElevarProblema(false); setNotaElevacion(""); }}
                      style={{ flex: 1, padding: "10px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#475569", cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmarElevacion}
                      disabled={savingProblema}
                      style={{ flex: 1, padding: "10px", background: "#dc2626", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#fff", cursor: "pointer" }}
                    >
                      {savingProblema ? "Enviando…" : "Confirmar y elevar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Banner problema elevado ── */}
          {tieneProblemaElevado && (
            <div style={{ background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📨</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem", color: "#1e40af" }}>
                  Problema elevado al vendedor
                </p>
                {problema.notaEncargado && (
                  <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#3b82f6", fontStyle: "italic" }}>"{problema.notaEncargado}"</p>
                )}
              </div>
            </div>
          )}

          {/* ── Banner problema revisado ── */}
          {tieneProblemaRevisado && (
            <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>✓</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem", color: "#64748b" }}>
                  Problema revisado — en seguimiento
                </p>
              </div>
            </div>
          )}

          {/* ── Operario preparando ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Preparando el pedido
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0,
                background: "#f59e0b",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem", fontWeight: 700, color: "#fff",
              }}>
                {avatarInitial}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                  {operarioNombre}
                </p>
                {elapsedPrep && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    🕐 Preparando {elapsedPrep}
                  </p>
                )}
              </div>
              <div style={{ flexShrink: 0, width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 0 3px #fef3c7" }} />
            </div>
          </div>

          {/* ── Productos del pedido ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.slice(0, 5).map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                const esProblemático = problema && problema.productoIdx === i;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < Math.min(productos.length, 5) - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: esProblemático ? "#dc2626" : "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {esProblemático && "⚠️ "}{nombre}
                    </p>
                    <span style={{ flexShrink: 0, background: esProblemático ? "#fef2f2" : "#f1f5f9", color: esProblemático ? "#dc2626" : "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>
                      ×{qty}
                    </span>
                  </div>
                );
              })
            )}
            {productos.length > 5 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
                y {productos.length - 5} más…
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  // ── Fin vista EN_PREPARACION ──────────────────────────────────────────────

  // ── Vista especial PREPARADO para encargado ──────────────────────────────
  if (pedido.estado === ESTADOS.PREPARADO && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const { operario: prodsOperario, encargado: prodsEncargado } = splitPorCategoria(productos, catalogoMap);

    // Checkboxes solo para productos del encargado (accesorios)
    const allAccChecked = prodsEncargado.length === 0 ||
      prodsEncargado.every((_, i) => !!accChecks[`acc-${i}`]);

    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const elapsedPrep = getElapsedStr(pedido.timestamps?.PREPARADO);

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dcfce7", color: "#166534", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              PREPARADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Preparado por ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Preparado por
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
                {avatarInitial}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>{operarioNombre}</p>
                {elapsedPrep && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>✓ Listo {elapsedPrep}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Productos del operario (solo vista) ── */}
          {prodsOperario.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Perfiles y kits · {prodsOperario.length} ítem{prodsOperario.length !== 1 ? "s" : ""}
              </p>
              <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: "14px", padding: "12px 16px", marginBottom: "12px" }}>
                {prodsOperario.map(({ it, uru }, i) => {
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                  const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < prodsOperario.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "0.86rem", fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                        {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        <span style={{ background: "#dbeafe", color: "#1d4ed8", fontWeight: 700, fontSize: "0.78rem", padding: "2px 8px", borderRadius: "6px" }}>×{qty}</span>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="#16a34a"/><path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Accesorios — control del encargado ── */}
          {prodsEncargado.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Accesorios / otros · verificar · {prodsEncargado.length} ítem{prodsEncargado.length !== 1 ? "s" : ""}
              </p>
              <div style={{ background: "#fff", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "12px 16px", marginBottom: "12px" }}>
                {prodsEncargado.map(({ it, uru }, i) => {
                  const key = `acc-${i}`;
                  const checked = !!accChecks[key];
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                  const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAccChecks(prev => ({ ...prev, [key]: !prev[key] }))}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        width: "100%", textAlign: "left", padding: "10px 0",
                        background: "transparent", border: "none", cursor: "pointer",
                        borderBottom: i < prodsEncargado.length - 1 ? "1px solid #f1f5f9" : "none",
                      }}
                    >
                      <div style={{
                        flexShrink: 0, width: "24px", height: "24px", borderRadius: "6px",
                        border: `2px solid ${checked ? "#16a34a" : "#e2e8f0"}`,
                        background: checked ? "#16a34a" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.12s ease",
                      }}>
                        {checked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "0.86rem", fontWeight: 500, color: checked ? "#64748b" : "#1e293b", textDecoration: checked ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                        {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                      </div>
                      <span style={{ flexShrink: 0, background: checked ? "#dcfce7" : "#fff7ed", color: checked ? "#15803d" : "#c2410c", fontWeight: 700, fontSize: "0.78rem", padding: "2px 8px", borderRadius: "6px" }}>
                        ×{qty}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Datos de preparación ── */}
          <p style={{ margin: "4px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Datos de preparación
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>Bultos</label>
                <input
                  type="number" min="0"
                  value={bultos}
                  onChange={e => setBultos(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "1rem", fontWeight: 600, textAlign: "center", boxSizing: "border-box" }}
                  placeholder="0"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>Paquetes</label>
                <input
                  type="number" min="0"
                  value={paquetes}
                  onChange={e => setPaquetes(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "1rem", fontWeight: 600, textAlign: "center", boxSizing: "border-box" }}
                  placeholder="0"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={guardarBultosYPaquetes}
              style={{ marginTop: "10px", width: "100%", padding: "9px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
            >
              Guardar datos
            </button>
          </div>
        </div>

        {/* ── CTA fijo ── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
          {!allAccChecked && prodsEncargado.length > 0 && (
            <p style={{ margin: "0 0 8px", textAlign: "center", fontSize: "0.78rem", color: "#94a3b8" }}>
              Verificá {prodsEncargado.filter((_, i) => !accChecks[`acc-${i}`]).length} accesorio{prodsEncargado.filter((_, i) => !accChecks[`acc-${i}`]).length !== 1 ? "s" : ""} pendiente{prodsEncargado.filter((_, i) => !accChecks[`acc-${i}`]).length !== 1 ? "s" : ""}
            </p>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                setSaving(true);
                await updateDoc(doc(db, "pedidos", id), { prepAccesoriosOk: true });
                await updateEstado(id, ESTADOS.CONTROLADO);
                haptics?.success?.();
                toast.success("Pedido controlado ✓");
                setPedido(prev => prev ? { ...prev, estado: ESTADOS.CONTROLADO } : prev);
              } catch (e) {
                toast.error("No se pudo confirmar el control");
              } finally {
                setSaving(false);
              }
            }}
            disabled={!allAccChecked || saving}
            style={{
              width: "100%", padding: "15px", borderRadius: "14px", border: "none",
              fontWeight: 700, fontSize: "1rem",
              background: allAccChecked ? "#0f172a" : "#e2e8f0",
              color: allAccChecked ? "#fff" : "#94a3b8",
              cursor: allAccChecked ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
            }}
          >
            {saving ? "Confirmando…" : "✓ Confirmar control"}
          </button>
        </div>
      </div>
    );
  }
  // ── Fin vista PREPARADO ───────────────────────────────────────────────────

  // ── Vista CONTROLADO — ENCARGADO (solo info) ─────────────────────────────
  if (pedido.estado === ESTADOS.CONTROLADO && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const operarioNombre = pedido.operarioNombre || "—";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "24px" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#ede9fe", color: "#5b21b6", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              CONTROLADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>
        <div style={{ padding: "16px" }}>
          {/* Estado */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.4rem" }}>✅</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#166534" }}>Pedido controlado y listo para despacho</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#16a34a" }}>El equipo de ventas realizará el despacho</p>
            </div>
          </div>
          {/* Preparado por */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Preparado por</p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avatarInitial}</div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.92rem", color: "#0f172a" }}>{operarioNombre}</p>
              {pedido.bultos > 0 && <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📦 {pedido.bultos} bultos</span>}
              {pedido.paquetes > 0 && <span style={{ fontSize: "0.78rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📫 {pedido.paquetes} paquetes</span>}
            </div>
          </div>
          {/* Productos */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}</p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "12px 16px" }}>
            {productos.map((it, i) => {
              const raw = it.cod || it.descripcion || it.desc || "";
              const uru = toURUCode(raw);
              const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
              const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                  <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>×{qty}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  // ── Fin vista CONTROLADO encargado ────────────────────────────────────────

  // ── Vista CONTROLADO — VENTAS (detalle completo + despacho) ──────────────
  if (pedido.estado === ESTADOS.CONTROLADO && isVentas) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const { operario: prodsOperario, encargado: prodsEncargado } = splitPorCategoria(productos, catalogoMap);
    const operarioNombre = pedido.operarioNombre || "—";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const preparadoElapsed = getElapsedStr(pedido.timestamps?.PREPARADO);

    // Timeline de estados
    const timelineEstados = [
      { key: "PENDIENTE_ASIGNAR", label: "Ingresó" },
      { key: "ASIGNADO", label: "Asignado" },
      { key: "EN_PREPARACION", label: "En preparación" },
      { key: "PREPARADO", label: "Preparado" },
      { key: "CONTROLADO", label: "Controlado" },
    ];

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/ventas/para-despachar" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#ede9fe", color: "#5b21b6", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>LISTO P/ DESPACHO</span>
          </div>
          {/* Metadata chips */}
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Timeline ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {timelineEstados.map(({ key, label }, i) => {
                const ts = pedido.timestamps?.[key];
                const at = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
                const done = !!at && !isNaN(at);
                const isCurrent = key === "CONTROLADO";
                return (
                  <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                    {i > 0 && (
                      <div style={{ position: "absolute", top: "9px", right: "50%", left: "-50%", height: "2px", background: done ? "#a855f7" : "#e2e8f0", zIndex: 0 }} />
                    )}
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%", background: isCurrent ? "#7c3aed" : done ? "#a855f7" : "#e2e8f0", border: `2px solid ${isCurrent ? "#7c3aed" : done ? "#a855f7" : "#e2e8f0"}`, zIndex: 1, position: "relative" }} />
                    <p style={{ margin: "4px 0 0", fontSize: "0.62rem", fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "#7c3aed" : done ? "#6d28d9" : "#94a3b8", textAlign: "center", lineHeight: 1.2 }}>{label}</p>
                    {done && <p style={{ margin: "1px 0 0", fontSize: "0.58rem", color: "#94a3b8", textAlign: "center" }}>{at.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Info de preparación ── */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Preparación</p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avatarInitial}</div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>{operarioNombre}</p>
                {preparadoElapsed && <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>Preparado {preparadoElapsed}</p>}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>{pedido.bultos ?? "—"}</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Bultos</p>
              </div>
              <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>{pedido.paquetes ?? "—"}</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Paquetes</p>
              </div>
              <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>{productos.length}</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Ítems</p>
              </div>
            </div>
          </div>

          {/* ── Productos — Perfiles/Kits ── */}
          {prodsOperario.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Perfiles y kits · {prodsOperario.length} ítem{prodsOperario.length !== 1 ? "s" : ""}</p>
              <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: "14px", padding: "4px 16px", marginBottom: "12px" }}>
                {prodsOperario.map(({ it, uru }, i) => {
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                  const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: i < prodsOperario.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "0.86rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                        {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                      </div>
                      <span style={{ flexShrink: 0, background: "#dbeafe", color: "#1d4ed8", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Productos — Accesorios/Otros ── */}
          {prodsEncargado.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Accesorios y otros · {prodsEncargado.length} ítem{prodsEncargado.length !== 1 ? "s" : ""}</p>
              <div style={{ background: "#fff", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "4px 16px", marginBottom: "16px" }}>
                {prodsEncargado.map(({ it, uru }, i) => {
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                  const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: i < prodsEncargado.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "0.86rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                        {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                      </div>
                      <span style={{ flexShrink: 0, background: "#ffedd5", color: "#c2410c", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Si el catálogo no cargó: lista sin categorizar */}
          {Object.keys(catalogoMap).length === 0 && productos.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Productos · {productos.length} ítems</p>
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "4px 16px", marginBottom: "16px" }}>
                {productos.map((it, i) => {
                  const raw = it.cod || it.descripcion || it.desc || "";
                  const uru = toURUCode(raw);
                  const nombre = it.descripcion || it.desc || it.nombre || uru || "—";
                  const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                      <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── CTA fijo: Despachar ── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
          <ConfirmarDespacho pedidoId={id} />
        </div>
      </div>
    );
  }
  // ── Fin vista CONTROLADO ventas ───────────────────────────────────────────

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

      {/* ── Botón anular — solo encargado, solo pedidos no finalizados ── */}
      {isEncargado && pedido.estado !== ESTADOS.DESPACHADO && pedido.estado !== "ANULADO" && (
        <div style={{ marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed #e2e8f0" }}>
          <button
            onClick={() => { setMotivoAnulacion(""); setShowAnularModal(true); }}
            style={{
              width: "100%", padding: "10px", fontSize: "13px", fontWeight: 600,
              background: "none", border: "1.5px solid #fca5a5", color: "#dc2626",
              borderRadius: "8px", cursor: "pointer",
            }}
          >
            🚫 Anular pedido
          </button>
        </div>
      )}

      {/* ── Modal confirmación anulación ── */}
      {showAnularModal && (
        <div
          onClick={() => setShowAnularModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: "24px 20px" }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: 700, color: "#dc2626" }}>
              🚫 Anular pedido #{pedido.numero || id}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#64748b" }}>
              Esta acción no se puede deshacer. El pedido dejará de aparecer en la lista operativa.
            </p>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
              Motivo de anulación *
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="Ej: Pedido duplicado, cliente canceló, error en el pedido…"
              value={motivoAnulacion}
              onChange={e => setMotivoAnulacion(e.target.value)}
              style={{ fontSize: "14px", resize: "none", marginBottom: "14px" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setShowAnularModal(false)}
                className="btn btn--ghost"
                style={{ flex: 1 }}
              >
                Cancelar
              </button>
              <button
                onClick={anularPedido}
                disabled={savingAnulacion || !motivoAnulacion.trim()}
                className="btn btn--danger"
                style={{ flex: 2 }}
              >
                {savingAnulacion ? "Anulando…" : "Confirmar anulación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
