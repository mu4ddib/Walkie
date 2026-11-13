import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ModuleInterfaceSummary, ModuleSummary } from '../api/client';
import { interfaceKindLabel, interfaceSignature, interfacesForEnd, matchesInterface } from './moduleMeta';

/** Valor elegido: una interfaz, o `null` para el módulo completo (relación general). */
export type InterfaceChoice = ModuleInterfaceSummary | null;

/**
 * Selector compacto de interfaces (spec modulos-compartidos, criterio 11): aparece donde se soltó la conexión sobre la
 * caja de un módulo. Busca por nombre, método, ruta o caja; ↑ ↓ eligen, Enter confirma y Esc cancela (no se conecta).
 * La primera opción es «Módulo completo», para diagramas de alto nivel.
 */
export function InterfacePicker({
  module,
  end,
  x,
  y,
  onPick,
  onCancel,
}: {
  module: ModuleSummary;
  /** Qué extremo de la conexión es el módulo: `to` (se conecta hacia él) o `from` (sale de él). */
  end: 'from' | 'to';
  /** Posición en pantalla (px, relativa al lienzo). */
  x: number;
  y: number;
  onPick: (choice: InterfaceChoice) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  const options = useMemo<InterfaceChoice[]>(
    () => [null, ...interfacesForEnd(module, end).filter((i) => matchesInterface(i, query))],
    [module, end, query],
  );
  const current = Math.min(active, options.length - 1);

  useEffect(() => inputRef.current?.focus(), []);
  // Que no se salga del lienzo: se corre hacia dentro si no cabe.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const parent = box?.offsetParent as HTMLElement | null;
    if (!box || !parent) return;
    const nx = Math.max(8, Math.min(x, parent.clientWidth - box.offsetWidth - 8));
    const ny = Math.max(8, Math.min(y, parent.clientHeight - box.offsetHeight - 8));
    if (nx !== at.x || ny !== at.y) setAt({ x: nx, y: ny });
  }, [x, y, at.x, at.y]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onPick(options[current] ?? null);
    }
  }

  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <div
      ref={boxRef}
      className="interface-picker floating"
      role="dialog"
      aria-label={`Conectar con ${module.name}`}
      style={{ left: at.x, top: at.y }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="interface-picker-head">
        <strong>{module.name}</strong>
        <span>{end === 'to' ? '¿A qué interfaz llega?' : '¿De qué interfaz sale?'}</span>
      </header>
      <input
        ref={inputRef}
        type="search"
        placeholder="Buscar por nombre, método o ruta…"
        aria-label="Buscar interfaces"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={optionId(current)}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
      />
      <ul id={listId} role="listbox" aria-label="Interfaces">
        {options.map((option, i) => (
          <li key={option?.id ?? 'whole'} role="presentation">
            <button
              type="button"
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              tabIndex={-1}
              className="module-iface-option"
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(option)}
            >
              {option ? (
                <>
                  <span className="module-iface-kind" data-kind={option.kind}>
                    {interfaceKindLabel(option.kind)}
                  </span>
                  <span className="module-node-iface-name">{option.name}</span>
                  {interfaceSignature(option) && <span className="module-node-iface-sig">{interfaceSignature(option)}</span>}
                  {option.description && <span className="module-iface-desc">{option.description}</span>}
                </>
              ) : (
                <>
                  <span className="module-iface-kind">Todo</span>
                  <span className="module-node-iface-name">Módulo completo</span>
                  <span className="module-iface-desc">Relación general; se precisa la interfaz después en el inspector.</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {options.length === 1 && (
        <p className="interface-picker-empty">
          {module.interfaces.length === 0 ? 'Este módulo aún no expone interfaces.' : 'Ninguna interfaz coincide.'}
        </p>
      )}
      <footer className="interface-picker-foot">↑ ↓ elegir · Enter conectar · Esc cancelar</footer>
    </div>
  );
}
