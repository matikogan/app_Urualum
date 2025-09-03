import React, { useEffect } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

function QrScanner({ onScanSuccess }) {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner("qr-reader", {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
    });

    scanner.render(
      (decodedText, decodedResult) => {
        try {
          const data = JSON.parse(decodedText);
          onScanSuccess(data);
          scanner.clear(); // Detener escaneo tras éxito
        } catch (err) {
          alert("❌ Código QR inválido. Debe contener JSON válido.");
        }
      },
      (errorMessage) => {
        console.log("Error de escaneo:", errorMessage);
      }
    );

    return () => {
      scanner.clear().catch((err) =>
        console.error("Error limpiando scanner", err)
      );
    };
  }, [onScanSuccess]);

  return <div id="qr-reader" style={{ width: "100%", maxWidth: 400, margin: "auto" }} />;
}

export default QrScanner;
