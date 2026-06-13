import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Header title; omit for a plain surface. */
  title?: string;
  subtitle?: string;
  /** Header action nodes (buttons, menus). */
  actions?: React.ReactNode;
  /** Body padding. @default 'md' */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

/** Bordered content surface with optional header + actions. */
export function Card(props: CardProps): JSX.Element;
