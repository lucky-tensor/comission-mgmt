import React from 'react';

export interface CrumbItem {
  label: React.ReactNode;
  /** Link target; omit for non-navigable segments. The last item is always current. */
  href?: string;
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: CrumbItem[];
}

/** Location trail for nested CRUD records. */
export function Breadcrumb(props: BreadcrumbProps): JSX.Element;
