/**
 * What React Flow needs from a browser that jsdom doesn't have (its own testing guide does the
 * same): a ResizeObserver, a DOMMatrixReadOnly to read the zoom from, and element sizes. Only the
 * tests that draw the graph view call this. Where nodes sit and where wires go are laid out by a
 * real browser in e2e/tests/builder-graph.spec.ts; these tests check what is drawn and what it does.
 */
export const standInsForReactFlow = () => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!('DOMMatrixReadOnly' in globalThis)) {
    (globalThis as Record<string, unknown>).DOMMatrixReadOnly = class {
      m22: number;
      constructor(transform?: string) { const scale = /scale\(([\d.]+)\)/.exec(transform ?? ''); this.m22 = scale ? Number(scale[1]) : 1; }
    };
  }
  const size = (prop: 'offsetWidth' | 'offsetHeight', css: 'width' | 'height') => {
    if (Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)?.configurable === false) return;
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get(this: HTMLElement) { return parseFloat(this.style[css]) || 1; } });
  };
  size('offsetWidth', 'width');
  size('offsetHeight', 'height');
};
