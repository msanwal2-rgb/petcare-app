import { Field, Select } from "./Field";

/**
 * A labelled dropdown filter with an "any" option — the shape every filter
 * rail in the app repeats. Values are the domain's own union strings; the
 * empty string means "no filter".
 */
export function SelectFilter<T extends string>({
  id,
  label,
  anyLabel,
  options,
  optionLabel,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** Text for the "no filter" option, e.g. "Any specialty". */
  anyLabel: string;
  options: readonly T[];
  optionLabel: (value: T) => string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
