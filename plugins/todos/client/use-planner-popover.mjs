import { useEffect, useRef } from 'react';

export function usePlannerPopover() {
  const ref = useRef(null);
  useEffect(() => {
    const dismiss = event => {
      const details = ref.current;
      if (details?.open && !details.contains(event.target)) details.open = false;
    };
    const escape = event => {
      const details = ref.current;
      if (event.key === 'Escape' && details?.open && details.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); details.open = false;
        details.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    const details = ref.current;
    details?.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); details?.removeEventListener('keydown', escape); };
  }, []);
  return ref;
}
