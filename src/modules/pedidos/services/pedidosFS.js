// src/modules/pedidos/services/pedidosFS.js
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { ESTADOS } from "./estados";
import { onAuthStateChanged, getAuth } from "firebase/auth";


function isPlainObject(o) {
  return o && typeof o === "object" && !Array.isArray(o);
}

// ─────────────────────────────────────────────────────────────────
// Helpers internos para detectar cambios de productos (sync Finnegans)
// ─────────────────────────────────────────────────────────────────
function _extractCode(item) {
  if (!item) return null;
  const raw = item.cod || item.codigo || item.codigoURU || item.ProductoCodigo || "";
  const s = String(raw).trim();
  const m = s.match(/\b\d{7,}\b/);
  const code = m ? m[0] : s.split(/\s+/)[0].replace(/[^\w-]/g, "");
  return code || null;
}
function _extractQty(item) {
  const v = item.cant ?? item.cantidad ?? item.qty ?? item.Cantidad ?? 0;
  return Number(v) || 0;
}
function _extractNombre(item) {
  return item.descripcion || item.desc || item.nombre || item.cod || item.codigo || _extractCode(item) || "—";
}

/**
 * Compara lista anterior vs nueva de productos.
 * Devuelve { hasChanges, added, removed, changed }.
 */
function _detectProductChanges(prevProductos, newProductos) {
  const prevMap = new Map();
  for (const it of prevProductos || []) {
    const cod = _extractCode(it);
    if (!cod) continue;
    prevMap.set(cod, { qty: _extractQty(it), item: it });
  }
  const newMap = new Map();
  for (const it of newProductos || []) {
    const cod = _extractCode(it);
    if (!cod) continue;
    newMap.set(cod, { qty: _extractQty(it), item: it });
  }

  const added = [], removed = [], changed = [];

  for (const [cod, { qty, item }] of newMap) {
    if (!prevMap.has(cod)) {
      added.push({ cod, nombre: _extractNombre(item), cant: qty });
    } else if (prevMap.get(cod).qty !== qty) {
      changed.push({ cod, nombre: _extractNombre(item), cantAntes: prevMap.get(cod).qty, cantAhora: qty });
    }
  }
  for (const [cod, { qty, item }] of prevMap) {
    if (!newMap.has(cod)) {
      removed.push({ cod, nombre: _extractNombre(item), cant: qty });
    }
  }

  return { hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0, added, removed, changed };
}

/** Quita undefined y NaN/Infinity en profundidad. Opcionalmente transforma undefined→null si preferís. */
function sanitizeForFirestore(input) {
  if (Array.isArray(input)) {
    return input.map(sanitizeForFirestore).filter((v) => v !== undefined);
  }
  if (isPlainObject(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;                 // Firestore no admite undefined
      if (typeof v === "number" && !Number.isFinite(v)) continue; // NaN/Infinity
      out[k] = sanitizeForFirestore(v);
    }
    return out;
  }
  return input;
}



