import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 1024; // matches the sidebar's own lg: breakpoint usage

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT));

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
