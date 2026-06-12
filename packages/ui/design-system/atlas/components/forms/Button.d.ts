import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` is ink (near-black); `accent` is Atlas Blue, reserve for the single key action. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
  /** Control height. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  /** Icon node rendered before the label (e.g. a 16px Lucide SVG). */
  iconLeft?: React.ReactNode;
  /** Icon node rendered after the label. */
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The primary action control for Atlas.
 * @startingPoint section="Forms" subtitle="Button variants, sizes & states" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
