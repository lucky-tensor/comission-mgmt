import React from 'react';

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  description?: string;
  /** Body content. */
  children?: React.ReactNode;
  /** Footer node — typically the action buttons. */
  footer?: React.ReactNode;
  /** Max width in px. @default 460 */
  width?: number;
}

/** Centered modal for focused tasks and confirmations. */
export function Dialog(props: DialogProps): JSX.Element | null;
