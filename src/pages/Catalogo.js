import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc, collection, getDocs, query, where, limit } from "firebase/firestore";

import { functions, db } from "../firebase";
import { calcularPrecioFinal } from "../utils/priceCalculator";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import SelectorCantidad, { obtenerLimiteProducto } from "../components/SelectorCantidad";
import CarouselNovedades from '../components/CarouselNovedades';
import ProductModal from "../components/ProductModal";
import ProductCard from "../components/ProductCard";

// ==========================================================
// 🔥 LISTA MANUAL DE OFERTAS
// ==========================================================
const PRODUCTOS_EN_OFERTA = [
    "502028111", 
    "502028112",
    "513000121",
    "513000131"
];

// ==========================================================
// 📦 DEFINICIÓN DE KITS VIRTUALES (ARMADOS)
// Acá podés inventar todos los kits que quieras.
// ==========================================================
const KITS_VIRTUALES = [
    {
        id: "KIT-S20 ANODIZADO",
        customerNo: "Kit Serie 20 Anodizado",
        descripcion: "Incluye: 1891(1), 1901(1), 1911(1), 1921(1), 1931(1)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 20",
        rama2: "Kit S20",
        color: "Anodizado",
        esKit: true,
        componentes: [
            { codigo: "502001891", cantidad: 1, desc: "Enganche central S20 Anod" },
            { codigo: "502001901", cantidad: 1, desc: "Zócalo S20 Anod" },
            { codigo: "502001911", cantidad: 1, desc: "Pierna S20 Anod" },
            { codigo: "502001921", cantidad: 1, desc: "Dintel S20 Anod" },
            { codigo: "502001931", cantidad: 1, desc: "Umbral S20 Anod" }
        ]
    },
    {
        id: "KIT-S20 Blanco",
        customerNo: "Kit Serie 20 Blanco",
        descripcion: "Incluye: 1894(1), 1904(1), 1914(1), 1924(1), 1934(1)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 20",
        rama2: "Kit S20",
        color: "Blanco", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502001894", cantidad: 1, desc: "Enganche central S20 Blanco" },
            { codigo: "502001904", cantidad: 1, desc: "Zócalo S20 Blanco" },
            { codigo: "502001914", cantidad: 1, desc: "Pierna S20 Blanco" },
            { codigo: "502001924", cantidad: 1, desc: "Dintel S20 Blanco" },
            { codigo: "502001934", cantidad: 1, desc: "Umbral S20 Blanco" }
        ]
    },
    {
        id: "KIT-S20 Anolok",
        customerNo: "Kit Serie 20 Anolok",
        descripcion: "Incluye: 1893(1), 1903(1), 1913(1), 1923(1), 1933(1)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 20",
        rama2: "Kit S20",
        color: "Anolok", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502001893", cantidad: 1, desc: "Enganche central S20 Anolok" },
            { codigo: "502001903", cantidad: 1, desc: "Zócalo S20 Anolok" },
            { codigo: "502001913", cantidad: 1, desc: "Pierna S20 Anolok" },
            { codigo: "502001923", cantidad: 1, desc: "Dintel S20 Anolok" },
            { codigo: "502001933", cantidad: 1, desc: "Umbral S20 Anolok" }
        ]
    },
    {
        id: "KIT-S20 Madera",
        customerNo: "Kit Serie 20 Madera",
        descripcion: "Incluye: 1892(1), 1902(1), 1912(1), 1922(1), 1932(1)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 20",
        rama2: "Kit S20",
        color: "Madera", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502001892", cantidad: 1, desc: "Enganche central S20 Madera" },
            { codigo: "502001902", cantidad: 1, desc: "Zócalo S20 Madera" },
            { codigo: "502001912", cantidad: 1, desc: "Pierna S20 Madera" },
            { codigo: "502001922", cantidad: 1, desc: "Dintel S20 Madera" },
            { codigo: "502001932", cantidad: 1, desc: "Umbral S20 Madera" }
        ]
    },
    {
        id: "KIT-S25 Anodizado",
        customerNo: "Kit Serie 20 Anodizado",
        descripcion: "Incluye: 2500(1), 2501(1), 2528(1), 4503(1), 4504(1), 4505(1), 4507(1)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 25",
        rama2: "Kit S25",
        color: "Anoddizado", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502525001", cantidad: 1, desc: "Marco Inferior S25 Anodizado" },
            { codigo: "502525011", cantidad: 1, desc: "Marco Lateral S25 Anodizado" },
            { codigo: "502525281", cantidad: 1, desc: "Marco Superior S25 Anodizado" },
            { codigo: "502545031", cantidad: 1, desc: "Zocalo Hoja S25 Anodizado" },
            { codigo: "502545041", cantidad: 1, desc: "Dintel Hoja S25 Anodizado" },
            { codigo: "502545051", cantidad: 1, desc: "Lateral Hoja S25 Anodizado" },
            { codigo: "502545071", cantidad: 1, desc: "Enganche Central S25 Anodizado" } 
        ]
    },
    {
        id: "KIT-S25 Madera",
        customerNo: "Kit Serie 20 Madera",
        descripcion: "Incluye: 2500(2), 2501(2), 2528(2), 4503(2), 4504(2), 4505(2), 4507(2)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 25",
        rama2: "Kit S25",
        color: "Madera", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502525002", cantidad: 1, desc: "Marco Inferior S25 Madera" },
            { codigo: "502525012", cantidad: 1, desc: "Marco Lateral S25 Madera" },
            { codigo: "502525282", cantidad: 1, desc: "Marco Superior S25 Madera" },
            { codigo: "502545032", cantidad: 1, desc: "Zocalo Hoja S25 Madera" },
            { codigo: "502545042", cantidad: 1, desc: "Dintel Hoja S25 Madera" },
            { codigo: "502545052", cantidad: 1, desc: "Lateral Hoja S25 Madera" },
            { codigo: "502545072", cantidad: 1, desc: "Enganche Central S25 Madera" } 
        ]
    },
    {
        id: "KIT-S25 Anolok",
        customerNo: "Kit Serie 20 Anolok",
        descripcion: "Incluye: 2500(3), 2501(3), 2528(3), 4503(3), 4504(3), 4505(3), 4507(3)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 25",
        rama2: "Kit S25",
        color: "Anolok", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502525003", cantidad: 1, desc: "Marco Inferior S25 Anolok" },
            { codigo: "502525013", cantidad: 1, desc: "Marco Lateral S25 Anolok" },
            { codigo: "502525283", cantidad: 1, desc: "Marco Superior S25 Anolok" },
            { codigo: "502545033", cantidad: 1, desc: "Zocalo Hoja S25 Anolok" },
            { codigo: "502545043", cantidad: 1, desc: "Dintel Hoja S25 Anolok" },
            { codigo: "502545053", cantidad: 1, desc: "Lateral Hoja S25 Anolok" },
            { codigo: "502545073", cantidad: 1, desc: "Enganche Central S25 Anolok" } 
        ]
    },
    {
        id: "KIT-S25 Blanco",
        customerNo: "Kit Serie 20 Blanco",
        descripcion: "Incluye: 2500(4), 2501(4), 2528(4), 4503(4), 4504(4), 4505(4), 4507(4)",
        padre: "Perfiles Aluminio", 
        rama1: "Serie 25",
        rama2: "Kit S25",
        color: "Blanco", // Para que le ponga el circulito de color gris
        esKit: true,
        componentes: [
            { codigo: "502525004", cantidad: 1, desc: "Marco Inferior S25 Blanco" },
            { codigo: "502525014", cantidad: 1, desc: "Marco Lateral S25 Blanco" },
            { codigo: "502525284", cantidad: 1, desc: "Marco Superior S25 Blanco" },
            { codigo: "502545034", cantidad: 1, desc: "Zocalo Hoja S25 Blanco" },
            { codigo: "502545044", cantidad: 1, desc: "Dintel Hoja S25 Blanco" },
            { codigo: "502545054", cantidad: 1, desc: "Lateral Hoja S25 Blanco" },
            { codigo: "502545074", cantidad: 1, desc: "Enganche Central S25 Blanco" } 
        ]
    },
    // Podés agregar otro kit poniendo una coma acá y copiando el bloque de arriba
];

