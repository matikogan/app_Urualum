import { parseDescripcionPedido } from "./parseDescripcionPedido";

// Mapeo nombre → código de condición de pago (Finnegans no devuelve el código)
const CONDICION_PAGO_MAP = {
  "10 dias":               "10",
  "15 dias":               "15",
  "3 cuotas":              "3 CUOTAS",
  "30 dias":               "30",
  "30, 60 y 90 días":      "306090",
  "30, 60 y 90 dias":      "306090",
  "60 dias":               "60",
  "7 dias":                "7 dias",
  "90 dias":               "90",
  "contado efectivo":      "CE",
  "crédito":               "CREDITO",
  "credito":               "CREDITO",
  "débito automático":     "DEBAUT",
  "debito automatico":     "DEBAUT",
  "fecha del documento":   "CPG_FECHADOC",
  "tarjeta de debito":     "TARJDEB",
  "tarjeta de débito":     "TARJDEB",
  "transferencia bancaria":"Transferencia",
  "transferencia":         "Transferencia",
};

export function resolverCondicionPagoCod(nombre) {
  if (!nombre) return null;
  return CONDICION_PAGO_MAP[nombre.toLowerCase().trim()] || null;
}

// Extrae solo el código numérico del producto: "512523443 Superior Mos..." → "512523443"
export function extraerCodigoProducto(raw) {
  if (!raw) return "";
  const match = String(raw).trim().match(/^(\d+)/);
  return match ? match[1] : String(raw).trim();
}

// --- PARSER ROBUSTO DE FECHA DESDE FINNEGANS ---
function normalizeToYMD(d) {
  // retorna "YYYY-MM-DD" o null
  try {
    if (d instanceof Date) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    if (typeof d === "number") {
      // epoch ms
      return normalizeToYMD(new Date(d));
    }
    const s = String(d || "").trim();
    if (!s) return null;

    // yyyy-mm-dd
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    // dd/mm/yyyy
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    // dd-mm-yyyy (caso que viste en el log)
    m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    // yyyymmdd
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    // /Date(1695600000000)/
    m = s.match(/^\/Date\((\d+)\)\/$/);
    if (m) return normalizeToYMD(new Date(Number(m[1])));

    // ISO (yyyy-mm-ddThh:mm:ssZ)
    m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (m) return m[1];

    return null;
  } catch {
    return null;
  }
}

function parseFinFecha(fin) {
  if (!fin || typeof fin !== "object") return null;

  // Claves preferidas según tu inspección
  const preferredKeys = [
    "FECHACOMPROBANTE", // la vimos en el log
    "FECHA",            // la vimos en el log
    "FECHADOC",
    "DOCFECHA",
    "Fecha",
    "FechaDocumento",
    "FechaEmision",
    "FECHAEMISION",
    "FECHACREACION",
    "FecDoc",
    "FEC"
  ];

  for (const k of preferredKeys) {
    if (k in fin) {
      const ymd = normalizeToYMD(fin[k]);
      if (ymd) return ymd;
    }
  }

  // Si no encontramos en preferidas, probar cualquier clave con "fecha"
  for (const [k, v] of Object.entries(fin)) {
    if (/fecha/i.test(k)) {
      const ymd = normalizeToYMD(v);
      if (ymd) return ymd;
    }
  }

  // Último recurso: cualquier valor que parezca fecha
  for (const v of Object.values(fin)) {
    const ymd = normalizeToYMD(v);
    if (ymd) return ymd;
  }
  return null;
}

/**
 * Mapea UNA FILA del reporte analisisPedidoVenta (Finnegans)
 * a nuestro pedido en Firestore.
 */

/**
 * Normaliza cualquier variante del ID Finnegans a "PEDVTA - XXXXX".
 * Finnegans manda el mismo número en campos distintos según el reporte:
 *   DOCNROINT = "18885"                 → solo número
 *   IDENTIFICACIONEXTERNA = "PEDVTA - 18885"  → con prefijo
 * Sin normalización se crean dos documentos Firestore distintos para el mismo pedido.
 */
function canonicalizePedidoId(raw) {
  const s = String(raw || "").replace(/\u00A0/g, " ").trim();
  if (!s) return null;
  // Ya tiene prefijo PEDVTA (con cualquier variante de espaciado/guión)
  const m = s.match(/^PEDVTA\s*-\s*(.+)$/i);
  if (m) return `PEDVTA - ${m[1].trim()}`;
  // Solo el número u otro formato → agregar prefijo canónico
  return `PEDVTA - ${s}`;
}

