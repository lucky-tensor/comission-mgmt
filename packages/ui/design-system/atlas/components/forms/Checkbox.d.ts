export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  /** Optional secondary line under the label. */
  description?: string;
  id?: string;
}

/** Square boolean / multi-select input with optional label + description. */
export function Checkbox(props: CheckboxProps): JSX.Element;
