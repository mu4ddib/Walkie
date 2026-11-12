import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceKind } from '../nodes/resourceMeta';
import { Palette } from './Palette';

function Harness({ onPick }: { onPick: (kind: ResourceKind) => void }) {
  const [open, setOpen] = useState(false);
  return <Palette onAdd={vi.fn()} resources={{ open, onOpenChange: setOpen, onPick }} />;
}

describe('«Recurso» en la barra (spec nodos-de-infraestructura)', () => {
  it('abre la lista de subtipos con su ayuda; un clic agrega uno y la cierra', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    const button = screen.getByRole('button', { name: 'Recurso' });
    expect(button).toHaveAttribute('aria-keyshortcuts', '8');
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Recursos' });
    expect(screen.getAllByRole('menuitem')).toHaveLength(10);
    expect(screen.getByRole('menuitem', { name: /^Cola/ })).toHaveTextContent('Mensajes en espera que un consumidor procesa en orden.');
    await userEvent.click(screen.getByRole('menuitem', { name: /^Cola/ }));

    expect(onPick).toHaveBeenCalledWith('queue');
    expect(menu).not.toBeInTheDocument();
  });

  it('con teclado: el foco entra en la lista, las flechas la recorren, Enter elige y Esc vuelve al botón', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const button = screen.getByRole('button', { name: 'Recurso' });

    await userEvent.click(button);
    expect(screen.getByRole('menuitem', { name: /^Bucket/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /^Cola/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /^Personalizado/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onPick).toHaveBeenCalledWith('custom');
  });
});
