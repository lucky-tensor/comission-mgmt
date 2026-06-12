import React from 'react';

export interface TabItem {
  value: string;
  label: React.ReactNode;
  /** Optional count chip (e.g. row totals). */
  count?: number;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: TabItem[];
  /** Active tab value (controlled). */
  value: string;
  onChange?: (value: string) => void;
}

/** Underline tab bar for switching views within a page. */
export function Tabs(props: TabsProps): JSX.Element;
