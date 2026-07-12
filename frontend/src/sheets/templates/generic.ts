import type { SheetTemplate } from '../types';

// System-agnostic starter template. Used when no specific game system is
// selected, and as the fallback for systems without a template yet.
export const generic: SheetTemplate = {
  id: 'generic',
  name: 'Generic',
  sections: [
    {
      id: 'identity',
      label: 'IDENTITY',
      layout: 'list',
      fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
        { id: 'concept', label: 'Concept / Class', type: 'text' },
        { id: 'description', label: 'Description', type: 'textarea', visibility: 'public' },
      ],
    },
    {
      id: 'stats',
      label: 'STATS',
      layout: 'notes',
      fields: [
        { id: 'stats_notes', label: 'Stats & abilities', type: 'textarea' },
      ],
    },
    {
      id: 'gear',
      label: 'GEAR',
      layout: 'notes',
      fields: [
        { id: 'gear_notes', label: 'Gear & inventory', type: 'textarea' },
      ],
    },
    {
      id: 'notes',
      label: 'NOTES',
      layout: 'notes',
      fields: [
        { id: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
};
