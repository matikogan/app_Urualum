import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "context/AuthContext";
import { useCatalogo } from "modules/ecommerce/hooks/useCatalogo";
import { MENU_ESTRUCTURA, MAPA_COLORES, PRODUCTOS_EN_OFERTA } from "modules/ecommerce/pages/catalogoConfig";
import CarouselNovedades from "modules/ecommerce/components/CarouselNovedades";
import ProductModal from "modules/ecommerce/components/ProductModal";
import ProductCard from "modules/ecommerce/components/ProductCard";

export default function Catalogo() {
    const navigate = useNavigate();
    const { profile } = useAuth();
    const isVendedorAdmin = ["ventas", "encargado", "admin"].includes(profile?.role);

    const {
        filtroPadre, filtroRama1, filtroColor,
        subcategoriasActivas, coloresActivos,
        toggleFiltroPadre, toggleFiltroRama1, toggleFiltroColor, limpiarFiltros,
        productosFiltrados, loadingProd,
        agruparPorRama2, seccionesColapsadas, toggleSeccion,
        busqueda, setBusqueda,
        resultadosBusqueda, loadingBusqueda,
        productoSeleccionado, setProductoSeleccionado,
        cantidad, setCantidad,
        precioCalculado, stockInfo,
        loadingStock, loadingPrecio,
        seleccionarProducto, handleAgregarAlCarrito,
        handleSeleccionarPromo,
        carrito,
    } = useCatalogo();

    return (
        <div className="container" style={{ minHeight: "100vh", paddingBottom: "100px" }}>

            {/* ── Topbar ── */}
            <header className="topbar card" style={{ marginBottom: "var(--space-2)" }}>
                <button onClick={() => navigate("/inicio")} className="btn btn--secondary nav-back">← Inicio</button>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#94a3b8" }}>Catálogo</span>
            </header>

            {/* C8: FAB flotante del carrito — reemplaza el botón del topbar */}
            <button
                className={`fab-cart ${carrito.length > 0 ? "fab-cart--active" : ""}`}
                onClick={() => navigate("/carrito")}
                aria-label={`Ver carrito (${carrito.length} ítems)`}
            >
                🛒
                {carrito.length > 0 && (
                    <span className="fab-cart__count">{carrito.length}</span>
                )}
            </button>

            {/* ── Buscador ── */}
            <div style={{ position: "relative", marginBottom: "12px" }}>
                <span style={{ position: "absolute", left: 14, top: 13, fontSize: 16, color: "#94a3b8" }}>🔍</span>
                <input
                    type="text"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar por nombre, código, serie…"
                    className="sf-search-input"
                />
                {busqueda && (
                    <button onClick={() => setBusqueda("")} className="sf-search-clear">×</button>
                )}
            </div>

            {/* Filtros en dos filas: fila 1 = categorías, fila 2 = colores */}
            <div className="sf-filters-wrap">

                {/* Fila 1: Padre + Rama1 */}
                <div className="sf-filters-bar">
                    <span className="sf-filter-label">Filtrar:</span>

                    {!filtroPadre && MENU_ESTRUCTURA.map(cat => (
                        <button key={cat.nombre} className="sf-chip" onClick={() => toggleFiltroPadre(cat.nombre)}>
                            {cat.nombre}
                        </button>
                    ))}

                    {filtroPadre && (
                        <button className="sf-chip sf-chip--active" onClick={() => toggleFiltroPadre(filtroPadre)}>
                            {filtroPadre} <span className="sf-chip-x">×</span>
                        </button>
                    )}

                    {filtroPadre && subcategoriasActivas.length > 0 && (
                        <>
                            <span className="sf-sep">|</span>
                            {subcategoriasActivas.map(sub => (
                                <button
                                    key={sub.nombre}
                                    className={`sf-chip ${filtroRama1 === sub.nombre ? "sf-chip--active" : ""}`}
                                    onClick={() => toggleFiltroRama1(sub.nombre)}
                                >
                                    {sub.nombre}
                                    {filtroRama1 === sub.nombre && <span className="sf-chip-x">×</span>}
                                </button>
                            ))}
                        </>
                    )}

                    {(filtroPadre || filtroColor) && (
                        <button className="sf-chip sf-chip--clear" onClick={limpiarFiltros}>
                            Limpiar todo
                        </button>
                    )}
                </div>

                {/* Fila 2: Colores — aparece debajo solo cuando hay colores disponibles */}
                {filtroRama1 && coloresActivos.length > 0 && (
                    <div className="sf-filters-bar sf-filters-bar--colors">
                        <span className="sf-filter-label">Color:</span>
                        {coloresActivos.map(col => (
                            <button
                                key={col}
                                className={`sf-chip ${filtroColor === col ? "sf-chip--active" : ""}`}
                                onClick={() => toggleFiltroColor(col)}
                            >
                                {col}
                                {filtroColor === col && <span className="sf-chip-x">×</span>}
                            </button>
                        ))}
                    </div>
                )}

            </div> {/* cierre sf-filters-wrap */}

            {/* ── Contador de resultados ── */}
            {(busqueda || filtroPadre) && (
                <p className="sf-results-count">
                    {resultadosBusqueda !== null
                        ? <><strong>{resultadosBusqueda.length}</strong> resultado{resultadosBusqueda.length !== 1 ? "s" : ""}</>
                        : <><strong>{productosFiltrados.length}</strong> producto{productosFiltrados.length !== 1 ? "s" : ""}</>
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
                                <ProductCard key={p.id} producto={p} onClick={seleccionarProducto} animIndex={i}
                                    esOferta={PRODUCTOS_EN_OFERTA.includes(p.codUru)}
                                    colorHex={MAPA_COLORES[p.color]}
                                />
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
                                    <div key={rama2} className="section" style={{ marginBottom: "24px" }}>
                                        <div
                                            className="section-title section-title--catalogo"
                                            onClick={() => toggleSeccion(rama2)}
                                        >
                                            <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--ink)" }}>
                                                {rama2} <span className="muted" style={{ fontWeight: "600", fontSize: "14px" }}>({prods.length})</span>
                                            </span>
                                            <span className={`chev ${seccionesColapsadas[rama2] ? "" : "chev--up"}`}>▼</span>
                                        </div>
                                        {!seccionesColapsadas[rama2] && (
                                            <div className="product-grid" style={{ marginTop: "12px" }}>
                                                {prods.map((p, i) => (
                                                    <ProductCard
                                                        key={p.id}
                                                        producto={p}
                                                        onClick={seleccionarProducto}
                                                        animIndex={i}
                                                        esOferta={PRODUCTOS_EN_OFERTA.includes(p.codUru)}
                                                        colorHex={MAPA_COLORES[p.color]}
                                                    />
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

            {/* ── Modal de producto ── */}
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
