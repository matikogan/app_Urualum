// src/pages/confirmar.js
import React, { useContext, useMemo, useState, useEffect } from "react";
import { AppContext } from "context/AppContext";
import { db } from "firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import { getFinnegansToken, postRecepcionCompra } from "API/finnegans";
import { useAuth } from "context/AuthContext";
import RoleGate from "components/RoleGate";
import BackButton from "components/BackButton";

function Confirmar() {
  const { profile } = useAuth();

  const {
    facturaSeleccionada,
    paquetesEscaneados,
    limpiarDatos,
    packingByCode,
  } = useContext(AppContext);

  // 🔹 extras por producto (etiquetas generadas) de ESTA factura
  const [extrasPorProd, setExtrasPorProd] = useState({}); // {codigoUru: count}

  useEffect(() => {
    if (!facturaSeleccionada?.nroFactura) return;
    const q = query(
      collection(db, "etiquetas_generadas"),
      where("factura", "==", String(facturaSeleccionada.nroFactura))
    );
    const unsub = onSnapshot(q, (snap) => {
      const map = {};
      snap.forEach((d) => {
        const data = d.data();
        const code = String(data.producto || "").trim();
        map[code] = (map[code] || 0) + 1;
      });
      setExtrasPorProd(map);
    });
    return () => unsub();
  }, [facturaSeleccionada]);

  const [enviando, setEnviando] = useState(false);
  const [retry, setRetry] = useState(null); // { docId, payload }
  const [motivoDesvio, setMotivoDesvio] = useState("");

  const productosFactura = facturaSeleccionada?.productos || [];

  // Base esperado de bundles (sin extras)
  const baseBundlesForCode = (code) => {
    const info = packingByCode?.[code];
    const item = productosFactura.find(
      (it) => String(it.codigo).split(" ")[0].trim() === code
    );
    if (info?.bundles) return Number(info.bundles);
    if (info?.qty_per_bundle) {
      const totalTiras = Number(item?.cantidad || 0);
      return Math.ceil(totalTiras / Number(info.qty_per_bundle));
    }
    return Number(item?.cantidad || 0); // fallback: tiras
  };

  // Agrupar lo escaneado
  const agrupado = useMemo(() => {
    const byProd = {};
    for (const p of paquetesEscaneados) {
      const code = String(p.producto || p.codigo_urualum || "").trim();
      if (!code) continue;
      if (!byProd[code]) byProd[code] = { bundles: 0, tiras: 0, paquetes: [] };
      byProd[code].bundles += 1;
      byProd[code].tiras += Number(p.cantidad || 0);
      byProd[code].paquetes.push({
        nro_paquete: p.nro_paquete,
        cantidad: Number(p.cantidad || 0),
      });
    }
    return byProd;
  }, [paquetesEscaneados]);

  // Estado por producto (esperados = base + extras)
  const estado = useMemo(() => {
    return productosFactura.map((it) => {
      const code = String(it.codigo || "").split(" ")[0].trim();
      const info = packingByCode?.[code] || {};
      const esc = agrupado[code]?.bundles || 0;

      const base = baseBundlesForCode(code);
      const extras = Number(extrasPorProd[code] || 0);
      const esperados = base + extras;

      return {
        codigo: code,                           // código Uru (interno)
        customer_no: info.customer_no || "—",   // 👈 mostrarmos esto
        color: info.color || "—",
        finish: info.finish || "—",
        descripcion: it.descripcion || it.codigo.replace(code, "").trim(),
        esperados,
        escaneados: esc,
        ok: esc >= esperados,
      };
    });
  }, [productosFactura, agrupado, extrasPorProd, packingByCode]);

  // Diferencias (faltantes / sobrantes)
  const diferencias = useMemo(() => {
    return estado
      .filter((e) => e.escaneados !== e.esperados)
      .map((e) => ({
        producto: e.codigo,
        customer_no: e.customer_no,
        esperados_bundles: e.esperados,
        escaneados_bundles: e.escaneados,
        tipo: e.escaneados > e.esperados ? "sobrante" : "faltante",
        delta: Math.abs(e.escaneados - e.esperados),
      }));
  }, [estado]);

  const hayDesvio = diferencias.length > 0;
  const todoOk = estado.every((e) => e.ok);

  // Payload a Finnegans
  const buildFinnegansPayload = () => {
    const items = estado.map((e) => {
      const detalle = agrupado[e.codigo] || { bundles: 0, tiras: 0, paquetes: [] };
      return {
        producto: e.codigo,                 // interno
        customer_no: e.customer_no || null, // 👈 se envía también
        bundles: detalle.bundles,
        tiras_totales: detalle.tiras,
        paquetes: detalle.paquetes,
      };
    });

    return {
      empresa: process.env.REACT_APP_FINNEGANS_EMPRESA || "empre01",
      documento: "Recepción de Compra Importación",
      factura: {
        nro: facturaSeleccionada.nroFactura,
        comprobante: facturaSeleccionada.comprobante, // 👈 Impo
        proveedor: facturaSeleccionada.proveedor,
        fecha: facturaSeleccionada.fecha,
      },
      items,
      meta: {
        origen: "URUALUM-WEB",
        generadoEn: new Date().toISOString(),
        hayDesvio,
        motivoDesvio: hayDesvio ? (motivoDesvio || null) : null,
      },
    };
  };

  const finalizar = async () => {
    if (!facturaSeleccionada) return alert("No hay factura seleccionada.");
    if (hayDesvio && !motivoDesvio.trim()) {
      return alert("Hay desvíos. Por favor, ingresá un motivo para continuar.");
    }

    setEnviando(true);
    setRetry(null);

    // 1) Guardar recepción interna primero
    const resumen = {
      factura: {
        nroFactura: facturaSeleccionada.nroFactura,
        comprobante: facturaSeleccionada.comprobante,
        proveedor: facturaSeleccionada.proveedor,
        fecha: facturaSeleccionada.fecha,
      },
      productos: estado,
      paquetes: paquetesEscaneados,
      diferencias,
      motivo_desvio: motivoDesvio || null,
      confirmadoPor: profile?.id || "Encargado",
      createdAt: serverTimestamp(),
      finnegans: { status: "pending" },
    };

    let docRef;
    try {
      docRef = await addDoc(collection(db, "recepciones_completas"), resumen);
    } catch (err) {
      setEnviando(false);
      console.error("❌ Error guardando recepción final:", err);
      return alert("Error al guardar recepción final: " + (err?.message || "desconocido"));
    }

    // 2) POST a Finnegans
    const payload = buildFinnegansPayload();

    try {
      const token = await getFinnegansToken();
      const resp = await postRecepcionCompra(token, payload);

      await updateDoc(doc(db, "recepciones_completas", docRef.id), {
        finnegans: {
          status: "ok",
          response: resp,
          sentPayload: payload,
          updatedAt: serverTimestamp(),
        },
      });

      try { await deleteDoc(doc(db, "estado", "recepcion_actual")); } catch (e) { /* noop */ }

      alert("✅ Recepción confirmada y enviada a Finnegans.");
      setEnviando(false);
      limpiarDatos();
    } catch (err) {
      console.error("❌ Error enviando a Finnegans:", err);

      await updateDoc(doc(db, "recepciones_completas", docRef.id), {
        finnegans: {
          status: "error",
          error: err?.message || "Error desconocido",
          response: err?.response || null,
          sentPayload: payload,
          updatedAt: serverTimestamp(),
        },
      });

      setRetry({ docId: docRef.id, payload });
      setEnviando(false);
      alert("Recepción guardada. Falló el envío a Finnegans. Podés reintentar.");
    }
  };

  const reintentarEnvio = async () => {
    if (!retry?.docId || !retry?.payload) return;
    try {
      setEnviando(true);
      const token = await getFinnegansToken();
      const resp = await postRecepcionCompra(token, retry.payload);

      await updateDoc(doc(db, "recepciones_completas", retry.docId), {
        finnegans: {
          status: "ok",
          response: resp,
          sentPayload: retry.payload,
          updatedAt: serverTimestamp(),
        },
      });

      try { await deleteDoc(doc(db, "estado", "recepcion_actual")); } catch (e) { /* noop */ }

      alert("✅ Envío reintentado con éxito.");
      setRetry(null);
      setEnviando(false);
      limpiarDatos();
    } catch (err) {
      console.error("❌ Reintento fallido:", err);
      await updateDoc(doc(db, "recepciones_completas", retry.docId), {
        finnegans: {
          status: "error",
          error: err?.message || "Error desconocido",
          response: err?.response || null,
          sentPayload: retry.payload,
          updatedAt: serverTimestamp(),
        },
      });
      setEnviando(false);
      alert("❌ Siguió fallando el envío. Revisá la respuesta en Firestore.");
    }
  };

  if (!facturaSeleccionada) return <p>⚠️ No hay factura seleccionada.</p>;

  return (
    <div className="container">
      <BackButton to="/escanear" />

      {/* Cabecera compacta */}
      <div className="card card--compact" style={{ marginTop: 8 }}>
        <div className="factura-heading">Impo {facturaSeleccionada.comprobante}</div>
        <div className="factura-sub">{facturaSeleccionada.proveedor}</div>
      </div>

      {/* Banner de desvíos */}
      {hayDesvio ? (
        <div className="banner banner--warn">
          <strong>Atención:</strong> Hay diferencias entre esperados y escaneados.
          <ul className="banner-list">
            {diferencias.map((d) => (
              <li key={d.producto}>
                <span className="mono">{d.customer_no}</span> ({d.producto}): {d.tipo} de{" "}
                {d.delta} bundles — {d.escaneados_bundles} escaneados vs {d.esperados_bundles} esperados
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 8 }}>
            <label><strong>Motivo del desvío:</strong></label>
            <textarea
              rows={3}
              className="input"
              style={{ maxWidth: 640, marginTop: 6 }}
              value={motivoDesvio}
              onChange={(e) => setMotivoDesvio(e.target.value)}
              placeholder="Ej: llegaron 2 paquetes adicionales sin etiqueta; faltó completar el producto X..."
            />
          </div>
        </div>
      ) : (
        <div className="banner banner--ok">Sin desvíos detectados.</div>
      )}

      {/* Tabla limpia mostrando Customer No. */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer No.</th>
                <th>Esperados</th>
                <th>Escaneados</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {estado.map((r) => (
                <tr key={r.codigo}>
                  <td>
                    <div className="mono">{r.customer_no}</div>
                    <div className="muted small">{r.finish}</div>
                  </td>
                  <td></td>
                  <td>{r.esperados}</td>
                  <td>{r.escaneados}</td>
                  <td>
                    {r.ok ? <span className="pill pill--ok">OK</span> : <span className="pill pill--warn">Revisar</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RoleGate allow={["Encargado"]} fallback={<p className="muted">Solo el encargado puede finalizar.</p>}>
        <div className="btn-center" style={{ marginTop: 16 }}>
          <button className="btn btn--primary btn-big btn--elevated" onClick={finalizar} disabled={enviando}>
            {enviando ? "Enviando…" : "Finalizar recepción"}
          </button>

          {retry && (
            <button className="btn btn--outline btn-big" style={{ marginLeft: 10 }} onClick={reintentarEnvio} disabled={enviando}>
              Reintentar envío
            </button>
          )}
        </div>
      </RoleGate>
    </div>
  );
}

export default Confirmar;
