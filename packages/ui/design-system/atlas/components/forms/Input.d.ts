import React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Field label rendered above the control. */
  label?: string;
  /** Helper text below the field. */
  hint?: string;
  /** Error message — turns the field red and replaces the hint. */
  error?: string;
  required?: boolean;
  /** Leading icon node (~16px). */
  iconLeft?: React.ReactNode;
  /** Trailing adornment (icon, unit, button). */
  trailing?: React.ReactNode;
}

/** Single-line text field with label, hint, error, and adornments. */
export function Input(props: InputProps): JSX.Element;