// -------------------------------------------------------------
// LISTEN por depósito (encargado/ventas)
// -------------------------------------------------------------
/*export function listenPedidosByDeposito(deposito, filtros = {}) {
  console.log(
    "[listenPedidosByDeposito] deposito:",
    deposito,
    "metodo:",
    filtros?.metodoEntrega
  );
  console.log(
    "[listenPedidosByDeposito] uid al suscribir:",
    getAuth().currentUser?.uid ?? null
  );

  const col = collection(db, "pedidos");
  let qy = query(col, where("deposito", "==", deposito));
  if (filtros?.metodoEntrega) {
    qy = query(qy, where("metodoEntrega", "==", filtros.metodoEntrega));
  }

  return onSnapshot(
    qy,
    filtros?.onChange ??
      ((snapshot) => {
        console.log("[listenPedidosByDeposito] docs:", snapshot.size);
      }),
    filtros?.onError ??
      ((err) => {
        console.error("[listenPedidosByDeposito] onError:", err);
      })
  );
}*/
export function listenPedidosByDeposito(deposito, filtros = {}) {
  const auth = getAuth();

  // Defensivo: validar depósito
  if (!deposito) {
    filtros?.onError?.(new Error("DEPOSITO_REQUIRED"));
    return () => {};
  }

  // Suscribirse solo cuando haya usuario listo
  let offAuth = null;
  let offSnap = null;
  let cancelled = false;

  const subscribe = () => {
    if (cancelled) return;

    const col = collection(db, "pedidos");
    let qy = query(col,
      where("deposito", "==", deposito)
    );

    // 🔥 si se pide filtrar por estado → agregar filtro
    if (filtros?.estado) {
      qy = query(qy, where("estado", "==", filtros.estado));
    }

    // opcional: método de entrega
    if (filtros?.metodoEntrega) {
      qy = query(qy, where("metodoEntrega", "==", filtros.metodoEntrega));
    }


    offSnap = onSnapshot(
      qy,
      filtros?.onChange ?? ((snapshot) => {
        console.log("[listenPedidosByDeposito] docs:", snapshot.size);
      }),
      (err) => {
        console.warn("[listenPedidosByDeposito] onError:", err);
        filtros?.onError?.(err);
        // Importante: no relanzar ni bloquear la UI
      }
    );
  };

  // Si ya hay usuario, suscribimos directo; si no, esperamos al primer onAuthStateChanged
  if (auth.currentUser) {
    subscribe();
  } else {
    offAuth = onAuthStateChanged(auth, (u) => {
      if (!u) return;         // aún no listo → esperamos
      offAuth && offAuth();   // ya tenemos user → dejamos de escuchar Auth
      offAuth = null;
      subscribe();            // y recién ahí montamos onSnapshot
    });
  }

  // Siempre devolver un unsubscribe seguro
  return () => {
    cancelled = true;
    try { offSnap && offSnap(); } catch {}
    try { offAuth && offAuth(); } catch {}
  };
}

