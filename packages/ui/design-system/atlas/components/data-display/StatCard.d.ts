import React from 'react';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Overline label, e.g. "Active users". */
  label: string;
  /** The metric value (string or number). */
  value: React.ReactNode;
  /** Change indicator, e.g. "+12%". */
  delta?: React.ReactNode;
  trend?: 'up' | 'down' | 'flat';
  /** Optional icon node (~16px). */
  icon?: React.ReactNode;
}

/** Single KPI tile for dashboard overview rows. */
export function StatCard(props: StatCardProps): JSX.Element;
