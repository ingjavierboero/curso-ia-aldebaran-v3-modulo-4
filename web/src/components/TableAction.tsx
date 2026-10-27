import { Button, Popconfirm, Tooltip } from 'antd';
import { type ReactNode, useState } from 'react';

interface TableActionProps {
  /** Texto del tooltip y nombre accesible del botón. */
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  /** Si se indica, pide confirmación con este texto antes de ejecutar la acción. */
  confirm?: string;
  /** Detalle opcional de la confirmación, por ejemplo una consecuencia de la acción. */
  confirmDescription?: string;
}

/** Acción de una fila de tabla: botón con ícono, tooltip y confirmación opcional. */
export function TableAction({ label, icon, onClick, danger, confirm, confirmDescription }: TableActionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const button = (
    <Button
      type="text"
      size="small"
      danger={danger}
      icon={icon}
      aria-label={label}
      onClick={confirm ? undefined : onClick}
    />
  );

  // Mientras la confirmación está abierta, el tooltip se oculta para no taparla. El span corta la
  // propagación para que el click no dispare el de la fila, también desde la confirmación (portal).
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Tooltip title={label} open={confirmOpen ? false : undefined}>
        {confirm ? (
          <Popconfirm
            title={confirm}
            description={confirmDescription}
            okText="Sí"
            cancelText="No"
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            onConfirm={onClick}
          >
            {button}
          </Popconfirm>
        ) : (
          button
        )}
      </Tooltip>
    </span>
  );
}
