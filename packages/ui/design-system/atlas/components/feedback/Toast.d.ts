import React from 'react';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
  title?: string;
  message?: string;
  onDismiss?: () => void;
}

/** Transient confirmation toast. Stack several in a fixed bottom-right container. */
export function Toast(props: ToastProps): JSX.Element;
