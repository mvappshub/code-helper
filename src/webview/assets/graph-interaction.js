import { esc } from './graph-utils.js';

export function setupInteraction(state, api) {
  function canvasToWorld(clientX, clientY) {
    return {
      x: (clientX - state.panX) / state.scale,
      y: (clientY - state.panY) / state.scale,
    };
  }

  function hitTest(clientX, clientY) {
    const { x, y } = canvasToWorld(clientX, clientY);
    for (const node of state.nodes) {
      const radius = api.nodeRadius(node) + 4;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 <= radius * radius) {
        return node;
      }
    }
    return null;
  }

  state.canvas.addEventListener('mousemove', (event) => {
    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    if (state.isPanning) {
      state.panX += mouseX - state.lastMX;
      state.panY += mouseY - state.lastMY;
      state.lastMX = mouseX;
      state.lastMY = mouseY;
      api.draw();
      return;
    }

    const hit = hitTest(mouseX, mouseY);
    state.hoveredNode = hit;

    if (!hit) {
      state.canvas.style.cursor = 'grab';
      state.tooltip.style.display = 'none';
      api.draw();
      return;
    }

    state.canvas.style.cursor = 'pointer';
    state.tooltip.style.display = 'block';
    state.tooltip.style.left = `${event.clientX - state.wrap.getBoundingClientRect().left + 12}px`;
    state.tooltip.style.top = `${event.clientY - state.wrap.getBoundingClientRect().top + 12}px`;

    const inDeg = state.edges.filter((edge) => edge.target === hit.id).length;
    const outDeg = state.edges.filter((edge) => edge.source === hit.id).length;
    state.tooltip.innerHTML = [
      `<strong>${esc(hit.label)}</strong>`,
      `${hit.language} · ${hit.linesOfCode} lines`,
      `↑ ${inDeg} incoming · ↓ ${outDeg} outgoing`,
      state.overlayById[hit.id] ? esc(state.overlayById[hit.id].reason) : '',
      `<small style="opacity:.6">${esc(hit.id)}</small>`,
    ].filter(Boolean).join('<br>');

    api.draw();
  });

  state.canvas.addEventListener('mousedown', (event) => {
    const rect = state.canvas.getBoundingClientRect();
    state.mouseDownPos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    state.mouseDownTime = Date.now();
    state.isPanning = true;
    state.canvas.classList.add('grabbing');
    state.lastMX = event.clientX - rect.left;
    state.lastMY = event.clientY - rect.top;
  });

  window.addEventListener('mouseup', (event) => {
    if (state.mouseDownPos && state.mouseDownTime) {
      const rect = state.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const dist = Math.hypot(mouseX - state.mouseDownPos.x, mouseY - state.mouseDownPos.y);
      const elapsed = Date.now() - state.mouseDownTime;
      if (dist < 5 && elapsed < 250) {
        const hit = hitTest(mouseX, mouseY);
        if (hit) {
          api.postMessage({ type: 'openFile', nodeId: hit.id });
        }
      }
    }

    state.mouseDownPos = null;
    state.mouseDownTime = 0;
    state.isPanning = false;
    state.canvas.classList.remove('grabbing');
  });

  state.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;

    state.panX = mouseX - delta * (mouseX - state.panX);
    state.panY = mouseY - delta * (mouseY - state.panY);
    state.scale = Math.max(0.1, Math.min(state.scale * delta, 10));
    api.draw();
  }, { passive: false });

  document.getElementById('btn-fit').addEventListener('click', api.fitView);
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    api.postMessage({ type: 'openSettings' });
  });

  state.searchInput.addEventListener('input', () => {
    state.searchQuery = state.searchInput.value.trim().toLowerCase();
    api.draw();
  });

  state.layoutSelect.addEventListener('change', () => {
    state.cfg.layout = state.layoutSelect.value;
    if (state.nodes.length === 0) {
      return;
    }
    if (state.cfg.layout === 'tree') {
      api.applyTreeLayout();
    } else if (state.cfg.layout === 'radial') {
      api.applyRadialLayout();
    }
    api.startSimulation();
  });
}
