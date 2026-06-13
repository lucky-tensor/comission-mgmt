import React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name — used for initials, color seed, and title. */
  name?: string;
  /** Image URL; falls back to initials when absent. */
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/** Round identity chip — image or color-seeded initials. */
export function Avatar(props: AvatarProps): JSX.Element;
