import type { SheetTemplate } from '../types';

// System-agnostic starter template. Used when no specific game system is
// selected, and as the fallback for systems without a template yet.
export const generic: SheetTemplate = {
  id: 'generic',
  name: 'Generic',
  tokenDefense: { editOnToken: true, label: 'AC' },
  header: {
    nameField: 'name',
    subtitleFields: ['concept'],
    hpField: 'hp',
    hpMaxField: 'hp_max',
  },
  tabs: ['STATS', 'GEAR', 'NOTES'],
  sections: [
    {
      id: 'identity',
      label: 'IDENTITY',
      layout: 'list',
      tab: 'STATS',
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
      tab: 'STATS',
      fields: [
        { id: 'stats_notes', label: 'Stats & abilities', type: 'textarea' },
      ],
    },
    {
      id: 'gear',
      label: 'GEAR',
      layout: 'list',
      tab: 'GEAR',
      fields: [
        { id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' },
        { id: 'gear_notes', label: 'Gear & inventory', type: 'textarea' },
      ],
    },
    {
      id: 'notes',
      label: 'NOTES',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
};
