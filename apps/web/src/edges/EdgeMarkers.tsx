/**
 * Puntas de flecha de las conexiones, una vez por lienzo (SVG fuera de React Flow, referido con `url(#…)`).
 * Cerrada para solicitudes, eventos y datos; abierta para navegación y respuestas (spec espacio-de-trabajo, 22).
 */
export function EdgeMarkers() {
  return (
    <svg className="edge-markers" width="0" height="0" aria-hidden="true">
      <defs>
        {[
          ['', '#5b4e40'],
          ['-selected', '#2d5f8f'],
        ].map(([suffix, color]) => (
          <g key={suffix}>
            <marker
              id={`walkie-arrow-closed${suffix}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={color} />
            </marker>
            <marker
              id={`walkie-arrow-open${suffix}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10" fill="none" stroke={color} strokeWidth="1.6" />
            </marker>
          </g>
        ))}
      </defs>
    </svg>
  );
}