export function mapFinDocToPedido(fin) {
  if (!fin) return null;

  // 1) ID / número del pedido — siempre normalizado a "PEDVTA - XXXXX"
  const rawId =
    fin.DOCNROINT ||
    fin.DocNroInt ||
    fin.NUMERODOCUMENTO ||
    fin.NumeroDocumento ||
    fin.NUMERO ||
    fin.numero ||
    fin.IDENTIFICACIONEXTERNA ||
    fin.IdentificacionExterna ||
    fin.ID ||
    fin.Nombre ||
    "";

  const id = canonicalizePedidoId(rawId);
  if (!id) return null;


  // 2) Datos base
  const cliente = String(fin.CLIENTE || fin.Cliente || "").trim();
  const descripcion = String(fin.DESCRIPCION || fin.Descripcion || "").trim();

  // 2.1) Código de cliente — NRODEIDENTIFICACION es el código Finnegans (coincide con RUT)
  const clienteCodigo =
    fin.CLIENTECODIGO || fin.ClienteCodigo ||
    fin.ORGANIZACIONCODIGO || fin.OrganizacionCodigo ||
    fin.CODIGOCLIENTE || fin.CodigoCliente ||
    fin.CLIENTEID || fin.ClienteId ||
    // fallback: NRODEIDENTIFICACION es el mismo código que usa /cliente/{codigo}
    fin.NRODEIDENTIFICACION || fin.NroDeIdentificacion ||
    null;

  // 3) Depósito / método desde la descripción "ISABELA - RETIRA"
  const {
    deposito: depParsed,
    metodoEntrega: metParsed,
    agencia: agenciaParsed,
    camionDestino: camionDestinoParsed,
    camionFechaStr: camionFechaStrParsed,
    esCotizacion,
  } = parseDescripcionPedido(descripcion);


  // 4) Producto, cantidad y precio (viene por fila — una fila = un ítem)
  const prodRaw  = String(fin.PRODUCTO || fin.Producto || fin.ProductoCodigo || "").trim();
  const prodCod  = extraerCodigoProducto(prodRaw); // solo el código numérico
  const prodCant = Number(fin.CANTIDAD ?? fin.Cantidad ?? 0);

  // Precio en moneda secundaria (USD) y principal (UYU)
  const prodPrecioUSD = Number(fin.PRECIO ?? fin.PRECIOMONSECUNDARIA ?? fin.Precio ?? 0);
  const prodPrecioUYU = Number(fin.PRECIOMONPRINCIPAL ?? 0);
  const prodImporteUSD = Number(fin.IMPORTEMONSECUNDARIA ?? fin.IMPORTE ?? fin.Importe ?? 0);
  const prodImporteUYU = Number(fin.IMPORTEMONPRINCIPAL ?? 0);

  const productos = prodCod ? [{
    cod:         prodCod,
    desc:        prodRaw,           // descripción completa para mostrar en UI
    cant:        prodCant || 0,
    precioUSD:   prodPrecioUSD || null,
    precioUYU:   prodPrecioUYU || null,
    importeUSD:  prodImporteUSD || null,
    importeUYU:  prodImporteUYU || null,
  }] : [];

  // 5) Datos de pago y cliente (nivel pedido — tomamos de la primera fila)
  const condicionPago     = String(fin.CONDICIONPAGO || fin.CondicionPago || "").trim() || null;
  // El código no viene de la API — lo resolvemos desde el nombre
  const condicionPagoCod  = String(fin.CONDICIONPAGOCODIGO || fin.CondicionPagoCodigo || "").trim() || resolverCondicionPagoCod(condicionPago) || null;
  const clienteRUT        = String(
    fin.NRODEIDENTIFICACION || fin.NroDeIdentificacion ||
    fin.IdentificacionTributariaNumero ||
    fin.RUT || fin.Rut || ""
  ).trim() || null;
  const cotizacion        = Number(fin.COTIZACION ?? fin.Cotizacion ?? 0) || null;
  const moneda            = String(fin.MONEDA || fin.Moneda || "").trim() || null;

  const finFecha = parseFinFecha(fin);

  return {
      id,
      numero: id,
      cliente,
      clienteCodigo:   clienteCodigo ? String(clienteCodigo).trim() : null,
      clienteRUT,
      descripcion,
      deposito:        esCotizacion ? "COTIZACION" : (depParsed || null),
      metodoEntrega:   metParsed || null,
      agencia:         agenciaParsed || null,
      camionDestino:   camionDestinoParsed || null,
      camionFechaStr:  camionFechaStrParsed || null,
      productos,
      condicionPago,
      condicionPagoCod,
      cotizacion,
      moneda,
      source:          "finnegans",
      finFecha:        finFecha || null,
      esCotizacion:    !!esCotizacion,
  };

}
