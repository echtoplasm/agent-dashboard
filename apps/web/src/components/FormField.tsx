/**
 * A labelled form control with an optional hint.
 *
 * The hint sits outside the `<label>` and is linked with `aria-describedby`,
 * so screen readers announce the label as the control's name and the hint
 * as its description, instead of reading both as one long name.
 */
import { cloneElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Renders a label, a single control and an optional hint.
 *
 * @param props.label - The control's accessible name.
 * @param props.hint - Extra guidance shown under the control.
 * @param props.children - Exactly one input, select or textarea.
 * @returns The field.
 */
export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}): ReactElement {
  const hintId = useId();
  const control =
    hint === undefined ? children : cloneElement(children, { 'aria-describedby': hintId });
  return (
    <div className="field">
      <label className="field">
        <span>{label}</span>
        {control}
      </label>
      {hint !== undefined && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
