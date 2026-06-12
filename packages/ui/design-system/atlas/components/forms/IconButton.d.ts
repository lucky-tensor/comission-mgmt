import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Accessible label — required (rendered as aria-label + title tooltip). */
  label: string;
  /** The icon node (~16px SVG). */
  children: React.ReactNode;
}

/** Square single-icon action for toolbars, table rows, and dialog headers. */
export function IconButton(props: IconButtonProps): JSX.Element;
