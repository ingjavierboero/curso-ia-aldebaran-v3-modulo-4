import type { ActorDto } from '@api-types';
import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import styled from 'styled-components';
import { formatDateTime } from '../format.ts';

const List = styled.ul<{ $border: string }>`
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid ${({ $border }) => $border};
  }

  li:last-child {
    border-bottom: 0;
  }
`;

/** Nombre del usuario que originó algo, o "Agente" si fue un proceso automático (RF-163, RF-217). */
export const actorName = (actor: ActorDto) => (actor.type === 'agente' ? 'Agente' : (actor.userName ?? 'Usuario'));

export interface Activity {
  key: number | string;
  at: string;
  title: ReactNode;
  detail?: ReactNode;
  actor: ActorDto;
}

/** Lista cronológica de cosas que pasaron, con la fecha y hora, qué pasó y quién lo hizo. */
export function ActivityList({ label, items, empty }: { label: string; items: Activity[]; empty: string }) {
  const { token } = theme.useToken();
  if (items.length === 0) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  return (
    // El borde sale del tema de antd, así acompaña al modo oscuro.
    <List aria-label={label} $border={token.colorBorderSecondary}>
      {items.map((item) => (
        <li key={item.key}>
          <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
            {formatDateTime(item.at)}
          </Typography.Text>
          <Typography.Text strong>{item.title}</Typography.Text>
          {item.detail && <Typography.Text>{item.detail}</Typography.Text>}
          <Typography.Text type="secondary" style={{ marginInlineStart: 'auto' }}>
            {actorName(item.actor)}
          </Typography.Text>
        </li>
      ))}
    </List>
  );
}
