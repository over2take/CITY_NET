import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { TOUR, TOPICS, FORMULA_FUNCTIONS, EXAMPLES, HINTS, topicById } from '../builderHelp';
import { BUILDER_PAGES } from '../builderSession';
import { HEALTH_MODELS } from '../setup';
import { HelpHint, FieldName, ColumnHead, popoverPlace, POP_WIDTH } from '../../components/HelpHint';

/**
 * Help for GMs in the builder (4i; approved mockup docs/mockups/builder-help.html, 2026-10-13):
 * one module for the tour, the HELP page and every "?", held here to the builder's pages, the
 * formula engine's own functions (backend systemBuilder/expression.js) and the built-in examples.
 */

const req = createRequire(import.meta.url);
const { BUILTINS, parse } = req('../../../../backend/systemBuilder/expression.js');
const { exampleList } = req('../../../../backend/systemBuilder/examples.js');

afterEach(() => cleanup());

describe('the tour', () => {
  it('welcomes, then walks the rail top to bottom, SETUP to PUBLISH', () => {
    expect(TOUR.map((s) => s.at)).toEqual([null, 'setup', 'words', 'features', 'rules', 'sheet', 'try', 'publish']);
    const pages = new Set(BUILDER_PAGES.map((p) => p.id as string));
    for (const s of TOUR) {
      if (s.at && s.at !== 'publish') expect(pages.has(s.at), s.at).toBe(true);
      expect(s.text.length, s.title).toBeGreaterThan(40);
    }
    expect(TOUR).toHaveLength(8);
  });

  it('names each page as the rail does (PARTS since 7a2a)', () => {
    for (const s of TOUR) {
      const page = BUILDER_PAGES.find((p) => p.id === s.at);
      if (page) expect(s.title, s.at as string).toBe(page.label);
    }
    expect(TOUR.find((s) => s.at === 'features')!.title).toBe('PARTS');
  });

  it('stays eight steps, the STATS & RULES one pointing to HOUSE RULES (4j, decision 9)', () => {
    expect(TOUR.find((s) => s.at === 'rules')!.text).toContain('HOUSE RULES');
    expect(TOUR.some((s) => (s.at as string) === 'house_rules')).toBe(false);
    expect(topicById('rules').body.join(' ')).toContain('WITH A RULE');
  });
});

describe('the HELP page\'s topics', () => {
  it('getting started, a topic for every page with GO TO, and the references', () => {
    expect(TOPICS[0]).toMatchObject({ id: 'start', group: 'START', tour: true });
    const pages = TOPICS.filter((t) => t.group === 'PAGES');
    expect(pages.map((t) => t.page)).toEqual(BUILDER_PAGES.map((p) => p.id));
    expect(pages.map((t) => t.title)).toEqual(BUILDER_PAGES.map((p) => p.label));
    expect(TOPICS.filter((t) => t.group === 'REFERENCE').map((t) => t.title)).toEqual(['FORMULAS', 'DICE', 'HEALTH MODELS', 'SHARING AND VERSIONS', 'WHO SEES THE TARGET', 'EXAMPLES']);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const t of TOPICS) expect(t.body.length, t.id).toBeGreaterThan(0);
  });

  it('finds a topic by id, or the first', () => {
    expect(topicById('dice').title).toBe('DICE');
    expect(topicById('nope').id).toBe('start');
    expect(topicById(undefined).id).toBe('start');
  });

  it('explains every health model there is', () => {
    expect(topicById('health').body).toEqual(HEALTH_MODELS.map((m) => `${m.label}: ${m.worksLike}. Like ${m.examples}.`));
  });

  it('opens the built-in examples there are', () => {
    expect(topicById('examples').examples).toBe(true);
    expect(EXAMPLES.map((e) => e.id)).toEqual(exampleList().map((e: { id: string }) => e.id));
    expect(EXAMPLES.map((e) => e.name)).toEqual(exampleList().map((e: { name: string }) => e.name.toUpperCase()));
  });
});

