// src/pages/escanear.js
import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppContext } from "context/AppContext";
import { db } from "firebase.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  doc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import QRCode from "qrcode";
import { useAuth } from "context/AuthContext";
import RoleGate from "components/RoleGate";
import BackButton from "components/BackButton";
import Modal from "../../pedidos/components/Modal";


function Escanear() {
  const navigate = useNavigate();

  const {
    facturaSeleccionada,
    paquetesEscaneados,
    setPaquetesEscaneados,
    packingByCode,
    cargarPackingList,
    toast,
  } = useContext(AppContext);

  const { user } = useAuth();

  // Mapa { codigoUru: cantidadExtrasGenerados } para esta factura
  const [extrasPorProd, setExtrasPorProd] = useState({});

  // Modal "agregar paquete"
  const [etiquetaModal, setEtiquetaModal] = useState(null); // { code, qtyPerBundle } | null
  const [cantInput, setCantInput] = useState("");
  const [generando, setGenerando] = useState(false);
  const cantInputRef = useRef(null);

  // 1) Cargar packing
  useEffect(() => {
    cargarPackingList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Escuchar en vivo los escaneos de esta factura
  useEffect(() => {
    if (!facturaSeleccionada?.nroFactura) return;

    const q = query(
      collection(db, "recepcion_paquetes"),
      where("factura", "==", String(facturaSeleccionada.nroFactura))
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => d.data());
      setPaquetesEscaneados(rows);
    });

    return () => unsub();
  }, [facturaSeleccionada, setPaquetesEscaneados]);

  // 3) Escuchar en vivo etiquetas generadas para esta factura
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

  // Util: descarga un PNG (dataURL)
  const downloadDataUrl = (dataUrl, filename) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Extrae el N de "-PKT-N" (o 0 si no matchea)
  const parseSeq = (nro) => {
    const m = String(nro || "").match(/-PKT-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  // Máximo PKT actual entre ESCANEADOS y GENERADOS (para ese producto/factura)
  const getCurrentMaxSeq = async (codigoPuro) => {
    const factura = String(facturaSeleccionada?.nroFactura || "");

    // 1) máximo en lo ya escaneado
    const maxEsc = Math.max(
      0,
      ...paquetesEscaneados
        .filter((p) => String(p.producto || p.codigo_urualum).trim() === codigoPuro)
        .map((p) => parseSeq(p.nro_paquete))
    );

    // 2) máximo en lo ya generado
    const qGen = query(
      collection(db, "etiquetas_generadas"),
      where("factura", "==", factura),
      where("producto", "==", codigoPuro)
    );
    const snapGen = await getDocs(qGen);
    const maxGen = Math.max(0, ...snapGen.docs.map((d) => parseSeq(d.data().nro_paquete)));

    return Math.max(maxEsc, maxGen);
  };

  // Base de "esperados" en bundles desde packing (sin extras)
  const baseBundlesForCode = (code) => {
    const info = packingByCode[code];
    // buscar item para conocer tiras (si hay que derivar)
    const item = facturaSeleccionada?.productos?.find(
      (it) => String(it.codigo).split(" ")[0].trim() === code
    );

    if (info?.bundles) return Number(info.bundles);
    if (info?.qty_per_bundle) {
      const totalTiras = Number(item?.cantidad || 0);
      return Math.ceil(totalTiras / Number(info.qty_per_bundle));
    }
    // fallback: mostramos tiras, aunque no es ideal
    return Number(item?.cantidad || 0);
  };

  // Esperados (bundles) = base + extras generados para este producto
  const esperadosBundles = (item) => {
    const code = String(item.codigo).split(" ")[0].trim();
    const base = baseBundlesForCode(code);
    const extras = Number(extrasPorProd[code] || 0);
    return base + extras;
  };

  // Encargado: abre modal para agregar paquetes
  const handleCrearEtiqueta = (codigoMostrado) => {
    const code = String(codigoMostrado).split(" ")[0].trim();
    const info = packingByCode?.[code];
    const qtyPerBundle = Number(info?.qty_per_bundle || 0);
    if (!qtyPerBundle) {
      toast?.error?.(`No hay "qty_per_bundle" para ${code} en packing_list. Cargá ese dato para poder generar etiquetas.`);
      return;
    }
    setCantInput("");
    setEtiquetaModal({ code, qtyPerBundle });
    setTimeout(() => cantInputRef.current?.focus(), 100);
  };

  // Confirmar modal: generar etiquetas
  const handleConfirmarEtiquetas = async () => {
    const cantPkts = parseInt(cantInput, 10);
    if (!cantPkts || cantPkts <= 0) {
      toast?.error?.("Cantidad de paquetes inválida.");
      return;
    }

    const { code, qtyPerBundle } = etiquetaModal;
    const factura = String(facturaSeleccionada?.nroFactura || "");

    setGenerando(true);
    try {
      const base = baseBundlesForCode(code);
      const maxActual = await getCurrentMaxSeq(code);
      const start = Math.max(base, maxActual);

      for (let i = 1; i <= cantPkts; i++) {
        const seq = start + i;
        const nro_paquete = `${factura}-${code}-PKT-${seq}`;
        const payload = {
          codigo_urualum: code,
          nro_paquete,
          cantidad: qtyPerBundle,
        };

        await setDoc(doc(db, "etiquetas_generadas", nro_paquete), {
          factura,
          producto: code,
          nro_paquete,
          cantidad: qtyPerBundle,
          origen: "manual",
          creadoPor: user?.uid || null,
          createdAt: serverTimestamp(),
        });

        const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 512,
        });
        downloadDataUrl(dataUrl, `${nro_paquete}.png`);
      }

      toast?.success?.(
        `Se generaron ${cantPkts} etiqueta${cantPkts > 1 ? "s" : ""} (${qtyPerBundle} tiras c/u). Imprimilas y escaneá normalmente.`
      );
      setEtiquetaModal(null);
    } catch (e) {
      console.error("❌ No se pudieron generar etiquetas:", e);
      toast?.error?.("No se pudieron generar etiquetas: " + (e?.message || "desconocido"));
    } finally {
      setGenerando(false);
    }
  };

  if (!facturaSeleccionada) {
    return (
      <div className="container">
        <div className="card empty-card" style={{ marginTop: 24, textAlign: "center" }}>
          <p className="h2" style={{ margin: 0 }}>⚠️ No hay factura seleccionada.</p>
          <p className="muted">Volvé a "Seleccionar factura" para comenzar una recepción.</p>
        </div>
      </div>
    );
  }

  // Contar paquetes escaneados para un código (comparando código Uru puro)
  const contarEscaneados = (codigoMostrado) => {
    const code = String(codigoMostrado).split(" ")[0].trim();
    return paquetesEscaneados.filter(
      (p) => String(p.producto || p.codigo_urualum).trim() === code
    ).length;
  };

  return (
    <div className="container">
      <BackButton to="/factura" />
      {/* Resumen compacto de factura */}
<div className="card card--compact" style={{ marginTop: 12, marginBottom: 12 }}>
  <div className="factura-heading">
    Factura N° {facturaSeleccionada.comprobante || facturaSeleccionada.id}
  </div>
  <div className="factura-sub">
    {facturaSeleccionada.proveedor}
  </div>
</div>


      <h2 className="h1" style={{ marginTop: 8, marginBottom: 8 }}>Productos a escanear</h2>

      <div className="product-grid">
  {facturaSeleccionada.productos.map((item) => {
    const code = String(item.codigo).split(" ")[0].trim();
    const esc = contarEscaneados(item.codigo);
    const esperados = esperadosBundles(item);

    const customerNo = packingByCode[code]?.customer_no || "—";
    const color = packingByCode[code]?.finish || "—";
    const finish = packingByCode[code]?.finish || "—";

    const descResto = item.codigo.replace(code, "").trim();
    const progreso = Math.max(0, Math.min(100, Math.round((esc / (esperados || 1)) * 100)));

    return (
      <div key={item.codigo} className="card product-card card--selectable">
        <div className="product-head">
          <div className="product-heading">
            <div className="product-customer">{customerNo}</div>
            <div className="product-color">{color}</div>
          </div>
          <div className="product-desc">
            {descResto || `${code} · Finish: ${finish}`}
          </div>
        </div>

        <div className="row" style={{ marginTop: 6 }}>
          <span className="kpi">Esperados: {esperados}</span>
          <span className="kpi">Escaneados: {esc}</span>
        </div>

        <div className="progress">
          <div className="progress-bar" style={{ width: `${progreso}%` }} />
        </div>

        <div className="product-actions">
          <button
            type="button"
            className="btn btn--primary btn-sm btn--elevated"
            disabled={esc >= esperados}
            onClick={() =>
              navigate("/escanearQR", {
                state: {
                  productoCodigo: item.codigo,
                  cantidadEsperada: esperados,
                },
              })
            }
          >
            Escanear
          </button>

          <RoleGate allow={["Encargado"]}>
            <button
              type="button"
              className="btn btn--outline btn-sm"
              onClick={() => handleCrearEtiqueta(item.codigo)}
            >
              + Agregar paquete
            </button>
          </RoleGate>
        </div>
      </div>
    );
  })}
</div>


      <RoleGate allow={["Encargado"]}>
        <div className="btn-center" style={{ marginTop: 28, marginBottom: 20 }}>
          <button
            type="button"
            className="btn btn--primary btn-big btn--elevated"
            onClick={() => navigate("/confirmar")}
            disabled={paquetesEscaneados.length === 0}
          >
            Confirmar recepción
          </button>
        </div>
      </RoleGate>

      {/* Modal: agregar paquetes extra */}
      <Modal open={!!etiquetaModal} onClose={() => !generando && setEtiquetaModal(null)}>
        {etiquetaModal && (
          <div className="space-y-4">
            <h3 className="font-bold text-lg">Agregar paquetes</h3>
            <p className="text-sm text-gray-600">
              Producto: <strong>{etiquetaModal.code}</strong><br />
              Tiras por paquete: <strong>{etiquetaModal.qtyPerBundle}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">
                ¿Cuántos paquetes querés agregar?
              </label>
              <input
                ref={cantInputRef}
                type="number"
                min="1"
                className="w-full border rounded-lg px-3 py-2 text-base"
                value={cantInput}
                onChange={(e) => setCantInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConfirmarEtiquetas()}
                disabled={generando}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-lg border text-gray-700 disabled:opacity-50"
                onClick={() => setEtiquetaModal(null)}
                disabled={generando}
              >
                Cancelar
              </button>
              <button
                className="flex-1 py-2 rounded-lg bg-black text-white disabled:opacity-50"
                onClick={handleConfirmarEtiquetas}
                disabled={generando || !cantInput}
              >
                {generando ? "Generando…" : "Generar etiquetas"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Escanear;