// One-shot por depósito (útil para pruebas/manual)
export async function getPedidosByDepositoOnce(deposito, metodoEntrega) {
  const col = collection(db, "pedidos");
  let qy = query(col, where("deposito", "==", deposito));
  if (metodoEntrega) qy = query(qy, where("metodoEntrega", "==", metodoEntrega));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
export function normalizePedidoId(n) {
  return `PEDVTA - ${String(n).trim()}`
    .replace(/\u00A0/g, " ") // NBSP -> espacio normal
    .replace(/\s+/g, " ") // colapsar espacios
    .normalize("NFC");
}

// -------------------------------------------------------------
// Upserts desde sync (no tocar reglas acá)
// -------------------------------------------------------------
export async function upsertPedidoFromSync(p) {
  const id = normalizePedidoId(p.numero);
  const ref = doc(db, "pedidos", id);
  const snap = await getDoc(ref);

  const payload = {
    id,
    numero: p.numero,
    cliente: p.cliente,
    descripcion: p.descripcion,
    deposito: p.deposito,
    metodoEntrega: p.metodoEntrega,
    productos: p.productos,
    source: "finnegans",
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...payload,
      estado: "PENDIENTE_ASIGNAR",
      timestamps: { creado: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });
    return { created: true };
  } else {
    const estadoActual = snap.data()?.estado || "PENDIENTE_ASIGNAR";

    await setDoc(ref, {
      ...payload,
      estado: estadoActual, // mantenemos el estado existente
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return { updated: true };
  }

}

export async function getPedido(id) {
  const ref = doc(db, "pedidos", id);
  const s = await getDoc(ref);
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/**
 * Asignar operario (firma simple: id + uid + nombre).
 * La regla de seguridad valida que el usuario tenga permisos y/o mismo depósito.
 */
export async function asignarOperario(pedidoId, operarioUid, operarioNombre) {
  if (!pedidoId) throw new Error("Pedido inválido");
  if (!operarioUid) throw new Error("Operario inválido");

  await updateDoc(doc(db, "pedidos", pedidoId), {
    operarioId: operarioUid,
    operarioNombre: operarioNombre || "",
    updatedAt: serverTimestamp(),
  });
}

const OP_KEYS = ["estado", "operarioId", "operarioNombre", "timestamps"];

/**
 * Upsert de sync: nunca lee. Update primero; si not-found -> create.
 * Quita siempre los campos operativos para cumplir reglas de sync.
 */
export async function upsertPedidoDesdeFinnegans(pedido) {
  if (!pedido?.id) throw new Error("pedido.id faltante");

  // === NO GUARDAR COTIZACIONES ===
  if (pedido.esCotizacion || pedido.deposito === "COTIZACION") {
    return { skipped: true };
  }

  const ref = doc(db, "pedidos", pedido.id);
  const prevSnap = await getDoc(ref);


  const prev = prevSnap.exists() ? prevSnap.data() : {};

  // === 2. ARMAR PAYLOAD BASE ===
  const updateDataRaw = {
    ...pedido,
    source: "finnegans",
    updatedAt: serverTimestamp(),
  };

  // Si el pedido existe → mantener estado existente
  // Si es nuevo → asignar PENDIENTE_ASIGNAR
  if (prevSnap.exists()) {
      // Preservar estado
      updateDataRaw.estado = prev.estado || "PENDIENTE_ASIGNAR";

      // 🚨 PRESERVAR timestamps (CLAVE PARA EL VENDEDOR)
      updateDataRaw.timestamps = prev.timestamps || {};

  } else {
      // Pedido nuevo → siempre inicia en PENDIENTE_ASIGNAR
      updateDataRaw.estado = "PENDIENTE_ASIGNAR";

      // Pedido nuevo → crear timestamps base
      updateDataRaw.timestamps = {
          creado: serverTimestamp(),
          ASIGNADO: null,
          CONTROLADO: null,
          EN_PREPARACION: null,
          PREPARADO: null,
          DESPACHADO: null
      };
    }



  // ── Detección de cambios de productos desde Finnegans ────────────────────
  // Solo aplica cuando el pedido YA existía Y su estado es distinto a
  // PENDIENTE_ASIGNAR (si todavía no fue procesado, no hace falta resetear).
  if (prevSnap.exists()) {
    const estadoActual = prev.estado || "PENDIENTE_ASIGNAR";
    const esPendiente  = estadoActual === "PENDIENTE_ASIGNAR";

    if (!esPendiente) {
      const { hasChanges, added, removed, changed } = _detectProductChanges(
        prev.productos,
        pedido.productos,
      );

      if (hasChanges) {
        // Snapshot de lo que había preparado (para pre-tildar en la vista del operario)
        const ESTADOS_CON_PREP = ["ASIGNADO", "EN_PREPARACION", "PREPARADO", "CONTROLADO"];
        const itemsPreparados = {};
        if (ESTADOS_CON_PREP.includes(estadoActual)) {
          for (const it of prev.productos || []) {
            const cod = _extractCode(it);
            if (!cod) continue;
            itemsPreparados[cod] = { cant: _extractQty(it), nombre: _extractNombre(it) };
          }
        }

        // Volver al inicio del flujo
        updateDataRaw.estado           = "PENDIENTE_ASIGNAR";
        updateDataRaw.itemsPreparados  = itemsPreparados;
        updateDataRaw.modificacionInfo = {
          at:             serverTimestamp(),
          estadoAnterior: estadoActual,
          origen:         "finnegans-sync",
          addedItems:     added,
          removedItems:   removed,
          changedItems:   changed,
        };

        // Limpiar estado de preparación anterior
        updateDataRaw.prepPerfilesOk   = null;
        updateDataRaw.prepAccesoriosOk = null;
        updateDataRaw.bultos           = null;
        updateDataRaw.paquetes         = null;
        updateDataRaw.operarioId       = null;
        updateDataRaw.operarioNombre   = null;
      }
    }
  }

  // Parse finFechaTS si viene
  if (pedido.finFecha) {
    updateDataRaw.finFecha = pedido.finFecha;
    try {
      updateDataRaw.finFechaTS = Timestamp.fromDate(
        new Date(`${pedido.finFecha}T00:00:00`)
      );
    } catch (_) { }
  }

  // === 3. SANITIZAR ===
  const updateDataFinal = sanitizeForFirestore(updateDataRaw);

  // === 4. DIFF para detección de not-found ===
  let diffKeys = Object.keys(updateDataFinal).filter(
    (k) => JSON.stringify(updateDataFinal[k]) !== JSON.stringify(prev[k])
  );

  // === 5. INTENTAR UPDATE ===
  try {
    await updateDoc(ref, updateDataFinal);

    return { created: false, id: pedido.id };

  } catch (e) {
    // Ver si es NOT FOUND para pasar a CREATE
    const code = String(e?.code || e?.message || "").toLowerCase();
    const isNotFound =
      code.includes("not-found") ||
      code.includes("no document to update");

    if (!isNotFound) throw e;
  }

  // === 7. CREATE si no existía ===
  const createData = sanitizeForFirestore({
    ...updateDataFinal,
    source: "finnegans",
    timestamps: { creado: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(ref, createData, { merge: false });
  } catch (e) {
    console.error("⛔ CREATE FAILED for", pedido.id, e);
    throw e;
  }

  return { created: true, id: pedido.id };
}



export async function actualizarPedidosControladosADespachado(numerosFin) {
  try {
    // Normalizador de número (quita prefijo "PEDVTA -")
    const normalizeNumero = (x) =>
      String(x).replace(/\u00A0/g, " ").replace(/^PEDVTA\s*-\s*/i, "").trim();

    // Preparamos el set de números válidos que siguen en Finnegans
    const finNums = (Array.isArray(numerosFin) ? numerosFin : [])
      .map(normalizeNumero)
      .filter(Boolean);
    const finSet = new Set(finNums);


    // Traemos todos los pedidos CONTROLADO
    const qy = query(collection(db, "pedidos"), where("estado", "==", "CONTROLADO"));
    const snap = await getDocs(qy);

    let updated = 0;
    let skipped = 0;

    // Iteramos por cada pedido
    for (const docSnap of snap.docs) {
      const p = docSnap.data();
      const numero = normalizeNumero(p?.numero ?? "");

      if (!numero) {
        skipped++;
        continue;
      }

      // Si el pedido ya no está en Finnegans → debe pasar a DESPACHADO
      if (!finSet.has(numero)) {
        const ref = doc(db, "pedidos", docSnap.id);

        // Payload para rama SYNC
        const payloadSync = {
          estado: "DESPACHADO",
          source: "finnegans",
          updatedAt: serverTimestamp(),
          timestamps: { DESPACHADO: serverTimestamp() },
        };

        try {
          await updateDoc(ref, payloadSync);
        } catch (eSync) {
          const msg = (eSync?.code || eSync?.message || "").toString().toLowerCase();
          console.warn("[ADESP] SYNC falló, probamos rama Ventas:", msg);

          // Intento B: rama Ventas
          const uid = getAuth().currentUser?.uid || null;
          const payloadVentas = {
            estado: "DESPACHADO",
            updatedAt: serverTimestamp(),
            timestamps: { DESPACHADO: serverTimestamp() },
            despachadoPor: uid,
            despachadoAt: serverTimestamp(),
          };

          try {
            await updateDoc(ref, payloadVentas);
          } catch (eVentas) {
            console.error("[ADESP] Permiso denegado en ambos intentos:", {
              id: docSnap.id,
              numero,
              error: eVentas?.code || eVentas?.message,
            });
          }
        }

        updated++;
      }
    }

  } catch (error) {
    console.error("❌ [ADESP] Error al actualizar pedidos controlados:", error);
  }
}




  


/**
 * Cambiar estado (operacional)
 * - Actualiza estado
 * - updatedAt
 * - timestamps.<ESTADO>
 */
export async function updateEstado(pedidoId, nuevoEstado) {
  if (!pedidoId) throw new Error("Pedido inválido");
  if (!nuevoEstado) throw new Error("Estado inválido");
  const ref = doc(db, "pedidos", pedidoId);
  await updateDoc(ref, {
    estado: nuevoEstado,
    updatedAt: serverTimestamp(),
    [`timestamps.${nuevoEstado}`]: serverTimestamp(),
  });
}

// -------------------------------------------------------------
// LISTEN por operario (vista operario)
// -------------------------------------------------------------
export function listenPedidosAsignadosOperario(operarioId, opts = {}) {
  const col = collection(db, "pedidos");
  let qy = query(col, where("operarioId", "==", operarioId));
  return onSnapshot(
    qy,
    opts.onChange ??
      ((snapshot) => {
        console.log("[listenPedidosAsignadosOperario] docs:", snapshot.size);
      }),
    opts.onError ??
      ((err) => {
        console.error("[listenPedidosAsignadosOperario] onError:", err);
      })
  );
  
}

/**
 * Compara los IDs activos en Finnegans (del sync) con los pedidos PENDIENTE_ASIGNAR
 * en Firestore de los últimos N días. Los que no volvieron de Finnegans → ANULADO.
 * Solo toca pedidos con estado PENDIENTE_ASIGNAR (si ya avanzaron, no se tocan).
 */
export async function marcarAnuladosEnRango(idsActivosEnFinnegans, fechaDesde) {
  // idsActivosEnFinnegans: Set de IDs normalizados (sin prefijo "PEDVTA - ")
  const qy = query(
    collection(db, "pedidos"),
    where("estado", "==", "PENDIENTE_ASIGNAR"),
    where("source", "==", "finnegans"),
  );
  const snap = await getDocs(qy);

  const batch = writeBatch(db);
  let count = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Solo anular pedidos cuya fecha de Finnegans cae dentro del rango del sync
    const finFecha = data.finFecha?.toDate?.()
      || (data.finFecha ? new Date(data.finFecha) : null);
    if (!finFecha || finFecha < fechaDesde) continue;

    // Normalizar ID: quitar prefijo "PEDVTA - " para comparar con los de Finnegans
    const idNorm = docSnap.id.replace(/^PEDVTA\s*-\s*/i, "").trim();

    if (!idsActivosEnFinnegans.has(idNorm) && !idsActivosEnFinnegans.has(docSnap.id)) {
      batch.update(docSnap.ref, {
        estado: "ANULADO",
        anuladoAt: serverTimestamp(),
        anuladoMotivo: "Pedido no encontrado en Finnegans durante sincronización automática",
        anuladoOrigen: "auto-sync",
        updatedAt: serverTimestamp(),
      });
      count++;
    }
  }

  if (count > 0) await batch.commit();
  return count;
}

export async function corregirPedidosSinEstado() {
  const qy = query(collection(db, "pedidos"), where("estado", "==", null));
  const snap = await getDocs(qy);

  console.log(`🔍 Pedidos sin estado: ${snap.size}`);

  let corregidos = 0;

  for (const docSnap of snap.docs) {
    await updateDoc(doc(db, "pedidos", docSnap.id), {
      estado: "PENDIENTE_ASIGNAR",
      updatedAt: serverTimestamp(),
    });
    corregidos++;
  }

  console.log(`✅ Pedidos corregidos: ${corregidos}`);
}
