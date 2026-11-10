/* One accessible, text-only tooltip shared by static and generated PIP controls. */
(() => {
  const attribute = 'data-pip-tooltip';
  const selector = `[${attribute}], [title]`;
  const id = 'pipControlTooltip';
  const tooltip = document.createElement('div');
  tooltip.id = id;
  tooltip.className = 'pipTooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let hoverTimer = null;
  let owner = null;
  let hovered = null;
  let focused = null;
  const dismissed = new WeakSet();

  function controlFor(node) {
    if (!node || node === tooltip || tooltip.contains(node)) return null;
    return node.closest?.(selector) || node.parentElement?.closest?.(selector) || null;
  }
  function upgrade(element) {
    if (!element?.getAttribute || element === tooltip || tooltip.contains(element)) return;
    const title = element.getAttribute('title');
    if (title !== null) {
      if (title.trim() && element.getAttribute(attribute) !== title) element.setAttribute(attribute, title);
      element.removeAttribute('title');
    }
  }
  function upgradeTree(root) {
    upgrade(root);
    root.querySelectorAll?.('[title]').forEach(upgrade);
  }
  function position() {
    if (!owner || tooltip.hidden) return;
    if (owner.isConnected === false) { hide(); return; }
    const rect = owner.getBoundingClientRect();
    const width = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 320);
    const height = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 600);
    const margin = 8;
    tooltip.style.maxWidth = `${Math.max(0, Math.min(360, width - margin * 2))}px`;
    tooltip.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
    const measured = tooltip.getBoundingClientRect();
    const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - measured.width / 2, width - measured.width - margin));
    const below = rect.bottom + 7;
    const top = below + measured.height <= height - margin ? below :
      Math.max(margin, Math.min(rect.top - measured.height - 7, height - measured.height - margin));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function hide() {
    if (owner) {
      const description = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter((part) => part && part !== id);
      if (description.length) owner.setAttribute('aria-describedby', description.join(' '));
      else owner.removeAttribute('aria-describedby');
    }
    owner = null;
    tooltip.hidden = true;
  }
  function show(control) {
    if (!control || dismissed.has(control)) return;
    upgrade(control);
    const text = control.getAttribute(attribute)?.trim();
    if (!text) { hide(); return; }
    if (owner !== control) hide();
    owner = control;
    if (tooltip.textContent !== text) tooltip.textContent = text;
    const describedBy = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(id);
    control.setAttribute('aria-describedby', [...describedBy].join(' '));
    tooltip.hidden = false;
    position();
  }
  document.addEventListener('pointerover', (event) => {
    if (tooltip.contains(event.target)) return;
    const control = controlFor(event.target);
    if (!control) return;
    hovered = control;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (hovered === control) show(control); }, 800);
  });
  document.addEventListener('pointerout', (event) => {
    clearTimeout(hoverTimer);
    if (owner?.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget)) return;
    const control = controlFor(event.target);
    if (control) { dismissed.delete(control); if (hovered === control) hovered = null; }
    if (tooltip.contains(event.target)) hovered = null;
    if (focused && !dismissed.has(focused)) show(focused);
    else hide();
  });
  document.addEventListener('focusin', (event) => {
    clearTimeout(hoverTimer);
    const control = controlFor(event.target);
    if (!control) return;
    focused = control;
    show(control);
  });
  document.addEventListener('focusout', (event) => {
    const control = controlFor(event.target);
    if (control?.contains(event.relatedTarget)) return;
    if (control) dismissed.delete(control);
    if (focused === control) focused = null;
    if (hovered && !dismissed.has(hovered)) show(hovered);
    else hide();
  });
  document.addEventListener('pointerdown', () => {
    clearTimeout(hoverTimer);
    if (owner) dismissed.add(owner);
    hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    clearTimeout(hoverTimer);
    if (owner) dismissed.add(owner);
    hide();
  });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  upgradeTree(document.body);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') upgrade(record.target);
        else record.addedNodes.forEach(upgradeTree);
      }
      if (owner && !tooltip.hidden) show(owner);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', attribute] });
  }
})();