describe('the formula reference', () => {
  it('lists every function the engine knows, and nothing it doesn\'t', () => {
    expect(FORMULA_FUNCTIONS.map((f) => f.name).sort()).toEqual(Object.keys(BUILTINS).sort());
  });

  it('gives each the arguments the engine takes, and an example it reads', () => {
    for (const f of FORMULA_FUNCTIONS) {
      const { min, max } = BUILTINS[f.name];
      const listed = f.args.split(', ');
      if (listed.includes('...')) expect(max, f.name).toBeGreaterThan(listed.length);
      else expect([min, max], f.name).toEqual([listed.length, listed.length]);
      expect(() => parse(f.example, () => false), f.example).not.toThrow();
      expect(f.example.startsWith(`${f.name}(`), f.example).toBe(true);
    }
  });
});

describe('the words beside each setting', () => {
  it('are sentences, filed by the page that shows them (each page\'s test checks they are all there)', () => {
    for (const [k, text] of Object.entries(HINTS)) {
      expect(k, k).toMatch(/^(setup|words|bank|rules|dice|rolls|choices|sheet|npcs|conditions|rests|house|only|try)\.[a-zA-Z]+$/);
      expect(text.length, k).toBeGreaterThan(30);
      expect(text.trim(), k).toMatch(/\.$/);
    }
  });
});

describe('the "?"', () => {
  it('says its words to screen readers, and shows them on hover and focus, gone again after', async () => {
    render(<p>Health model <HelpHint text="How characters get hurt." /></p>);
    const q = screen.getByRole('note', { name: 'How characters get hurt.' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(q);
    expect(screen.getByRole('tooltip').textContent).toBe('How characters get hurt.');
    fireEvent.mouseLeave(q);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    expect(document.activeElement).toBe(q);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('goes when focus moves on', async () => {
    render(<p><HelpHint text="first" /><button type="button">next</button></p>);
    await userEvent.tab();
    expect(screen.getByRole('tooltip').textContent).toBe('first');
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'next' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leaves Escape to the window when nothing is shown', () => {
    let reached = false;
    render(<div onKeyDown={(e) => { if (e.key === 'Escape') reached = true; }}><HelpHint text="x" /></div>);
    fireEvent.keyDown(screen.getByRole('note'), { key: 'Escape' });
    expect(reached).toBe(true);
  });

  it('sits right of the "?", or left of it where there is no room', () => {
    expect(popoverPlace({ left: 100, right: 114, top: 50 }, 1200)).toEqual({ left: 122, top: 46 });
    expect(popoverPlace({ left: 1000, right: 1014, top: 2 }, 1200)).toEqual({ left: 1000 - 8 - POP_WIDTH, top: 8 });
    expect(popoverPlace({ left: 100, right: 114, top: 50 }, 200)).toEqual({ left: 8, top: 46 });
    expect(popoverPlace({ left: 0, right: 14, top: 50 }, 14 + 8 + POP_WIDTH + 8)).toEqual({ left: 22, top: 46 });
  });
});

describe('a setting\'s name with its "?"', () => {
  it('names the field by its words alone, the "?" beside it', () => {
    render(<p><FieldName htmlFor="f" hint="What it does.">SYMBOL</FieldName><input id="f" /></p>);
    expect(screen.getByRole('textbox', { name: 'SYMBOL' })).toBeTruthy();
    expect(screen.getByRole('note', { name: 'What it does.' })).toBeTruthy();
  });

  it('places the pair where it is asked to', () => {
    render(<p><FieldName hint="Where it ends." boxStyle={{ justifySelf: 'end' }}>ENDS</FieldName></p>);
    expect((screen.getByText('ENDS').parentElement as HTMLElement).style.justifySelf).toBe('end');
  });

  it('is plain words where there is no one field', () => {
    render(<p><FieldName hint="How it counts.">COUNTED IN</FieldName></p>);
    expect(document.querySelector('label')).toBeNull();
    expect(screen.getByText('COUNTED IN').tagName).toBe('SPAN');
    expect(screen.getByRole('note', { name: 'How it counts.' })).toBeTruthy();
  });
});

describe('a column header with its "?"', () => {
  it('is named by its word alone, the "?" inside it', () => {
    render(<table><thead><tr><ColumnHead hint="The lowest.">LOWEST</ColumnHead><ColumnHead>NAME</ColumnHead><ColumnHead /></tr></thead></table>);
    const lowest = screen.getByRole('columnheader', { name: 'LOWEST' });
    expect(within(lowest).getByRole('note', { name: 'The lowest.' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'NAME' }).getAttribute('aria-label')).toBeNull();
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });
});
