export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional label rendered to the right of the toggle. */
  label?: string;
  id?: string;
}

/** Binary on/off toggle for settings that apply instantly. */
export function Switch(props: SwitchProps): JSX.Element;
