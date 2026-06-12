// src/modules/pedidos/services/etiquetasPDF.js
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import logoUrualum from "../../../logo-urualum.png";

// Logo cacheado como dataURL (se carga una sola vez)
let _logoDataUrl = null;
async function getLogoDataUrl() {
  if (_logoDataUrl) return _logoDataUrl;
  const res = await fetch(logoUrualum);
  const blob = await res.blob();
  _logoDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return _logoDataUrl;
}

// Tamaño físico de cada etiqueta (impresora TSC TE210)
const LABEL_W_MM = 70;
const LABEL_H_MM = 40;

// Datos fijos de Urualum / remitente — siempre iguales
const REMITENTE = {
  empresa: "NICUICO S.A.",
  direccion: "Isabela 3489",
  telefono: "Tel. 2216 9011",
};

// Escribe el nombre del cliente ajustando el tamaño de fuente (y partiendo
// en dos líneas si hace falta) para que entre en el ancho de la etiqueta.
function dibujarNombreCliente(doc, nombre, x, anchoDisponible) {
  const texto = nombre || "—";
  doc.setFont("helvetica", "bold");

  let fontSize = 14;
  const minFontSize = 9;
  while (fontSize > minFontSize && doc.getStringUnitWidth(texto) * fontSize / doc.internal.scaleFactor > anchoDisponible) {
    fontSize -= 1;
  }
  doc.setFontSize(fontSize);

  if (doc.getStringUnitWidth(texto) * fontSize / doc.internal.scaleFactor <= anchoDisponible) {
    doc.text(texto, x, 11);
    return;
  }

  // No entra en una línea ni reduciendo: partimos en dos líneas
  const lineas = doc.splitTextToSize(texto, anchoDisponible);
  doc.text(lineas.slice(0, 2), x, 9);
}

function dibujarEtiquetaCliente(doc, item) {
  const M = 5; // margen

  dibujarNombreCliente(doc, item.cliente, M, LABEL_W_MM - M * 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(item.direccion || "", M, 20);
  doc.text(item.localidad || "", M, 28);

  doc.setDrawColor(200);
  doc.line(M, 33, LABEL_W_MM - M, 33);

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(`Pedido #${item.numero}`, M, 38);
  doc.text("Vía: Camión / Gira", LABEL_W_MM - M, 38, { align: "right" });
  doc.setTextColor(0);
}

async function dibujarEtiquetaUrualum(doc, item, bultoActual) {
  const M = 5;

  // Logo Urualum
  const logoSize = 14;
  const logoData = await getLogoDataUrl();
  doc.addImage(logoData, "PNG", M, M, logoSize, logoSize);

  // Datos del remitente, al lado del logo
  const textX = M + logoSize + 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(REMITENTE.empresa, textX, 10);
  doc.text(REMITENTE.direccion, textX, 16);
  doc.text(REMITENTE.telefono, textX, 22);

  doc.setDrawColor(200);
  doc.line(M, 33, LABEL_W_MM - M, 33);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Pedido #${item.numero}`, M, 37);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Bulto ${bultoActual}/${item.bultos}`, LABEL_W_MM - M, 37, { align: "right" });

  // QR con pedido + bulto, para escaneo a futuro
  const qrData = await QRCode.toDataURL(`${item.pedidoId}|${bultoActual}/${item.bultos}`, { margin: 0 });
  const qrSize = 20;
  doc.addImage(qrData, "PNG", LABEL_W_MM - M - qrSize, 6, qrSize, qrSize);
}

/**
 * Genera un PDF con las etiquetas (cliente + Urualum) de cada bulto,
 * para todos los pedidos recibidos.
 *
 * @param {Array<{pedidoId, numero, cliente, direccion, localidad, bultos}>} items
 * @returns {Promise<jsPDF>}
 */
export async function generarEtiquetasPDF(items) {
  const doc = new jsPDF({
    unit: "mm",
    format: [LABEL_W_MM, LABEL_H_MM],
    orientation: "landscape",
  });

  let primera = true;
  for (const item of items) {
    const bultos = Math.max(1, Number(item.bultos) || 1);
    for (let b = 1; b <= bultos; b++) {
      if (!primera) doc.addPage([LABEL_W_MM, LABEL_H_MM], "landscape");
      primera = false;
      dibujarEtiquetaCliente(doc, item);

      doc.addPage([LABEL_W_MM, LABEL_H_MM], "landscape");
      await dibujarEtiquetaUrualum(doc, item, b);
    }
  }

  return doc;
}

export async function generarEImprimirEtiquetas(items) {
  const doc = await generarEtiquetasPDF(items);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
