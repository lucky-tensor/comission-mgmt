import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  rows?: number;
}

/** Multi-line text input with the same label/hint/error system as Input. */
export function Textarea(props: TextareaProps): JSX.Element;
