/*
import React, { useEffect } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { parseQR } from "utils/qr";

function QrScanner({ onScan, onScanSuccess }) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner("qr-reader", {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
    });

    const handleSuccess = (decodedText) => {
    const qr = parseQR(decodedText) || {};

    // SOLO necesitamos el código URU y la cantidad por paquete
    const codUru   = qr.codigo_urualum || qr.codUru || qr.codigo || qr.code || qr.cod || null;
    const packSize = Number(qr.cantidad || qr.tiras || qr.qty || qr.unidades || qr.pieces || 0);

    if (!codUru || !packSize) {
      alert("❌ QR inválido: falta código o cantidad.");
      return;
    }

    const payload = { ...qr, codUru, packSize }; // <- packSize normalizado
    onScan?.(payload);
    onScanSuccess?.(payload);
    scanner.clear().catch(() => {});
  };


    const handleError = () => {/* ruido normal del escaneo };

    scanner.render(handleSuccess, handleError);
    return () => { scanner.clear().catch(() => {}); };
  }, [onScan, onScanSuccess]);

  return <div id="qr-reader" style={{ width: "100%", maxWidth: 400, margin: "auto" }} />;
}

export default QrScanner;
*/

// src/components/QrScanner.js
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

function pickBackCamera(cameras) {
  if (!Array.isArray(cameras) || cameras.length === 0) return null;
  const back = cameras.find((c) => /back|rear|environment/i.test(c.label || ""));
  return back || cameras[0];
}

// Espera a que el contenedor exista y tenga tamaño visible
async function waitForVisibleElement(id, { tries = 30 } = {}) {
  for (let i = 0; i < tries; i++) {
    const el = document.getElementById(id);
    if (el && el.clientWidth > 0 && el.clientHeight > 0) return el;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return null;
}

/**
 * Props:
 *  - onScanSuccess(payload)
 *  - onError(err)
 *  - qrbox {width,height} (opcional)
 *  - fps (opcional, default 10)
 */
export default function QrScanner({ onScanSuccess, onError, qrbox, fps = 10 }) {
  const idRef = useRef(`qr-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const startedRef = useRef(false);
  const [status, setStatus] = useState("init"); // init | starting | ready | error
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setStatus("starting");

        // 1) Esperar a que el div esté presente y visible
        const el = await waitForVisibleElement(idRef.current, { tries: 60 });
        if (!mounted) return;
        if (!el) throw new Error("No se pudo inicializar la cámara (contenedor no visible)");

        // 2) Instanciar el scanner
        const html5QrCode = new Html5Qrcode(idRef.current, false);
        scannerRef.current = html5QrCode;

        // 3) Obtener cámaras
        const cameras = await Html5Qrcode.getCameras();
        if (!mounted) return;
        if (!cameras || cameras.length === 0) {
          throw new Error("No se detectaron cámaras en el dispositivo");
        }
        const cam = pickBackCamera(cameras);

        const config = {
          fps,
          qrbox: qrbox || { width: 250, height: 250 },
          rememberLastUsedCamera: true,
        };
        const onDecoded = (decodedText) => {
          let payload = decodedText;
          try {
            const obj = JSON.parse(decodedText);
            const codUru =
              obj.codigo_urualum || obj.codUru || obj.codigo || obj.code || null;
            const packSize = Number(obj.cantidad || obj.tiras || obj.qty || 0);
            payload = { ...obj, codUru, packSize };
          } catch {
            // si no es JSON, dejamos el string crudo
          }
          onScanSuccess?.(payload);
        };
        const onDecodeError = () => {
          // errores de decodificación por frame: ignorar
        };

        // 4) Iniciar con deviceId (más confiable que facingMode), con
        //    fallback a facingMode "environment" si la cámara puntual
        //    no puede abrirse con esos parámetros ("Could not start video source").
        try {
          await html5QrCode.start({ deviceId: { exact: cam.id } }, config, onDecoded, onDecodeError);
        } catch (errDeviceId) {
          console.warn("[QR] fallo con deviceId, reintentando con facingMode:", errDeviceId);
          await html5QrCode.start({ facingMode: "environment" }, config, onDecoded, onDecodeError);
        }

        if (!mounted) return;
        startedRef.current = true;
        setStatus("ready");
      } catch (err) {
        console.error("[QR] start error:", err);
        setErrMsg(err?.message || String(err));
        setStatus("error");
        onError?.(err);
      }
    })();

    return () => {
      mounted = false;
      const inst = scannerRef.current;

      if (inst && startedRef.current) {
        // stop() sí es promesa → OK usar .catch
        inst
          .stop()
          .catch(() => {})
          .then(() => {
            // clear() es síncrona → usar try/catch
            try { inst.clear(); } catch {}
          })
          .finally(() => {
            startedRef.current = false;
            scannerRef.current = null;
          });
      } else if (inst) {
        // Si nunca arrancó, intentar limpiar sin promesa
        try { inst.clear(); } catch {}
        scannerRef.current = null;
      }
    };

  }, [fps, qrbox, onScanSuccess, onError]);

  return (
    <div className="flex flex-col items-center">
      <div
        id={idRef.current}
        style={{
          width: "100%",
          maxWidth: 360,
          minHeight: 280, // importante: alto visible
          borderRadius: 12,
          overflow: "hidden",
          background: "#00000010",
        }}
      />
      <div className="text-xs text-gray-500 mt-2">
        {status === "starting" && "Inicializando cámara…"}
        {status === "ready" && "Apuntá al QR del paquete"}
        {status === "error" && <span className="text-red-600">{errMsg}</span>}
      </div>
    </div>
  );
}

