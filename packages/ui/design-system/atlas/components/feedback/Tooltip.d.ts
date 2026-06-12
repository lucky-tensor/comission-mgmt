import React from 'react';

export interface TooltipProps {
  /** Tooltip text/content. */
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Single trigger element. */
  children: React.ReactNode;
}

/** Hover/focus hint wrapping a single trigger (icons, truncated text). */
export function Tooltip(props: TooltipProps): JSX.Element;
