import React from 'react';

export interface SelectOption { value: string; label: string; }

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  hint?: string;
  error?: string;
  /** Option list — strings or {value,label} objects. */
  options?: Array<string | SelectOption>;
  placeholder?: string;
}

/** Styled native select for short, known option sets. */
export function Select(props: SelectProps): JSX.Element;
