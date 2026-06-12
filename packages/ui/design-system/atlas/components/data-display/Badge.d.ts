import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic color. @default 'neutral' */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** Show a leading status dot. */
  dot?: boolean;
  children: React.ReactNode;
}

/**
 * Compact status / category label.
 * @startingPoint section="Data display" subtitle="Status badges & tags" viewport="700x150"
 */
export function Badge(props: BadgeProps): JSX.Element;
