import { Slot } from '@radix-ui/react-slot';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'admin';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  asChild?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  asChild = false,
  className = '',
  children,
  disabled,
  ...props
}: PropsWithChildren<ButtonProps>) {
  if (asChild) {
    return (
      <Slot
        className={`button button--${variant} ${className}`}
        aria-disabled={disabled || loading || undefined}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      className={`button button--${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : null}
      {children}
    </button>
  );
}