export default function Catalogo() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isVendedorAdmin = profile?.role === "ventas" || profile?.role === "encargado" || profile?.role === "admin";
  const { 
      reglasPrecios, setReglasPrecios, 
      setNombreLista, 
      carrito, agregarAlCarrito,
      clienteActivo
  } = useApp();

  const [filtroPadre, setFiltroPadre] = useState(null);
  const [filtroRama1, setFiltroRama1] = useState(null);
  const [filtroColor, setFiltroColor] = useState(null);
  const [productosFiltrados, setProductosFiltrados] = useState([]);
  const [loadingProd, setLoadingProd] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [resultadosBusqueda, setResultadosBusqueda] = useState(null);
  const [loadingBusqueda, setLoadingBusqueda] = useState(false);

  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [precioCalculado, setPrecioCalculado] = useState(0);
  const [stockInfo, setStockInfo] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingPrecio, setLoadingPrecio] = useState(false);
  // 🔥 NUEVO: Estado para recordar qué categorías (Rama2) están cerradas
  const [seccionesColapsadas, setSeccionesColapsadas] = useState({});

  // MENÚ ESTRUCTURA (Ya no hay categoría "Kits Armados")
  const MENU_ESTRUCTURA = [
    { nombre: "🔥 Ofertas", subcategorias: [] },
    { 
      nombre: "Perfiles Aluminio", 
      subcategorias: [
        { nombre: "Serie 20", colores: ["Anodizado", "Blanco", "Madera", "Anolok", "Sin Acabado"] },
        { nombre: "Serie 25", colores: ["Anodizado", "Blanco", "Madera", "Anolok"] },
        { nombre: "Puerta / Serie 30", colores: ["Anodizado", "Blanco", "Madera", "Anolok", "Sin Anodizar"] },
        { nombre: "Americana", colores: ["Anodizado", "Kit"] },
        { nombre: "Mampara", colores: ["Anodizado", "Blanco", "Anolok", "Madera"] },
        { nombre: "Angulo", colores: ["Anodizado", "Blanco", "Anolok"] },
        { nombre: "Tubo", colores: ["Anodizado", "Blanco", "Anolok", "Madera", "Small"] },
        { nombre: "Perfil U", colores: ["Anodizado", "Blanco", "Anolok"] },
        { nombre: "Baranda", colores: ["Anodizado"] }
      ] 
    },
    { 
      nombre: "Accesorio Aluminio", 
      subcategorias: [
        { nombre: "Kit", colores: [] } ,{ nombre: "Bisagra", colores: [] }, { nombre: "Burlete", colores: [] }, { nombre: "Cerraduras, Cierres y Manijas", colores: [] },
        { nombre: "Felpa", colores: [] }, { nombre: "Rodamiento", colores: [] }, { nombre: "Varios", colores: [] },
        { nombre: "Insumos DVH", colores: [] }, { nombre: "Plasticos", colores: [] }, { nombre: "Tejido Mosquitero", colores: [] }
      ] 
    },
    { nombre: "Accesorio PVC", subcategorias: [{ nombre: "50 LIK", colores: [] }, { nombre: "Bayindir", colores: [] }, { nombre: "50 LIK / Bayindir", colores: [] }] },
    { nombre: "Chapa de aluminio", subcategorias: [{ nombre: "Lisa", colores: [] }, { nombre: "Antideslizante", colores: [] }] },
    { nombre: "Perfiles PVC", subcategorias: [{ nombre: "Bayindir", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "50 LIK", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "50 LIK / Bayindir", colores: ["Blanco", "Negro", "Madera", "Antracita"] }, { nombre: "Refuerzo", colores: [] }] },
    { nombre: "Vidrio", subcategorias: [{ nombre: "Laminados", colores: [] }, { nombre: "Float", colores: [] }] },
  ];

  const MAPA_COLORES = {
    "Anodizado": "#b5babe", 
    "Blanco": "#ffffff",    
    "Anolok": "#2c2c2c",    
    "Madera": "#8b5a2b",    
    "Natural": "#d1d5d8",   
    "Negro": "#1a1a1a",     
  };

  useEffect(() => {
        const cargarReglas = async () => {
            // 🔥 LA MAGIA: Elegimos el código del vendedor o el del cliente real
            const codigoUsar = clienteActivo?.finnegansClienteCodigo || profile?.finnegansClienteCodigo;
            
            if (!codigoUsar) return; 

            try {
                // Le preguntamos a Finnegans qué lista tiene asignada HOY
                const fn = httpsCallable(functions, "finnegansGetCliente");
                const res = await fn({ codigo: codigoUsar });
                
                console.log("🕵️‍♂️ DATOS CRUDOS DE FINNEGANS:", res.data.cliente);

                // 👇 ESTA ES LA LÍNEA QUE SE HABÍA BORRADO 👇
                const listaCod = res.data.cliente?.ListaPrecioDefaultCodigo;
                
                if(listaCod) {
                    setNombreLista(listaCod);
                    
                    // Vamos a Firebase a buscar los descuentos exactos de esa lista
                    const docSnap = await getDoc(doc(db, "config_lista_precios", listaCod));
                    if(docSnap.exists()) {
                        setReglasPrecios(docSnap.data().rules);
                    } else {
                        console.error("❌ OJO: Finnegans pidió la lista", listaCod, "pero no existe en Firebase.");
                    }
                }
            } catch (e) { 
                console.error("Error al actualizar reglas de precio:", e); 
            }
        };
        
        cargarReglas();
    }, [profile?.finnegansClienteCodigo, clienteActivo, setNombreLista, setReglasPrecios]);

  useEffect(() => {
    const timer = setTimeout(async () => {
        if (busqueda.trim().length < 2) {
            setResultadosBusqueda(null);
            setLoadingBusqueda(false);
            return;
        }

        setLoadingBusqueda(true);
        try {
            let todosLosProductos = [];

            if (filtroPadre === "🔥 Ofertas") {
                if (PRODUCTOS_EN_OFERTA.length === 0) return setResultadosBusqueda([]);
                for (let i = 0; i < PRODUCTOS_EN_OFERTA.length; i += 10) {
                    const chunk = PRODUCTOS_EN_OFERTA.slice(i, i + 10);
                    const qOfertas = query(collection(db, "catalogoProductos"), where("codUru", "in", chunk));
                    const snap = await getDocs(qOfertas);
                    todosLosProductos = [...todosLosProductos, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
                }
            } 
            else {
                // Filtramos también los kits que cumplan con la categoría actual
                const kitsFiltrados = KITS_VIRTUALES.filter(k => 
                    (!filtroPadre || k.padre === filtroPadre) && 
                    (!filtroRama1 || k.rama1 === filtroRama1) && 
                    (!filtroColor  || k.color === filtroColor)
                );

                let restricciones = [];
                if (filtroPadre) restricciones.push(where("padre", "==", filtroPadre));
                if (filtroRama1) restricciones.push(where("rama1", "==", filtroRama1));
                if (filtroColor)  restricciones.push(where("color", "==", filtroColor));

                const q = query(collection(db, "catalogoProductos"), ...restricciones);
                const snap = await getDocs(q);
                const productosDB = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Unimos kits y productos normales
                todosLosProductos = [...kitsFiltrados, ...productosDB];
            }
            
            const termLower = busqueda.toLowerCase();
            const filtrados = todosLosProductos.filter(p => {
                const desc = p.descripcion ? p.descripcion.toLowerCase() : "";
                const cod = p.codUru ? p.codUru.toLowerCase() : "";
                const cust = p.customerNo ? p.customerNo.toLowerCase() : "";
                return desc.includes(termLower) || cod.includes(termLower) || cust.includes(termLower);
            });

            setResultadosBusqueda(filtrados);
        } catch (err) {
            console.error("Error en búsqueda:", err);
        } finally {
            setLoadingBusqueda(false);
        }
    }, 600);

    return () => clearTimeout(timer);
  }, [busqueda, filtroPadre, filtroRama1, filtroColor]);

  const toggleFiltroPadre = (padre) => {
    if (filtroPadre === padre) {
        setFiltroPadre(null); setFiltroRama1(null); setFiltroColor(null);
        setProductosFiltrados([]);
    } else {
        setFiltroPadre(padre); setFiltroRama1(null); setFiltroColor(null);
        cargarProductos(padre, null, null);
    }
    setBusqueda(""); setResultadosBusqueda(null);
    };

    const toggleFiltroRama1 = (rama1) => {
    if (filtroRama1 === rama1) {
        setFiltroRama1(null); setFiltroColor(null);
        cargarProductos(filtroPadre, null, null);
    } else {
        setFiltroRama1(rama1); setFiltroColor(null);
        cargarProductos(filtroPadre, rama1, null);
    }
    setBusqueda(""); setResultadosBusqueda(null);
    };

    const toggleFiltroColor = (color) => {
    if (filtroColor === color) {
        setFiltroColor(null);
        cargarProductos(filtroPadre, filtroRama1, null);
    } else {
        setFiltroColor(color);
        cargarProductos(filtroPadre, filtroRama1, color);
    }
    setBusqueda(""); setResultadosBusqueda(null);
    };

  const cargarProductos = async (padre, rama1, color) => {
    try {
        setLoadingProd(true);

        if (padre === "🔥 Ofertas") {
            if (PRODUCTOS_EN_OFERTA.length === 0) return setProductosFiltrados([]);
            let todosLosProductos = [];
            for (let i = 0; i < PRODUCTOS_EN_OFERTA.length; i += 10) {
                const chunk = PRODUCTOS_EN_OFERTA.slice(i, i + 10);
                const qOfertas = query(collection(db, "catalogoProductos"), where("codUru", "in", chunk));
                const snap = await getDocs(qOfertas);
                todosLosProductos = [...todosLosProductos, ...snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
            }
            setProductosFiltrados(todosLosProductos);
            return;
        }

        // LÓGICA NORMAL: Buscar en Firebase
        let restricciones = [where("padre", "==", padre)];
        if (rama1) restricciones.push(where("rama1", "==", rama1));
        if (color) restricciones.push(where("color", "==", color));
        const q = query(collection(db, "catalogoProductos"), ...restricciones, limit(50));
        const querySnapshot = await getDocs(q);
        const productosDB = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sumar los kits virtuales que coincidan con la ruta en la que está el cliente
        const kitsInfiltrados = KITS_VIRTUALES.filter(k => 
            k.padre === padre && 
            (!rama1 || k.rama1 === rama1) && 
            (!color || k.color === color)
        );

        // Los kits se ponen primeros en la lista, y luego los productos normales
        setProductosFiltrados([...kitsInfiltrados, ...productosDB]);

    } catch (err) { console.error(err); } finally { setLoadingProd(false); }
  };

  const seleccionarProducto = async (p) => {
    setProductoSeleccionado(p);
    setStockInfo(null); setPrecioCalculado(0); setCantidad(1);
    
    // =======================================================
    // LÓGICA DE KITS
    // =======================================================
    if (p.esKit) {
        setLoadingStock(true);
        setLoadingPrecio(true);
        try {
            // 🔥 Consultamos stock en R8 y en ISA al mismo tiempo
            const promesasStockR8 = p.componentes.map(c => httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: c.codigo, deposito: "RUTA8" }).catch(() => ({ data: { stock: [] } })));
            const promesasStockIsa = p.componentes.map(c => httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: c.codigo, deposito: "ISABELA" }).catch(() => ({ data: { stock: [] } })));
            const promesasPrecio = p.componentes.map(c => httpsCallable(functions, "finnegansGetProductoDetalle")({ codigo: c.codigo }).catch(() => ({ data: { producto: {} } })));
            
            const resStocksR8 = await Promise.all(promesasStockR8);
            const resStocksIsa = await Promise.all(promesasStockIsa);
            const resPrecios = await Promise.all(promesasPrecio);

            let stockMinimoR8 = Infinity;
            let stockMinimoIsa = Infinity;
            let precioTotalKit = 0;
            const componentesResueltos = [];

            p.componentes.forEach((c, index) => {
                const stockAPI_R8 = resStocksR8[index].data?.stock?.[0]?.Cantidad || 0;
                const posiblesKitsR8 = c.cantidad > 0 ? Math.floor(stockAPI_R8 / c.cantidad) : 0;
                if (posiblesKitsR8 < stockMinimoR8) stockMinimoR8 = posiblesKitsR8;

                const stockAPI_Isa = resStocksIsa[index].data?.stock?.[0]?.Cantidad || 0;
                const posiblesKitsIsa = c.cantidad > 0 ? Math.floor(stockAPI_Isa / c.cantidad) : 0;
                if (posiblesKitsIsa < stockMinimoIsa) stockMinimoIsa = posiblesKitsIsa;

                const precioBaseAPI = Number(resPrecios[index].data?.producto?.PrecioBase || 0);
                const precioFinalC = calcularPrecioFinal(precioBaseAPI, reglasPrecios, c.codigo);
                precioTotalKit += (precioFinalC * c.cantidad);

                componentesResueltos.push({
                    codigo: c.codigo,
                    cantidadBase: c.cantidad,
                    precioUnitario: precioFinalC,
                    desc: c.desc
                });
            });

            if (stockMinimoR8 === Infinity) stockMinimoR8 = 0;
            if (stockMinimoIsa === Infinity) stockMinimoIsa = 0;
            
            // Unimos el stock global para que el botón no se bloquee si hay en alguna de las 2 sucursales
            setStockInfo({ 
                Cantidad: Math.max(stockMinimoR8, stockMinimoIsa), 
                r8: stockMinimoR8, 
                isa: stockMinimoIsa, 
                Unidad: "Kit" 
            });
            setPrecioCalculado(Math.round((precioTotalKit + Number.EPSILON) * 100) / 100);
            setProductoSeleccionado({ ...p, componentesResueltos }); 
        } catch(e) { 
            console.error(e); 
        } finally { 
            setLoadingStock(false); setLoadingPrecio(false); 
        }
    } 
    // =======================================================
    // LÓGICA NORMAL (Producto Único)
    // =======================================================
    else {
        const codFinn = p.codUru || p.codigo;
        if (!codFinn) return;

        const esKitManual = p.color && p.color.toLowerCase() === "kit";

        if (esKitManual) {
            setStockInfo({ Cantidad: 9999, r8: "+999", isa: "+999", Unidad: "Kit" }); 
            setLoadingStock(false);
        } else {
            setLoadingStock(true);
            Promise.all([
                httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: codFinn, deposito: "RUTA8" }).catch(() => ({ data: { stock: [] } })),
                httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: codFinn, deposito: "ISABELA" }).catch(() => ({ data: { stock: [] } }))
            ]).then(([resR8, resIsa]) => {
                const stockR8 = resR8.data.stock?.[0]?.Cantidad || 0;
                const stockIsa = resIsa.data.stock?.[0]?.Cantidad || 0;
                
                setStockInfo({
                    Cantidad: Math.max(stockR8, stockIsa), // Permite comprar si hay en cualquiera de los dos
                    r8: stockR8,
                    isa: stockIsa,
                    Unidad: resR8.data.stock?.[0]?.Unidad || "Un."
                });
            }).finally(() => setLoadingStock(false));
        }

        setLoadingPrecio(true);
        try {
            const res = await httpsCallable(functions, "finnegansGetProductoDetalle")({ codigo: codFinn });
            setPrecioCalculado(calcularPrecioFinal(Number(res.data.producto?.PrecioBase || 0), reglasPrecios, codFinn));
        } catch(e) { console.error(e); } finally { setLoadingPrecio(false); }
    }
  };

  const handleAgregarAlCarrito = () => {
    if(!productoSeleccionado || precioCalculado <= 0) return;
    const codFinn = productoSeleccionado.esKit ? productoSeleccionado.id : (productoSeleccionado.codUru || productoSeleccionado.codigo);
    
    agregarAlCarrito({
        codigo: codFinn,
        descripcion: productoSeleccionado.customerNo || productoSeleccionado.descripcion || codFinn,
        cantidad: Number(cantidad),
        precioUnitario: precioCalculado,
        precioTotal: precioCalculado * Number(cantidad),
        esKit: productoSeleccionado.esKit || false,
        componentes: productoSeleccionado.componentesResueltos || null
    });
    setProductoSeleccionado(null);
  };

  // =======================================================
  // LÓGICA DEL CARRUSEL DE NOVEDADES
  // =======================================================
  // =======================================================
  // LÓGICA DEL CARRUSEL DE NOVEDADES
  // =======================================================
  const handleSeleccionarPromo = async (codigoABuscar) => {
    setLoadingBusqueda(true);
    
    try {
        // Buscamos el producto en tu base de datos de Firebase
        let q = query(collection(db, "catalogoProductos"), where("codUru", "==", codigoABuscar), limit(1));
        let snap = await getDocs(q);
        
        // Por las dudas, si en tu Firebase el campo se llama "codigo" en vez de "codUru"
        if (snap.empty) {
            q = query(collection(db, "catalogoProductos"), where("codigo", "==", codigoABuscar), limit(1));
            snap = await getDocs(q);
        }

        if (!snap.empty) {
            // ¡Lo encontró! Armamos el producto y abrimos la ventana de compra
            const prodEncontrado = { id: snap.docs[0].id, ...snap.docs[0].data() };
            seleccionarProducto(prodEncontrado);
        } else {
            // Si salta esto, es porque el código 513000121 no está sincronizado en tu Firebase
            alert(`No encontramos el código ${codigoABuscar}. Asegurate de que el producto esté sincronizado en el catálogo.`);
        }
    } catch (error) {
        console.error("Error buscando el producto de la promo:", error);
    } finally {
        setLoadingBusqueda(false);
    }
  };

  // 🔥 LÓGICA DE AGRUPACIÓN POR RAMA 2
  // =======================================================
  const agruparPorRama2 = (productos) => {
      const grupos = {};
      productos.forEach(p => {
          // Si por algún motivo el producto no tiene rama2 cargada, va a "Otros"
          const nombreRama = p.rama2 || "Otros"; 
          if (!grupos[nombreRama]) grupos[nombreRama] = [];
          grupos[nombreRama].push(p);
      });
      return grupos;
  };

  const toggleSeccion = (rama2) => {
      setSeccionesColapsadas(prev => ({
          ...prev,
          [rama2]: !prev[rama2] // Invierte el estado (si estaba abierto lo cierra y viceversa)
      }));
  };

  const objNivel1 = MENU_ESTRUCTURA.find(c => c.nombre === filtroPadre);
  const subcategorias = objNivel1?.subcategorias || [];
  const objNivel2 = subcategorias.find(s => s.nombre === filtroRama1);
  const colores = objNivel2?.colores || [];

  const renderTituloJerarquia = () => {
        if (!filtroPadre) return "Catálogo";
        let titulo = filtroPadre;
        if (filtroRama1) titulo += ` • ${filtroRama1}`;
        if (filtroColor) titulo += ` • ${filtroColor}`;
        return titulo;
  };

  const renderEstadoStock = (cantidad) => {
        if (cantidad >= 10) return { texto: "Con Stock", clase: "pill--ok", disabled: false };
        if (cantidad > 0 && cantidad < 10) return { texto: "Stock a revisar", clase: "pill--warn", disabled: false };
        return { texto: "Sin Stock", clase: "pill--error", disabled: true };
  };  

  const renderProductCard = (p) => {
    const colorHex = MAPA_COLORES[p.color];
    const esOferta = PRODUCTOS_EN_OFERTA.includes(p.codUru);

    return (
        
        <div key={p.id} onClick={() => seleccionarProducto(p)} className="product-card card card--selectable">
            <div className="product-head">
                <div className="product-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {colorHex && (
                            <div style={{
                                width: '14px',
                                height: '14px',
                                borderRadius: '50%',
                                backgroundColor: colorHex,
                                border: colorHex === "#ffffff" ? '1px solid #ddd' : 'none', 
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
                            }} />
                        )}
                        <span className="product-customer">{p.customerNo || p.codUru}</span>
                        
                        {esOferta && (
                            <span style={{ background: '#fff1f0', color: '#cf1322', border: '1px solid #ffa39e', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '900', letterSpacing: '0.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                🔥 OFERTA
                            </span>
                        )}
                    </div>
                    <span className="pill pill--brand small">{p.color || (p.esKit ? "KIT ARMADO" : "Urualum")}</span>
                </div>
                <p className="product-desc" style={{ marginTop: '8px' }}>{p.descripcion || "Ver detalle"}</p>
            </div>
        </div>
    );
  };

  return (
    <div className="container" style={{ minHeight: '100vh', paddingBottom: '80px' }}>

        {/* ── Topbar ── */}
        <header className="topbar card" style={{ marginBottom: 'var(--space-2)', gap: '10px' }}>
        <button onClick={() => navigate("/inicio")} className="btn btn--secondary nav-back">← Inicio</button>
        <button
            onClick={() => navigate("/carrito")}
            className={`btn ${carrito.length > 0 ? 'btn--primary' : 'btn--secondary'}`}
            style={{ margin: 0, borderRadius: '20px', minWidth: '70px', padding: '8px 12px' }}
        >
            🛒 {carrito.length > 0 ? carrito.length : "0"}
        </button>
        </header>

        {/* ── Buscador ── */}
        <div style={{ position: 'relative', marginBottom: '12px' }}>
        <span style={{ position: 'absolute', left: 14, top: 13, fontSize: 16, color: '#94a3b8' }}>🔍</span>
        <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, código, serie…"
            className="sf-search-input"
        />
        {busqueda && (
            <button onClick={() => { setBusqueda(""); setResultadosBusqueda(null); }} className="sf-search-clear">×</button>
        )}
        </div>

        {/* Chips de filtro */}
        <div className="sf-filters-bar">
        <span className="sf-filter-label">Filtrar:</span>

        {/* Sin filtro activo: mostramos todos los padres */}
        {!filtroPadre && MENU_ESTRUCTURA.map(cat => (
            <button
            key={cat.nombre}
            className="sf-chip"
            onClick={() => toggleFiltroPadre(cat.nombre)}
            >
            {cat.nombre}
            </button>
        ))}

        {/* Con filtro activo: solo el padre seleccionado + botón para cambiarlo */}
        {filtroPadre && (
            <button
            className="sf-chip sf-chip--active"
            onClick={() => toggleFiltroPadre(filtroPadre)}
            >
            {filtroPadre} <span className="sf-chip-x">×</span>
            </button>
        )}

        {/* Separador */}
        {filtroPadre && (() => {
            const subs = MENU_ESTRUCTURA.find(c => c.nombre === filtroPadre)?.subcategorias || [];
            if (!subs.length) return null;
            return (
            <>
                <span className="sf-sep">|</span>
                {subs.map(sub => (
                <button
                    key={sub.nombre}
                    className={`sf-chip ${filtroRama1 === sub.nombre ? 'sf-chip--active' : ''}`}
                    onClick={() => toggleFiltroRama1(sub.nombre)}
                >
                    {sub.nombre}
                    {filtroRama1 === sub.nombre && <span className="sf-chip-x">×</span>}
                </button>
                ))}
            </>
            );
        })()}

        {/* Nivel 3: colores */}
        {filtroRama1 && (() => {
            const subs = MENU_ESTRUCTURA.find(c => c.nombre === filtroPadre)?.subcategorias || [];
            const colores = subs.find(s => s.nombre === filtroRama1)?.colores || [];
            if (!colores.length) return null;
            return (
            <>
                <span className="sf-sep">|</span>
                {colores.map(col => (
                <button
                    key={col}
                    className={`sf-chip ${filtroColor === col ? 'sf-chip--active' : ''}`}
                    onClick={() => toggleFiltroColor(col)}
                >
                    {col}
                    {filtroColor === col && <span className="sf-chip-x">×</span>}
                </button>
                ))}
            </>
            );
        })()}

        {/* Limpiar todo */}
        {(filtroPadre || filtroColor) && (
            <button
            className="sf-chip sf-chip--clear"
            onClick={() => {
                setFiltroPadre(null); setFiltroRama1(null); setFiltroColor(null);
                setProductosFiltrados([]); setBusqueda(""); setResultadosBusqueda(null);
            }}
            >
            Limpiar todo
            </button>
        )}
        </div>

        {/* ── Contador de resultados ── */}
        {(busqueda || filtroPadre) && (
        <p className="sf-results-count">
            {resultadosBusqueda !== null
            ? <><strong>{resultadosBusqueda.length}</strong> resultado{resultadosBusqueda.length !== 1 ? 's' : ''}</>
            : <><strong>{productosFiltrados.length}</strong> producto{productosFiltrados.length !== 1 ? 's' : ''}</>
            }
        </p>
        )}

        {/* ── Carrusel (solo en pantalla inicial) ── */}
        {!filtroPadre && !busqueda && (
        <CarouselNovedades onSeleccionarPromo={handleSeleccionarPromo} />
        )}

        {/* ── Grilla de productos ── */}
        <div className="productos-agrupados">
        {resultadosBusqueda !== null ? (
            <div className="product-grid">
            {loadingBusqueda
                ? <div className="card empty-card">⏳ Buscando...</div>
                : resultadosBusqueda.length === 0
                ? <div className="card empty-card">No se encontraron productos para "{busqueda}".</div>
                : resultadosBusqueda.map((p, i) => (
                    <ProductCard key={p.id} producto={p} onClick={seleccionarProducto} animIndex={i} />
                ))
            }
            </div>
        ) : (
            <>
            {loadingProd
                ? <div className="card empty-card">Buscando productos...</div>
                : productosFiltrados.length > 0
                ? Object.entries(agruparPorRama2(productosFiltrados))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([rama2, prods]) => (
                    <div key={rama2} className="section" style={{ marginBottom: '24px' }}>
                        <div
                        className="section-title section-title--catalogo"
                        onClick={() => toggleSeccion(rama2)}
                        >
                        <span style={{ fontSize: '16px', fontWeight: '800', color: 'var(--ink)' }}>
                            {rama2} <span className="muted" style={{ fontWeight: '600', fontSize: '14px' }}>({prods.length})</span>
                        </span>
                        <span className={`chev ${seccionesColapsadas[rama2] ? '' : 'chev--up'}`}>▼</span>
                        </div>
                        {!seccionesColapsadas[rama2] && (
                        <div className="product-grid" style={{ marginTop: '12px' }}>
                            {prods.map((p, i) => (
                            <ProductCard key={p.id} producto={p} onClick={seleccionarProducto} animIndex={i} />
                            ))}
                        </div>
                        )}
                    </div>
                    ))
                : filtroPadre
                ? <div className="card empty-card">Seleccioná una subcategoría o buscá un producto.</div>
                : null
            }
            </>
        )}
        </div>

        {/* ── Modal ── */}
        <ProductModal
        producto={productoSeleccionado}
        stockInfo={stockInfo}
        precioCalculado={precioCalculado}
        loadingStock={loadingStock}
        loadingPrecio={loadingPrecio}
        cantidad={cantidad}
        onCantidadChange={(val) => setCantidad(val)}
        onAgregar={handleAgregarAlCarrito}
        onCerrar={() => setProductoSeleccionado(null)}
        isVendedorAdmin={isVendedorAdmin}
        />

    </div>
    );
}