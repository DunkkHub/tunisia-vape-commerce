import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function RouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
