import React from 'react';

export interface PaginationProps extends React.HTMLAttributes<HTMLDivElement> {
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

/** Range summary + prev/next controls for tables and lists. */
export function Pagination(props: PaginationProps): JSX.Element;
