import React from 'react';

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  /** Body message. */
  children?: React.ReactNode;
  /** Optional action node rendered under the message. */
  action?: React.ReactNode;
  /** Show a dismiss (×) button and handle the click. */
  onDismiss?: () => void;
}

/** Inline contextual message for the top of a view, form, or card. */
export function Banner(props: BannerProps): JSX.Element;
