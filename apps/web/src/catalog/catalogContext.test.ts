import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../api/client';
import { defaultEdgeKind } from '../store/graphStore';
import { effectiveType, refTarget, toCanvasCatalog } from './catalogContext';

const api: CatalogItem = { id: 'item-1', appId: 'app-1', type: 'api', title: 'Consultar cliente', version: 1 };
const { items } = toCanvasCatalog('app-1', [api]);
const ref = { id: 'r1', type: 'ref' as const, title: 'Viejo', catalogId: 'item-1' };
const broken = { id: 'r2', type: 'ref' as const, title: 'Borrado', catalogId: 'nada' };
const screen = { id: 's1', type: 'screen' as const, title: 'Login' };

describe('catálogo en el lienzo', () => {
  it('un ref apunta a su elemento; uno roto o un nodo común no', () => {
    expect(refTarget(ref, items)).toBe(api);
    expect(refTarget(broken, items)).toBeUndefined();
    expect(refTarget(screen, items)).toBeUndefined();
  });

  it('un ref se comporta como el tipo de su elemento al conectar (criterio 9)', () => {
    expect(effectiveType(ref, items)).toBe('api');
    expect(effectiveType(broken, items)).toBe('ref');
    expect(defaultEdgeKind(effectiveType(screen, items), effectiveType(ref, items))).toBe('request');
    expect(defaultEdgeKind(effectiveType(ref, items), effectiveType(screen, items))).toBe('response');
  });
});
