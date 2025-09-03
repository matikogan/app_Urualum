// src/pages/factura.js
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFacturasImportacionPendientes } from "API/finnegans";
import { AppContext } from "context/AppContext";
import { useAuth } from "context/AuthContext";
import { db } from "firebase.js";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import BackButton from "components/BackButton";



function Factura() {
  const navigate = useNavigate();
  const { setFacturaSeleccionada } = useContext(AppContext);
  const { profile, user } = useAuth();
  const [facturas, setFacturas] = useState([]);
  const isEncargado = profile?.role === "Encargado";

  // Encargado: carga lista
  useEffect(() => {
    if (!isEncargado) return;
    (async () => {
      try {
        const data = await getFacturasImportacionPendientes();
        setFacturas(data || []);
      } catch (e) {
        console.error("❌ Error cargando facturas:", e);
      }
    })();
  }, [isEncargado]);

  // Operario: escucha la selección publicada
  useEffect(() => {
    if (isEncargado) return; // el encargado sí ve la lista
    const ref = doc(db, "estado", "recepcion_actual");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        // no hay selección aún
        setFacturaSeleccionada(null);
        return;
      }
      const factura = snap.data();
      setFacturaSeleccionada(factura);
      navigate("/escanear");
    });
    return () => unsub();
  }, [isEncargado, navigate, setFacturaSeleccionada]);

  const publicarSeleccion = async (factura) => {
    // guardamos TODO el objeto de factura (incluye productos)
    const ref = doc(db, "estado", "recepcion_actual");
    await setDoc(ref, {
      ...factura,
      seleccionadaPor: user?.uid || null,
      estado: "abierta",
      publishedAt: new Date(),
    });
    setFacturaSeleccionada(factura);
    navigate("/escanear");
  };

  // UI por rol
  if (!isEncargado) {
    return (
      <div className="container">
        <h2 className="h1">Recepción de importación</h2>
        <div className="card empty-card">
          <p className="h2" style={{ margin: 0 }}>Esperando selección…</p>
          <p className="muted">
            Cuando el <strong>Encargado</strong> seleccione una factura, vas a ver el detalle automáticamente.
          </p>
        </div>
      </div>
    );
  }

  // Encargado
  return (
    <div className="container">
      <BackButton />
      <h2 className="h1">Seleccionar factura de importación</h2>

      {facturas.length === 0 ? (
        <div className="card empty-card">
          <p className="h2" style={{ margin: 0 }}>No hay facturas pendientes</p>
          <p className="muted">Cuando existan facturas para recibir, aparecerán aquí.</p>
        </div>
      ) : (
        <div className="invoice-grid">
          {facturas.map((factura, index) => (
            <div key={index} className="card card--highlight card--selectable">
              <div className="card-header">Factura N° {factura.nroFactura}</div>

              <div className="meta">
                <div className="meta-item">
                  <span className="meta-label">Impo</span>
                  <span className="meta-value mono">{factura.comprobante}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Proveedor</span>
                  <span className="meta-value">{factura.proveedor}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Fecha</span>
                  <span className="meta-value">{factura.fecha}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Productos</span>
                  <span className="meta-value">{factura.productos?.length ?? 0}</span>
                </div>
              </div>

              <div className="btn-center">
                <button
                  type="button"
                  className="btn btn--primary btn-big btn--elevated"
                  onClick={() => publicarSeleccion(factura)}
                >
                  Seleccionar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Factura;
