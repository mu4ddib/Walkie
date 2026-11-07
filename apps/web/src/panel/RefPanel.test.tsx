import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../api/client';
import { CatalogContext, toCanvasCatalog } from '../catalog/catalogContext';
import { createGraphStore } from '../store/graphStore';
import { GraphStoreProvider } from '../store/GraphStoreProvider';
import { PropertiesPanel } from './PropertiesPanel';

const consultar: CatalogItem = {
  id: 'item-1',
  appId: 'app-1',
  type: 'api',
  title: 'Consultar cliente',
  description: 'Datos básicos',
  http: { method: 'GET', path: '/clientes/{id}' },
  version: 1,
};

function renderRefPanel(catalogId: string) {
  const store = createGraphStore();
  const id = store.getState().addRef({ id: catalogId, title: 'Título viejo' }, { x: 0, y: 0 });
  render(
    <MemoryRouter>
      <GraphStoreProvider store={store}>
        <CatalogContext.Provider value={toCanvasCatalog('app-1', [consultar])}>
          <PropertiesPanel nodeId={id} edgeId={null} />
        </CatalogContext.Provider>
      </GraphStoreProvider>
    </MemoryRouter>,
  );
}

describe('panel de un ref', () => {
  it('muestra el elemento en solo lectura con enlace al catálogo', () => {
    renderRefPanel('item-1');

    expect(screen.getByText('Consultar cliente')).toBeInTheDocument();
    expect(screen.getByText('Datos básicos')).toBeInTheDocument();
    expect(screen.getByText('GET /clientes/{id}')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar en el catálogo' })).toHaveAttribute(
      'href',
      '/apps/app-1/catalog/item-1',
    );
  });

  it('si el elemento no existe lo dice y muestra el último título', () => {
    renderRefPanel('nada');

    expect(screen.getByText('Elemento no encontrado')).toBeInTheDocument();
    expect(screen.getByText('Título viejo')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
