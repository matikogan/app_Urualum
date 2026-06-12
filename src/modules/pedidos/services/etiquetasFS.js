// src/modules/pedidos/services/etiquetasFS.js
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, orderBy, query, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";

// === CARGAS (agrupan pedidos por camión/destino, para imprimir etiquetas y controlar la carga) ===
// Colección independiente — no toca `pedidos` ni sus estados.

export async function listarCargas() {
  try {
    const q = query(collection(db, "cargasEtiquetas"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[listarCargas] error:", e);
    return [];
  }
}

export async function crearCarga(nombre) {
  const ref = await addDoc(collection(db, "cargasEtiquetas"), {
    nombre: String(nombre || "").trim(),
    items: [],
    escaneados: [],
    completa: false,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getCarga(cargaId) {
  if (!cargaId) return null;
  const ref = doc(db, "cargasEtiquetas", cargaId);
  const s = await getDoc(ref);
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Agrega pedidos nuevos a una carga existente (evita duplicar pedidos ya cargados).
export async function agregarItemsACarga(cargaId, nuevosItems) {
  const carga = await getCarga(cargaId);
  const existentes = carga?.items || [];
  const existentesIds = new Set(existentes.map((it) => it.pedidoId));
  const aAgregar = (nuevosItems || []).filter((it) => !existentesIds.has(it.pedidoId));
  if (aAgregar.length === 0) return;
  const ref = doc(db, "cargasEtiquetas", cargaId);
  await updateDoc(ref, { items: [...existentes, ...aAgregar] });
}

export async function actualizarEscaneadosCarga(cargaId, escaneados) {
  if (!cargaId) return;
  const ref = doc(db, "cargasEtiquetas", cargaId);
  await updateDoc(ref, { escaneados: Array.from(escaneados) });
}

export async function marcarCargaCompleta(cargaId, completa) {
  if (!cargaId) return;
  const ref = doc(db, "cargasEtiquetas", cargaId);
  await updateDoc(ref, { completa: !!completa });
}

// Dirección/localidad por cliente — se completa una vez y queda guardada
// para que la próxima vez la etiqueta venga pre-cargada.
export async function getDireccionCliente(clienteCodigo) {
  if (!clienteCodigo) return null;
  try {
    const ref = doc(db, "clientesDireccion", String(clienteCodigo));
    const s = await getDoc(ref);
    return s.exists() ? s.data() : null;
  } catch (e) {
    console.warn("[getDireccionCliente] error:", e);
    return null;
  }
}

export async function saveDireccionCliente(clienteCodigo, { direccion, localidad }) {
  if (!clienteCodigo) return;
  const ref = doc(db, "clientesDireccion", String(clienteCodigo));
  await setDoc(ref, {
    direccion: direccion || "",
    localidad: localidad || "",
  }, { merge: true });
}

// Códigos de departamento (Finnegans → BSProvincia) → nombre.
const DEPARTAMENTOS_UY = {
  DEPTOUR1: "Montevideo",
  DEPTOUR2: "Canelones",
  DEPTOUR3: "Maldonado",
  DEPTOUR4: "Rocha",
  DEPTOUR5: "Lavalleja",
  DEPTOUR6: "Treinta y Tres",
  DEPTOUR7: "Cerro Largo",
  DEPTOUR8: "Tacuarembó",
  DEPTOUR9: "Rivera",
  DEPTOUR10: "Florida",
  DEPTOUR11: "Durazno",
  DEPTOUR12: "Flores",
  DEPTOUR13: "San José",
  DEPTOUR14: "Colonia",
  DEPTOUR15: "Soriano",
  DEPTOUR16: "Fray Bentos",
  DEPTOUR17: "Paysandú",
  DEPTOUR18: "Salto",
  DEPTOUR19: "Artigas",
  DEPTOUR20: "Río Negro",
};

// Cache en memoria del listado de clientes de Finnegans (2014 entradas).
// Se pide una sola vez por sesión y se reutiliza para resolver "nombre → código".
let _clientesListCache = null;

function normalizarNombre(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // sin acentos
    .replace(/\s+/g, " ")
    .trim();
}

async function getClientesList() {
  if (_clientesListCache) return _clientesListCache;
  try {
    const res = await httpsCallable(functions, "finnegansListarClientes")({});
    const clientes = Array.isArray(res?.data?.clientes) ? res.data.clientes : [];
    _clientesListCache = clientes;
    return clientes;
  } catch (e) {
    console.warn("[getClientesList] error:", e);
    return [];
  }
}

// El reporte de pedidos pendientes no trae el Código interno del cliente
// (solo el RUT/CI en NRODEIDENTIFICACION). Buscamos el Código real
// haciendo match por nombre contra /cliente/list.
export async function buscarCodigoClientePorNombre(nombre) {
  const target = normalizarNombre(nombre);
  if (!target) return null;

  const clientes = await getClientesList();
  const candidatos = clientes.filter((c) => normalizarNombre(c.nombre) === target);
  if (candidatos.length === 0) return null;

  // Si hay varios (ej. uno activo y uno inactivo), preferimos el activo.
  const activo = candidatos.find((c) => c.activo);
  return (activo || candidatos[0])?.codigo || null;
}

// Busca el domicilio del cliente directo en Finnegans (GET /cliente/{codigo}).
// El domicilio viene en c.Direcciones (array), tomamos la principal.
// Devuelve { direccion, localidad } o null si no se pudo resolver.
export async function fetchDireccionClienteFinnegans(clienteCodigo) {
  if (!clienteCodigo) return null;
  try {
    const res = await httpsCallable(functions, "finnegansGetCliente")({ codigo: clienteCodigo });
    const c = res?.data?.cliente;
    if (!c) return null;

    const direcciones = Array.isArray(c.Direcciones) ? c.Direcciones : [];
    const dom = direcciones.find((d) => d?.Principal) || direcciones[0] || {};

    const calle = dom.Calle || "";
    const numero = dom.Numero && dom.Numero !== "S/N" ? dom.Numero : "";
    const direccion = [calle, numero].filter(Boolean).join(" ").trim();

    const departamento = DEPARTAMENTOS_UY[dom.ProvinciaCodigo] || "";

    if (!direccion && !departamento) return null;
    return { direccion, localidad: departamento };
  } catch (e) {
    console.warn("[fetchDireccionClienteFinnegans] error:", e);
    return null;
  }
}
