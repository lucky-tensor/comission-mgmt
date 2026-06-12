import React from 'react';

export interface TableColumn<Row = any> {
  /** Field key on each row object. */
  key: string;
  /** Header label. */
  header: React.ReactNode;
  /** Fixed column width (e.g. 120 or '30%'). */
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  /** Custom cell renderer: (value, row) => node. */
  render?: (value: any, row: Row) => React.ReactNode;
}

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  columns: TableColumn[];
  data: any[];
  /** Show a leading checkbox column. */
  selectable?: boolean;
  /** Controlled selected row keys. */
  selected?: Array<string | number>;
  onSelectedChange?: (keys: Array<string | number>) => void;
  /** Field used as the unique row key. @default 'id' */
  rowKey?: string;
  /** Empty-state message. */
  empty?: React.ReactNode;
}

/**
 * Data table for CRUD list views — columns + rows, optional selection.
 * @startingPoint section="Data display" subtitle="Selectable data table" viewport="700x150"
 */
export function Table(props: TableProps): JSX.Element;
