import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

class Element {
  attrs = new Map<string, string>();
  children: Element[] = [];
  parentElement: Element | null = null;
  style: Record<string, string> = {};
  id = '';
  className = '';
  hidden = false;
  textContent = '';
  isConnected = true;
  box = { left: 10, top: 10, width: 90, height: 28, right: 100, bottom: 38 };
  constructor(readonly tagName: string) {}
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  removeAttribute(name: string) { this.attrs.delete(name); }
  contains(node: Element | null): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  closest(_selector: string): Element | null { return this.attrs.has('title') || this.attrs.has('data-pip-tooltip') ? this : this.parentElement?.closest(_selector) ?? null; }
  querySelectorAll(selector: string): Element[] { return this.children.flatMap((child) => [...(selector === '[title]' && child.attrs.has('title') ? [child] : []), ...child.querySelectorAll(selector)]); }
  getBoundingClientRect() { return this.className === 'pipTooltip' ? { width: 180, height: 78 } : this.box; }
}
function fixture() {
  const body = new Element('body');
  const handlers = new Map<string, ((event: any) => void)[]>();
  let mutation: (records: any[]) => void = () => {};
  const button = body.appendChild(new Element('button'));
  button.setAttribute('title', 'Explain the selected code.');
  const context = createContext({
    document: { body, documentElement: { clientWidth: 320, clientHeight: 200 },
      createElement: (tag: string) => new Element(tag),
      addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, [...handlers.get(name) || [], fn]),
    },
    window: { innerWidth: 320, innerHeight: 200, addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, [...handlers.get(name) || [], fn]) },
    setTimeout, clearTimeout,
    MutationObserver: class { constructor(fn: (records: any[]) => void) { mutation = fn; } observe() {} },
  });
  runInContext(readFileSync('media/tooltip.js', 'utf8'), context);
  const tip = body.children.find((node) => node.id === 'pipControlTooltip')!;
  return { body, button, tip, context,
    event: (name: string, target = button, extra: Record<string, unknown> = {}) => handlers.get(name)?.forEach((fn) => fn({ target, ...extra })),
    mutate: (records: any[]) => mutation(records),
  };
}

describe('visible PIP tooltips', () => {
  it('shows actual hover text and upgrades native titles without duplicate browser tooltips', () => {
    vi.useFakeTimers();
    const ui = fixture();
    expect(ui.button.getAttribute('title')).toBeNull();
    expect(ui.button.getAttribute('data-pip-tooltip')).toBe('Explain the selected code.');
    expect(ui.tip.hidden).toBe(true);
    ui.event('pointerover');
    expect(ui.tip.hidden).toBe(true);
    vi.advanceTimersByTime(800);
    expect(ui.tip.hidden).toBe(false);
    expect(ui.tip.textContent).toBe('Explain the selected code.');
    expect(ui.tip.getAttribute('role')).toBe('tooltip');
    ui.event('pointerout', ui.button, { relatedTarget: null });
    expect(ui.tip.hidden).toBe(true);
    vi.useRealTimers();
  });

  it('supports keyboard focus, preserves existing descriptions, and dismisses on Escape', () => {
    const ui = fixture();
    ui.button.setAttribute('aria-describedby', 'existing-help');
    ui.event('focusin');
    expect(ui.button.getAttribute('aria-describedby')).toBe('existing-help pipControlTooltip');
    ui.event('keydown', ui.button, { key: 'Escape' });
    expect(ui.tip.hidden).toBe(true);
    expect(ui.button.getAttribute('aria-describedby')).toBe('existing-help');
    ui.event('focusout', ui.button, { relatedTarget: null });
    ui.event('focusin');
    expect(ui.tip.hidden).toBe(false);
  });

  it('keeps the tooltip inside a narrow viewport near the bottom-right corner', () => {
    const ui = fixture();
    ui.button.box = { left: 270, top: 170, width: 42, height: 25, right: 312, bottom: 195 };
    ui.event('focusin');
    const left = Number.parseFloat(ui.tip.style.left!), top = Number.parseFloat(ui.tip.style.top!);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 180).toBeLessThanOrEqual(312);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 78).toBeLessThanOrEqual(192);
  });

  it('handles generated controls, live title updates, and literal untrusted tooltip text', () => {
    const ui = fixture();
    const summary = ui.body.appendChild(new Element('summary'));
    summary.setAttribute('title', '<img src=x onerror=alert(1)>');
    ui.mutate([{ type: 'childList', addedNodes: [summary] }]);
    ui.event('focusin', summary);
    expect(ui.tip.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(ui.tip.children).toHaveLength(0);
    summary.setAttribute('title', 'Expand the grounded explanation.');
    ui.mutate([{ type: 'attributes', attributeName: 'title', target: summary }]);
    expect(summary.getAttribute('title')).toBeNull();
    expect(ui.tip.textContent).toBe('Expand the grounded explanation.');
    summary.isConnected = false;
    ui.event('resize', summary);
    expect(ui.tip.hidden).toBe(true);
  });

  it('loads the same nonce-authorised tooltip controller in sidebar and beside-editor surfaces', () => {
    for (const file of ['src/ui/sidebar.ts', 'src/ui/panel.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("'media', 'tooltip.js'");
      expect(source).toContain('<script nonce="${nonce}" src="${tooltips}"></script>');
    }
  });
});
