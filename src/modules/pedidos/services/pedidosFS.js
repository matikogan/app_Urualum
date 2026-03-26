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
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { ESTADOS } from "./estados";
import { onAuthStateChanged, getAuth } from "firebase/auth";


function isPlainObject(o) {
  return o && typeof o === "object" && !Array.isArray(o);
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


// DEBUG: verificar que Auth y Firestore usen la MISMA app/proyecto
console.log(
  "[pedidosFS] Firestore projectId:",
  db.app?.options?.projectId,
  "app:",
  db.app?.name
);
console.log("[pedidosFS] Auth app name:", getAuth().app?.name);
console.log("[pedidosFS] Current uid:", getAuth().currentUser?.uid ?? null);

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

  console.log("[SYNC] intento", {
    id,
    codes: [...id].map((c) => c.charCodeAt(0)),
  });

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

  console.log(
    "[PERM TRACE] Iniciando upsert para:",
    pedido.id,
    "rol:",
    (await getDoc(doc(db, "users", getAuth().currentUser.uid))).data()?.role
  );


  if (!pedido?.id) throw new Error("pedido.id faltante");
  // === NO GUARDAR COTIZACIONES ===
  if (pedido.esCotizacion || pedido.deposito === "COTIZACION") {
    console.log("[SYNC] Pedido COTIZACION detectado → no se guarda en Firestore:", pedido.id);
    return { skipped: true };
  }

  const ref = doc(db, "pedidos", pedido.id);

  // === 1. LEER DOCUMENTO PREVIO ===
  console.log("[PERM TRACE] Antes de getDoc:", pedido.id);

  const prevSnap = await getDoc(ref);

  console.log("[PERM TRACE] getDoc OK:", pedido.id);


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

  // === 4. DEBUG: CAMPOS ENVIADOS ===
  console.log("[PERM DEBUG] UPDATE payload keys:", Object.keys(updateDataFinal));

  // === 5. DEBUG: DIFF REAL ===
  let diffKeys = Object.keys(updateDataFinal).filter(
    (k) => JSON.stringify(updateDataFinal[k]) !== JSON.stringify(prev[k])
  );
  console.log("[PERM DEBUG] diffKeys (lo que Firestore evalúa):", diffKeys);

  // === 6. INTENTAR UPDATE ===
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("[UPSYNC] update", pedido.id, updateDataFinal);
    }

    console.log("[PERM TRACE] Intentando updateDoc SYNC:", pedido.id, updateDataFinal);

    await updateDoc(ref, updateDataFinal);

    return { created: false, id: pedido.id };

  } catch (e) {

    // ===== DEBUG ERROR UPDATE =====
    console.error("[UPSYNC][DEBUG] ERROR update:", {
      pedidoId: pedido.id,
      uid: getAuth().currentUser?.uid,
      role:
        (await (async () => {
          try {
            const r = await getDoc(doc(db, "users", getAuth().currentUser?.uid));
            return r.data()?.role;
          } catch {
            return "desconocido";
          }
        })()),
      error: e?.code || e?.message,
      diffKeys,
      payload: updateDataFinal
    });

    // Ver si es NOT FOUND para pasar a CREATE
    const code = String(e?.code || e?.message || "").toLowerCase();
    const isNotFound =
      code.includes("not-found") ||
      code.includes("no document to update");

    if (!isNotFound) throw e;
  }

  // === 7. CREATE si no existía ===
  console.log("⛳ CREATE START for", pedido.id);
  console.log("⛳  A) updateDataFinal:", JSON.parse(JSON.stringify(updateDataFinal)));

  const createData = sanitizeForFirestore({
    ...updateDataFinal,
    source: "finnegans",
    timestamps: { creado: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });

  console.log("⛳  B) createData BEFORE sanitize:", JSON.parse(JSON.stringify({
    ...updateDataFinal,
    source: "finnegans",
    timestamps: "TS",
    updatedAt: "TS"
  })));

  console.log("⛳  C) createData AFTER sanitize:", JSON.parse(JSON.stringify(createData)));

  try {
    await setDoc(ref, createData, { merge: false });
    console.log("⛳ CREATE SUCCESS for", pedido.id);
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


    console.log("[ADESP] ▶️ entrada numerosFin size:", finNums.length);
    console.log("[ADESP] ▶️ muestra:", finNums.slice(0, 10));

    // Traemos todos los pedidos CONTROLADO
    const qy = query(collection(db, "pedidos"), where("estado", "==", "CONTROLADO"));
    const snap = await getDocs(qy);
    console.log("[ADESP] 📥 CONTROLADO docs:", snap.size);

    let updated = 0;
    let skipped = 0;

    // Iteramos por cada pedido
    for (const docSnap of snap.docs) {
      const p = docSnap.data();
      const numero = normalizeNumero(p?.numero ?? "");

      console.log("[ADESP] check:", { id: docSnap.id, numero, inFin: finSet.has(numero) });

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
          console.log("[ADESP] intento SYNC", { id: docSnap.id, payload: payloadSync });
          console.log("[PERM DEBUG][ADESP] SYNC update keys:", Object.keys(payloadSync));

          await updateDoc(ref, payloadSync);
          console.log(`📦 (SYNC) Pedido ${docSnap.id} (${numero}) → DESPACHADO`);
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
            console.log("[ADESP] intento VENTAS", { id: docSnap.id, payload: payloadVentas });
            console.log("[PERM DEBUG][ADESP] VENTAS update keys:", Object.keys(payloadVentas));

            await updateDoc(ref, payloadVentas);
            console.log(`📦 (VENTAS) Pedido ${docSnap.id} (${numero}) → DESPACHADO`);
          } catch (eVentas) {
            // Log de depuración detallado (rol + uid + error)
            const auth = getAuth();
            const uidErr = auth.currentUser?.uid || null;
            let role = "desconocido";
            try {
              const uref = doc(db, "users", uidErr);
              const udata = (await getDoc(uref)).data();
              role = udata?.role || "sin role";
            } catch {}

            console.error("[ADESP][DEBUG] Permiso denegado en ambos intentos:", {
              id: docSnap.id,
              numero,
              uid: uidErr,
              role,
              error: eVentas?.code || eVentas?.message,
              payloadSync,
              payloadVentas,
            });
          }
        }

        updated++;
      }
    }

    console.log("[ADESP] ✅ resumen:", { updated, skipped });
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
