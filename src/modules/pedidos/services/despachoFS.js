// src/modules/pedidos/services/despachoFS.js
// Servicio: despacharPedido → crea Remito en Finnegans y actualiza Firestore

import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { ESTADOS } from "./estados";
import { mapPedidoToDespachoPayload } from "./finDespachoMapper";

// Opción A (directa, provisoria): helper local que ya maneja token + POST
import { postDespacho, getPedidoFinByNumero, getPedidosPendientes } from "../../../API/finnegans";

// Opción B (segura): callable a Cloud Function (cuando la actives, descomentar)
// import { httpsCallable } from "firebase/functions";
// import { functions } from "../../../firebase";

const PEDIDOS_COLL = "pedidos";

/* ===================== DEBUG UTILS ===================== */

// Fecha YYYY-MM-DD local
function ymdLocal(date = new Date()) {
  const tz = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

// Extrae "13230" de "PEDVTA - 13230"
function extractNumero(nDoc = "") {
  const m = String(nDoc).match(/(\d{3,})$/);
  return m ? m[1] : null;
}

function pickOrganizacionCodigo(row) {
  if (!row) return null;
  const candidates = [
    "OrganizacionCodigo", "ORGANIZACIONCODIGO",
    "ClienteCodigo", "CLIENTECODIGO",
    "CodigoCliente", "CODIGOCLIENTE",
    "OrganizacionId", "ORGANIZACIONID",
    "ClienteId", "CLIENTEID",
  ];
  for (const k of candidates) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // Si el reporte trae un objeto con { Codigo }
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && "Codigo" in v && String(v.Codigo).trim()) {
      return String(v.Codigo).trim();
    }
  }
  return null;
}



// (fallback) Buscar el pedido en un listado si no podemos traer cabecera directa
async function fetchPedidoRowFromFin(numeroDocumento) {
  // buscamos en los últimos 365 días por las dudas
  const hasta = ymdLocal(new Date());
  const desde = "2024-01-01";
  try {
    const filas = await getPedidosPendientes({ fechaDesde: desde, fechaHasta: hasta });
    const n = extractNumero(numeroDocumento);
    const match = (filas || []).find((row) => {
      const docTxt = String(
        row.DOCNROINT || row.NumeroDocumento || row.NOMBRE || row.Documento || row.Pedido || row.NumeroPedido || ""
      );
      return n ? new RegExp(`\\b${n}\\b`).test(docTxt) : docTxt.trim().toUpperCase() === numeroDocumento.toUpperCase();
    });
    return match || null;
  } catch (e) {
    console.error("[DEBUG FIN] No se pudo consultar pedidos en Finnegans (listado)", e);
    return null;
  }
}

// Imprime un checklist claro de lo que tenemos / falta
function printDespachoChecklist({ pedidoFS, finCab, finRow, payload }) {
  const numeroDoc = payload?.NumeroDocumento || `PEDVTA - ${(pedidoFS?.numero || pedidoFS?.id)}`;
  const missing = [];

  const depoOk = !!payload?.Items?.[0]?.DepositoOrigenCodigo;
  const clienteOk = !!payload?.OrganizacionCodigo || !!payload?.ClienteCodigo; // solo si decidís enviar

  if (!depoOk) missing.push("Items[].DepositoOrigenCodigo");
  if (!payload?.Items?.length) missing.push("Items (al menos 1 con ProductoCodigo y Cantidad>0)");
  if (!clienteOk) missing.push("ClienteCodigo/OrganizacionCodigo (si tu tenant lo exige)"); // opcional

  console.groupCollapsed(`🔎 Despacho Checklist — ${numeroDoc}`);
  console.log("Pedido Firestore:", pedidoFS);
  console.log("FIN cabecera cruda:", finCab);
  console.log("FIN fila listado (fallback):", finRow);
  console.log("Payload despacho:", payload);
  console.table([
    { campo: "NumeroDocumento", valor: payload?.NumeroDocumento, ok: !!payload?.NumeroDocumento },
    { campo: "Fecha", valor: payload?.Fecha, ok: !!payload?.Fecha },
    { campo: "DepositoOrigenCodigo", valor: payload?.Items?.[0]?.DepositoOrigenCodigo, ok: depoOk },
    { campo: "Items.length", valor: payload?.Items?.length, ok: payload?.Items?.length > 0 },
    { campo: "Primer ProductoCodigo", valor: payload?.Items?.[0]?.ProductoCodigo, ok: !!payload?.Items?.[0]?.ProductoCodigo },
    { campo: "Primer Cantidad", valor: payload?.Items?.[0]?.Cantidad, ok: (payload?.Items?.[0]?.Cantidad ?? 0) > 0 },
    { campo: "ClienteCodigo/OrganizacionCodigo", valor: payload?.ClienteCodigo || payload?.OrganizacionCodigo, ok: clienteOk },
  ]);
  if (missing.length) {
    console.warn("⚠️ Faltantes detectados:", missing);
  } else {
    console.info("✅ No se detectaron faltantes críticos en el payload.");
  }
  console.groupEnd();
}

