import { EditOutlined } from '@ant-design/icons';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableAction } from '../../src/components/TableAction.tsx';

describe('acción de una fila de tabla', () => {
  it('es un botón de ícono cuyo nombre accesible es la acción, y muestra la acción como tooltip', async () => {
    render(<TableAction label="Modificar" icon={<EditOutlined />} onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Modificar' });
    expect(button.textContent).toBe('');

    await act(async () => {
      fireEvent.mouseEnter(button);
    });
    expect((await screen.findByRole('tooltip')).textContent).toBe('Modificar');
  });

  it('sin confirmación, ejecuta la acción al hacer click', () => {
    const onClick = vi.fn();
    render(<TableAction label="Modificar" icon={<EditOutlined />} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modificar' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('con confirmación, solo ejecuta la acción al confirmar', async () => {
    const onClick = vi.fn();
    render(
      <TableAction
        label="Dar de baja"
        icon={<EditOutlined />}
        confirm="¿Dar de baja al usuario?"
        confirmDescription="Se cierran todas sus sesiones abiertas."
        onClick={onClick}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    });
    expect(await screen.findByText('Se cierran todas sus sesiones abiertas.')).toBeTruthy();
    expect(onClick).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    });
    expect(onClick).toHaveBeenCalledOnce();
  });
});
