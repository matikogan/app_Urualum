// useCatalogo.js
// Custom hook con toda la lógica de negocio del catálogo:
// carga de reglas de precios, búsqueda con debounce, filtros,
// carga de productos, selección de producto (stock + precio) y carrito.

import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc, collection, getDocs, query, where, limit } from "firebase/firestore";

import { functions, db } from "../../../firebase";
import { calcularPrecioFinal } from "modules/ecommerce/services/priceCalculator";
import { useApp } from "context/AppContext";
import { useAuth } from "context/AuthContext";
import {
    KITS_VIRTUALES,
    PRODUCTOS_EN_OFERTA,
    MENU_ESTRUCTURA,
} from "modules/ecommerce/pages/catalogoConfig";

export function useCatalogo() {
    const { profile } = useAuth();
    const {
        reglasPrecios, setReglasPrecios,
        setNombreLista,
        carrito, agregarAlCarrito,
        clienteActivo,
    } = useApp();

    // ── Filtros de navegación ──────────────────────────────────────────────────
    const [filtroPadre, setFiltroPadre]   = useState(null);
    const [filtroRama1, setFiltroRama1]   = useState(null);
    const [filtroColor, setFiltroColor]   = useState(null);
    const [productosFiltrados, setProductosFiltrados] = useState([]);
    const [loadingProd, setLoadingProd]   = useState(false);

    // ── Búsqueda ───────────────────────────────────────────────────────────────
    const [busqueda, setBusqueda]                   = useState("");
    const [resultadosBusqueda, setResultadosBusqueda] = useState(null);
    const [loadingBusqueda, setLoadingBusqueda]     = useState(false);

    // ── Producto seleccionado / modal ──────────────────────────────────────────
    const [productoSeleccionado, setProductoSeleccionado] = useState(null);
    const [cantidad, setCantidad]         = useState(1);
    const [precioCalculado, setPrecioCalculado] = useState(0);
    const [stockInfo, setStockInfo]       = useState(null);
    const [loadingStock, setLoadingStock] = useState(false);
    const [loadingPrecio, setLoadingPrecio] = useState(false);

    // ── Secciones colapsadas ───────────────────────────────────────────────────
    const [seccionesColapsadas, setSeccionesColapsadas] = useState({});

    // ── Reglas de precios ─────────────────────────────────────────────────────
    useEffect(() => {
        const cargarReglas = async () => {
            const codigoUsar = clienteActivo?.finnegansClienteCodigo || profile?.finnegansClienteCodigo;
            if (!codigoUsar) return;

            try {
                const res = await httpsCallable(functions, "finnegansGetCliente")({ codigo: codigoUsar });
                const listaCod = res.data.cliente?.ListaPrecioDefaultCodigo;

                if (listaCod) {
                    setNombreLista(listaCod);
                    const docSnap = await getDoc(doc(db, "config_lista_precios", listaCod));
                    if (docSnap.exists()) {
                        setReglasPrecios(docSnap.data().rules);
                    }
                }
            } catch (e) {
                console.error("Error al cargar reglas de precio:", e);
            }
        };

        cargarReglas();
    }, [profile?.finnegansClienteCodigo, clienteActivo, setNombreLista, setReglasPrecios]);

    // ── Búsqueda con debounce ─────────────────────────────────────────────────
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
                        const snap = await getDocs(query(collection(db, "catalogoProductos"), where("codUru", "in", chunk)));
                        todosLosProductos = [...todosLosProductos, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
                    }
                } else {
                    const kitsFiltrados = KITS_VIRTUALES.filter(k =>
                        (!filtroPadre || k.padre === filtroPadre) &&
                        (!filtroRama1  || k.rama1 === filtroRama1) &&
                        (!filtroColor  || k.color === filtroColor)
                    );

                    let restricciones = [];
                    if (filtroPadre) restricciones.push(where("padre", "==", filtroPadre));
                    if (filtroRama1) restricciones.push(where("rama1", "==", filtroRama1));
                    if (filtroColor)  restricciones.push(where("color", "==", filtroColor));

                    const snap = await getDocs(query(collection(db, "catalogoProductos"), ...restricciones));
                    todosLosProductos = [...kitsFiltrados, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
                }

                const termLower = busqueda.toLowerCase();
                setResultadosBusqueda(
                    todosLosProductos.filter(p =>
                        (p.descripcion || "").toLowerCase().includes(termLower) ||
                        (p.codUru      || "").toLowerCase().includes(termLower) ||
                        (p.customerNo  || "").toLowerCase().includes(termLower)
                    )
                );
            } catch (err) {
                console.error("Error en búsqueda:", err);
            } finally {
                setLoadingBusqueda(false);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [busqueda, filtroPadre, filtroRama1, filtroColor]);

    // ── Carga de productos por filtro ─────────────────────────────────────────
    const cargarProductos = async (padre, rama1, color) => {
        setLoadingProd(true);
        try {
            if (padre === "🔥 Ofertas") {
                if (PRODUCTOS_EN_OFERTA.length === 0) return setProductosFiltrados([]);
                let todos = [];
                for (let i = 0; i < PRODUCTOS_EN_OFERTA.length; i += 10) {
                    const chunk = PRODUCTOS_EN_OFERTA.slice(i, i + 10);
                    const snap = await getDocs(query(collection(db, "catalogoProductos"), where("codUru", "in", chunk)));
                    todos = [...todos, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
                }
                setProductosFiltrados(todos);
                return;
            }

            let restricciones = [where("padre", "==", padre)];
            if (rama1) restricciones.push(where("rama1", "==", rama1));
            if (color) restricciones.push(where("color", "==", color));

            const snap = await getDocs(query(collection(db, "catalogoProductos"), ...restricciones, limit(50)));
            const productosDB = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            const kitsInfiltrados = KITS_VIRTUALES.filter(k =>
                k.padre === padre &&
                (!rama1 || k.rama1 === rama1) &&
                (!color || k.color === color)
            );

            setProductosFiltrados([...kitsInfiltrados, ...productosDB]);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingProd(false);
        }
    };

    // ── Toggles de filtro ─────────────────────────────────────────────────────
    const limpiarBusqueda = () => { setBusqueda(""); setResultadosBusqueda(null); };

    const toggleFiltroPadre = (padre) => {
        if (filtroPadre === padre) {
            setFiltroPadre(null); setFiltroRama1(null); setFiltroColor(null);
            setProductosFiltrados([]);
        } else {
            setFiltroPadre(padre); setFiltroRama1(null); setFiltroColor(null);
            cargarProductos(padre, null, null);
        }
        limpiarBusqueda();
    };

    const toggleFiltroRama1 = (rama1) => {
        if (filtroRama1 === rama1) {
            setFiltroRama1(null); setFiltroColor(null);
            cargarProductos(filtroPadre, null, null);
        } else {
            setFiltroRama1(rama1); setFiltroColor(null);
            cargarProductos(filtroPadre, rama1, null);
        }
        limpiarBusqueda();
    };

    const toggleFiltroColor = (color) => {
        if (filtroColor === color) {
            setFiltroColor(null);
            cargarProductos(filtroPadre, filtroRama1, null);
        } else {
            setFiltroColor(color);
            cargarProductos(filtroPadre, filtroRama1, color);
        }
        limpiarBusqueda();
    };

    const limpiarFiltros = () => {
        setFiltroPadre(null); setFiltroRama1(null); setFiltroColor(null);
        setProductosFiltrados([]); limpiarBusqueda();
    };

    // ── Selección de producto (abre modal con stock y precio) ─────────────────
    const seleccionarProducto = async (p) => {
        setProductoSeleccionado(p);
        setStockInfo(null); setPrecioCalculado(0); setCantidad(1);

        if (p.esKit) {
            setLoadingStock(true);
            setLoadingPrecio(true);
            try {
                const fnStock  = (cod, dep) => httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: cod, deposito: dep }).catch(() => ({ data: { stock: [] } }));
                const fnPrecio = (cod) => httpsCallable(functions, "finnegansGetProductoDetalle")({ codigo: cod }).catch(() => ({ data: { producto: {} } }));

                const [stocksR8, stocksIsa, precios] = await Promise.all([
                    Promise.all(p.componentes.map(c => fnStock(c.codigo, "RUTA8"))),
                    Promise.all(p.componentes.map(c => fnStock(c.codigo, "ISABELA"))),
                    Promise.all(p.componentes.map(c => fnPrecio(c.codigo))),
                ]);

                let stockMinimoR8 = Infinity, stockMinimoIsa = Infinity, precioTotalKit = 0;
                const componentesResueltos = p.componentes.map((c, i) => {
                    const stockR8  = stocksR8[i].data?.stock?.[0]?.Cantidad || 0;
                    const stockIsa = stocksIsa[i].data?.stock?.[0]?.Cantidad || 0;
                    const posR8  = c.cantidad > 0 ? Math.floor(stockR8  / c.cantidad) : 0;
                    const posIsa = c.cantidad > 0 ? Math.floor(stockIsa / c.cantidad) : 0;

                    if (posR8  < stockMinimoR8)  stockMinimoR8  = posR8;
                    if (posIsa < stockMinimoIsa) stockMinimoIsa = posIsa;

                    const precioBase  = Number(precios[i].data?.producto?.PrecioBase || 0);
                    const precioFinal = calcularPrecioFinal(precioBase, reglasPrecios, c.codigo);
                    precioTotalKit += precioFinal * c.cantidad;

                    return { codigo: c.codigo, cantidadBase: c.cantidad, precioUnitario: precioFinal, desc: c.desc };
                });

                if (stockMinimoR8  === Infinity) stockMinimoR8  = 0;
                if (stockMinimoIsa === Infinity) stockMinimoIsa = 0;

                setStockInfo({
                    Cantidad: Math.max(stockMinimoR8, stockMinimoIsa),
                    r8: stockMinimoR8,
                    isa: stockMinimoIsa,
                    Unidad: "Kit",
                });
                setPrecioCalculado(Math.round((precioTotalKit + Number.EPSILON) * 100) / 100);
                setProductoSeleccionado({ ...p, componentesResueltos });
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingStock(false); setLoadingPrecio(false);
            }
        } else {
            const codFinn = p.codUru || p.codigo;
            if (!codFinn) return;

            if (p.color?.toLowerCase() === "kit") {
                setStockInfo({ Cantidad: 9999, r8: "+999", isa: "+999", Unidad: "Kit" });
            } else {
                setLoadingStock(true);
                Promise.all([
                    httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: codFinn, deposito: "RUTA8"   }).catch(() => ({ data: { stock: [] } })),
                    httpsCallable(functions, "finnegansConsultarStock")({ productoCodigo: codFinn, deposito: "ISABELA" }).catch(() => ({ data: { stock: [] } })),
                ]).then(([resR8, resIsa]) => {
                    const stockR8  = resR8.data.stock?.[0]?.Cantidad || 0;
                    const stockIsa = resIsa.data.stock?.[0]?.Cantidad || 0;
                    setStockInfo({
                        Cantidad: Math.max(stockR8, stockIsa),
                        r8: stockR8,
                        isa: stockIsa,
                        Unidad: resR8.data.stock?.[0]?.Unidad || "Un.",
                    });
                }).finally(() => setLoadingStock(false));
            }

            setLoadingPrecio(true);
            try {
                const res = await httpsCallable(functions, "finnegansGetProductoDetalle")({ codigo: codFinn });
                setPrecioCalculado(calcularPrecioFinal(Number(res.data.producto?.PrecioBase || 0), reglasPrecios, codFinn));
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingPrecio(false);
            }
        }
    };

    // ── Carrusel de novedades: click en promo ─────────────────────────────────
    const handleSeleccionarPromo = async (codigoABuscar) => {
        setLoadingBusqueda(true);
        try {
            let snap = await getDocs(query(collection(db, "catalogoProductos"), where("codUru", "==", codigoABuscar), limit(1)));
            if (snap.empty) {
                snap = await getDocs(query(collection(db, "catalogoProductos"), where("codigo", "==", codigoABuscar), limit(1)));
            }
            if (!snap.empty) {
                seleccionarProducto({ id: snap.docs[0].id, ...snap.docs[0].data() });
            } else {
                alert(`No encontramos el código ${codigoABuscar}. Asegurate de que el producto esté sincronizado.`);
            }
        } catch (error) {
            console.error("Error buscando promo:", error);
        } finally {
            setLoadingBusqueda(false);
        }
    };

    // ── Agregar al carrito ────────────────────────────────────────────────────
    const handleAgregarAlCarrito = () => {
        if (!productoSeleccionado || precioCalculado <= 0) return;
        const codFinn = productoSeleccionado.esKit
            ? productoSeleccionado.id
            : (productoSeleccionado.codUru || productoSeleccionado.codigo);

        agregarAlCarrito({
            codigo: codFinn,
            descripcion: productoSeleccionado.customerNo || productoSeleccionado.descripcion || codFinn,
            cantidad: Number(cantidad),
            precioUnitario: precioCalculado,
            precioTotal: precioCalculado * Number(cantidad),
            esKit: productoSeleccionado.esKit || false,
            componentes: productoSeleccionado.componentesResueltos || null,
        });
        setProductoSeleccionado(null);
    };

    // ── Agrupación por Rama2 ──────────────────────────────────────────────────
    const agruparPorRama2 = (productos) => {
        const grupos = {};
        productos.forEach(p => {
            const clave = p.rama2 || "Otros";
            if (!grupos[clave]) grupos[clave] = [];
            grupos[clave].push(p);
        });
        return grupos;
    };

    const toggleSeccion = (rama2) => {
        setSeccionesColapsadas(prev => ({ ...prev, [rama2]: !prev[rama2] }));
    };

    // ── Derivados del menú ────────────────────────────────────────────────────
    const subcategoriasActivas = MENU_ESTRUCTURA.find(c => c.nombre === filtroPadre)?.subcategorias || [];
    const coloresActivos       = subcategoriasActivas.find(s => s.nombre === filtroRama1)?.colores || [];

    return {
        // filtros
        filtroPadre, filtroRama1, filtroColor,
        subcategoriasActivas, coloresActivos,
        toggleFiltroPadre, toggleFiltroRama1, toggleFiltroColor, limpiarFiltros,
        // productos
        productosFiltrados, loadingProd,
        agruparPorRama2, seccionesColapsadas, toggleSeccion,
        // búsqueda
        busqueda, setBusqueda,
        resultadosBusqueda, loadingBusqueda,
        // modal
        productoSeleccionado, setProductoSeleccionado,
        cantidad, setCantidad,
        precioCalculado, stockInfo,
        loadingStock, loadingPrecio,
        seleccionarProducto, handleAgregarAlCarrito,
        // carrusel
        handleSeleccionarPromo,
        // misc
        carrito,
    };
}