// Parser tolerante para la respuesta de Finnegans
function parseFinnResponse(res) {
  let raw = res;
  try {
    if (typeof raw === "string") {
      const m =
        raw.match(/\b(REMVTA|PEDVTA|REMITO)\s*-\s*\d+\b/i) ||
        raw.match(/\bNRO\s*[:#]?\s*(\d+)\b/i);
      const documento = m ? m[0].toUpperCase() : null;
      return { documento, id: null, message: raw, raw };
    }
    if (Array.isArray(raw)) raw = raw[0] || {};
    if (raw?.data && typeof raw.data === "object") raw = raw.data;
    if (raw?.Data && typeof raw.Data === "object") raw = raw.Data;

    const documento =
      raw.Documento ||
      raw.NumeroDocumento ||
      raw.numeroDocumento ||
      raw.NroDocumento ||
      raw.NOMBRE || // muchos tenants
      raw.DocumentoNumero ||
      null;

    const id =
      raw.Id ||
      raw.id ||
      raw.ResponseId ||
      raw.responseId ||
      raw.TransaccionId ||
      raw.IdTransaccion ||
      null;

    const message = raw.Message || raw.message || raw.Mensaje || raw.mensaje || null;

    return { documento, id, message, raw };
  } catch (e) {
    return { documento: null, id: null, message: String(e?.message || e), raw };
  }
}

/* ===================== SERVICIO PRINCIPAL ===================== */

/**
 * despacharPedido({ pedidoId, usuario, useCallable=false })
 * - Valida estado CONTROLADO
 * - Enriquecer datos (cabecera cruda Finnegans → clienteCodigo)
 * - Mapea payload
 * - Llama a Finnegans (directo o por Callable)
 * - Actualiza Firestore a DESPACHADO con metadatos
 */
export async function despacharPedido({ pedidoId, usuario, useCallable = false } = {}) {
  if (!pedidoId) throw new Error("Falta pedidoId");

  const ref = doc(db, PEDIDOS_COLL, String(pedidoId));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Pedido no encontrado");
  const pedido = snap.data();

  if (pedido.estado !== ESTADOS.CONTROLADO) {
    throw new Error("Solo se puede despachar un pedido en estado CONTROLADO.");
  }

  // 1) Traer cabecera cruda de Finnegans por número (amplia ventana)
  const numeroDoc = `PEDVTA - ${(pedido.numero || pedidoId)}`;
  let finCab = null;
  try {
    finCab = await getPedidoFinByNumero({
      numeroDocumento: numeroDoc,
      fechaDesde: "2024-01-01",
      fechaHasta: ymdLocal(new Date()),
    });
  } catch (e) {
    console.warn("[DESPACHO] No se pudo traer cabecera directa; probaremos listado.", e);
  }

  // 2) Fallback: si no hubo cabecera, buscar en listado que ya uses
  let finRow = null;
  if (!finCab) {
    finRow = await fetchPedidoRowFromFin(numeroDoc);
  }

  // 3) Resolver clienteCodigo: Firestore > Cabecera > Fila listado > (opcional) fallback manual temporal
  if (!pedido.clienteCodigo) {
    const cod =
        pickOrganizacionCodigo(finCab) ||
        pickOrganizacionCodigo(finRow) ||
        null;
    if (cod) pedido.clienteCodigo = String(cod).trim();
    }


  // (TEMPORAL) hardcode por nombre — quitá esto cuando el sync ya grabe clienteCodigo
  if (!pedido.clienteCodigo && pedido.cliente?.toUpperCase() === "SILVIA BAROFFIO") {
    // ⚠️ Esto debe ser el CÓDIGO de BSOrganizacion (no CUIT/ID). Ej: "C000123"
    pedido.clienteCodigo = "C000123"; // <-- reemplazar por el código real mientras tanto
  }

  // 4) Armar payload con tu mapper (NO envía objetos Cliente/Organizacion; sólo códigos si existen)
  const payload = mapPedidoToDespachoPayload({ id: pedidoId, ...pedido });

  // 5) DEBUG visible
  printDespachoChecklist({ pedidoFS: pedido, finCab, finRow, payload });
  console.debug("[DESPACHO] Enviando a Finnegans:", payload);

  // 6) Llamar API Finnegans
  let finnRes;
  if (useCallable) {
    // const fn = httpsCallable(functions, "postDespacho");
    // const r = await fn(payload);
    // finnRes = r?.data ?? r;
    throw new Error("Callable no configurada. Usá useCallable=false o implementá la Function.");
  } else {
    finnRes = await postDespacho(payload);
  }

  console.debug("[DESPACHO] Respuesta Finnegans cruda:", finnRes);

  // 7) Parseo defensivo de respuesta
  const { documento, id, message } = parseFinnResponse(finnRes);
  if (!documento) {
    const snippet =
      typeof finnRes === "string"
        ? finnRes.slice(0, 240)
        : JSON.stringify(finnRes || {}, null, 2).slice(0, 240);
    throw new Error(`Despacho sin documento: Finnegans devolvió: ${snippet}`);
  }

  // 8) Actualizar Firestore
  const updates = {
    estado: ESTADOS.DESPACHADO,
    "finnegans.despachoDoc": documento,
    "finnegans.responseId": id || null,
    "finnegans.message": message || null,
    despachadoAt: serverTimestamp(),
    despachadoPor: usuario?.uid || null,
  };

  await updateDoc(ref, updates);

  return { status: "ok", documento, id, message };
}
