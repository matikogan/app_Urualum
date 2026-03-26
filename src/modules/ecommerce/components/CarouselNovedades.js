import React from 'react';
import imgPromo1 from '../../../novedades/Kit12_ventanas.jpeg';
import imgPromo2 from '../../../novedades/Kit27_Ventanas.jpeg';

export default function CarouselNovedades({ onSeleccionarPromo }) {
  const novedades = [
    { id: 1, imagen: imgPromo1, codigo: '513000121' },
    { id: 2, imagen: imgPromo2, codigo: '513000131' }
  ];

  return (
    <div className="carousel-novedades">
      <h3 className="h2" style={{ paddingLeft: 'var(--space-4)' }}>
        🔥 Novedades y Ofertas
      </h3>
      
      <div className="carousel-scroll hide-scrollbar">
        {novedades.map((item) => (
          <div 
            key={item.id} 
            className="carousel-card card--selectable"
            onClick={() => onSeleccionarPromo(item.codigo)}
          >
            <div className="badge carousel-badge">OFERTA</div>
            <img 
              src={item.imagen} 
              alt={`Oferta ${item.codigo}`} 
              className="carousel-img"
            />
          </div>
        ))}
        {/* Espaciador para que la última card no pegue contra el borde al scrollear */}
        <div style={{ minWidth: 'var(--space-4)', height: '1px' }}></div>
      </div>
    </div>
  );
}   