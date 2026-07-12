import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  leading?: ReactNode | undefined;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { label, error, hint, id: providedId, leading, type = 'text', className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { t } = useTranslation();
  const isPassword = type === 'password';
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field__control">
        {leading ? <span className="field__leading">{leading}</span> : null}
        <input
          ref={ref}
          id={id}
          type={isPassword && passwordVisible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
        {isPassword ? (
          <button
            className="field__reveal"
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={t(passwordVisible ? 'auth.hidePassword' : 'auth.showPassword')}
          >
            {passwordVisible ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | undefined;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, id: providedId, children, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <select
        ref={ref}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  error?: string | undefined;
}

export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, error, id: providedId, ...props }, ref) {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    return (
      <div className="checkbox-wrap">
        <label className="checkbox" htmlFor={id}>
          <input ref={ref} id={id} type="checkbox" aria-invalid={Boolean(error)} {...props} />
          <span>{label}</span>
        </label>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
