// src/pages/escanearQR.js
import React, { useContext, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import QrScanner from "components/QrScanner";
import { AppContext } from "context/AppContext";
import { setDoc, doc } from "firebase/firestore";
import { db } from "firebase.js";
import Toast from "components/Toast";
import { useHaptics } from "components/useHaptics";
import { getDeviceId, getAppVersion, getDeviceInfo } from "utils/telemetry";

function EscanearQR() {
  const navigate = useNavigate();
  const location = useLocation();
  const { productoCodigo, cantidadEsperada } = location.state || {};
  const { paquetesEscaneados, agregarPaquete, facturaSeleccionada } = useContext(AppContext);
  const { beep, vibrate } = useHaptics();

  const [toast, setToast] = useState(null); // { nro, cantidad }

  // Código Uru “puro” (antes del primer espacio). Si no hay productoCodigo, queda ''.
  const codigoEsperado = productoCodigo ? productoCodigo.toString().split(" ")[0].trim() : "";

  // Paquetes ya escaneados para este producto (comparando contra el código puro)
  const escaneados = paquetesEscaneados.filter(
    (p) => String(p.codigo_urualum).trim() === codigoEsperado
  );

  const handleScanSuccess = async (data) => {
    console.log("📦 Datos del QR escaneado:", data);

    // 1) Validar código del producto
    const codigoEscaneado = data?.codigo_urualum?.toString().trim();
    if (!codigoEsperado) {
      alert("❌ No se recibió información del producto a escanear.");
      return;
    }
    if (!codigoEscaneado) {
      alert("❌ QR sin 'codigo_urualum'.");
      return;
    }
    if (codigoEscaneado !== codigoEsperado) {
      alert(
        `❌ Este paquete no corresponde al producto que estás escaneando.\nEsperado: ${codigoEsperado} | Escaneado: ${codigoEscaneado}`
      );
      return;
    }

    // 2) Validar paquete duplicado
    const yaExiste = paquetesEscaneados.some(
      (p) => String(p.nro_paquete).trim() === String(data.nro_paquete).trim()
    );
    if (yaExiste) {
      alert(`⚠️ El paquete ${data.nro_paquete} ya fue escaneado.`);
      return;
    }

    // 3) Validar cantidad máxima
    if (escaneados.length >= Number(cantidadEsperada || 0)) {
      alert(
        `⚠️ Ya se escanearon todos los paquetes esperados para este producto.`
      );
      return;
    }

    // 4) Agregar al contexto (actualiza el contador en la UI)
// ✅ si todo OK:
    agregarPaquete({ codigo_urualum: data.codigo_urualum, nro_paquete: String(data.nro_paquete||""), cantidad: Number(data.cantidad||1) });

    try {
      const id = String(data.nro_paquete || "");
      await setDoc(doc(db, "recepcion_paquetes", id), {
        factura: facturaSeleccionada?.nroFactura ?? "",
        producto: data.codigo_urualum,
        cantidad: Number(data.cantidad || 1),
        nro_paquete: id,
        timestamp: new Date(),
        usuario: "operario1",
        deviceId: getDeviceId(),
        appVersion: getAppVersion(),
        deviceInfo: getDeviceInfo(),
      });

      // 🎯 feedback
      beep(); vibrate(70);
      setToast({ nro: id, cantidad: Number(data.cantidad || 1) });
      setTimeout(() => setToast(null), 1200);
    } catch (error) {
      alert("Error al guardar escaneo: " + (error?.message || JSON.stringify(error)));
    }
  };


  const descripcionRestante = productoCodigo
    ? productoCodigo.replace(codigoEsperado, "").trim()
    : "";

  return (
  <div className="container">
    {!productoCodigo ? (
      <>
        <div className="card" style={{ textAlign: "center" }}>
          <p className="h2">⚠️ No se recibió información del producto.</p>
          <button className="btn btn--secondary" onClick={() => navigate("/escanear")}>
            ⬅️ Volver
          </button>
        </div>
      </>
    ) : (
      <>
        <h2 className="h1">
          Escaneando producto: <span className="mono">{codigoEsperado}</span>{" "}
          {descripcionRestante}
        </h2>

        <div className="row">
          <span className="kpi">Esperados: {cantidadEsperada}</span>
          <span className="kpi">Escaneados: {escaneados.length}</span>
        </div>

        <div className="card" style={{ marginTop: "20px" }}>
          <QrScanner onScanSuccess={handleScanSuccess} />
        </div>

        <Toast open={!!toast}>
          Paquete <span className="mono">{toast?.nro}</span> registrado · Cant:{" "}
          {toast?.cantidad}
        </Toast>

        <button
          className="btn btn--secondary"
          style={{ marginTop: "20px" }}
          onClick={() => navigate("/escanear")}
        >
          ⬅️ Volver a lista de productos
        </button>
      </>
    )}
  </div>
);
}

export default EscanearQR;
