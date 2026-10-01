import { useEffect, useReducer } from 'react';
import { CUSTOM_TEMPLATE_EVENT, customTemplate, isCustomSystem, loadCustomTemplate } from './customTemplates';

// What the app calls its own terms while a game runs: the glossary (Layer 1 of the system
// builder). A custom system can call HP "WOUNDS", credits "GOLD", the GM "WARDEN".
//
// Every place that shows a term asks with the text it shows today:
//
//   word('money', 'plural', 'CREDITS')
//
// Under a built-in system the answer is always that text, so CWN, Cyberpunk RED, Shadowrun and
// Generic read exactly as they always have, whatever each place's wording is. Under a custom
// system it is that system's word, or the neutral default where it set none; the server
// resolves both (systemBuilder/definition.js resolveWords). Until the custom system's words
// have loaded, the text shown today stands in. Window titles (BANK.EXE) are never asked.

export type Term = 'character' | 'hp' | 'money' | 'level' | 'xp' | 'class' | 'initiative'
  | 'round' | 'turn' | 'gm' | 'shop' | 'bank' | 'vehicle';
export type WordForm = 'singular' | 'plural' | 'short';

/** What `system` calls `term` in `form`, or `builtIn` (the text this place shows today). */
export const wordFor = (system: string | null | undefined, term: Term, form: WordForm, builtIn: string): string => {
  if (!isCustomSystem(system)) return builtIn;
  const word = customTemplate(system)?.words?.[term]?.[form];
  return typeof word === 'string' && word ? word : builtIn;
};

/**
 * `word(term, form, builtIn)` for the running system, redrawing when a custom system's words
 * arrive. Fetches them if nobody has yet.
 */
export function useWords(system: string | null | undefined) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const onLoaded = (e: Event) => { if ((e as CustomEvent).detail?.id === system) redraw(); };
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
    // Asks the server only about a custom system (loadCustomTemplate refuses a built-in id).
    if (system) void loadCustomTemplate(system);
    return () => window.removeEventListener(CUSTOM_TEMPLATE_EVENT, onLoaded);
  }, [system]);
  return (term: Term, form: WordForm, builtIn: string) => wordFor(system, term, form, builtIn);
}
