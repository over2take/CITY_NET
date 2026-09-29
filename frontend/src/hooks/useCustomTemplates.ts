import { useEffect, useReducer } from 'react';
import { CUSTOM_TEMPLATE_EVENT, isCustomSystem, loadCustomTemplate } from '../sheets';

/**
 * Keep custom game systems' sheets drawable.
 *
 * getTemplate() answers from a cache, and a custom system's template is fetched the first time
 * it is asked for (sheets/customTemplates.ts). This redraws the component using it when a
 * template arrives, and fetches the running system's ahead of need so its sheets open ready.
 */
export function useCustomTemplates(runningSystem?: string | null) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onLoaded = () => redraw();
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
    return () => window.removeEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
  }, []);
  useEffect(() => {
    if (isCustomSystem(runningSystem)) void loadCustomTemplate(runningSystem);
  }, [runningSystem]);
}
