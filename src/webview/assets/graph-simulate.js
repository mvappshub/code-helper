export function createSimulator(state, draw, getViewportSize) {
  const REPEL = 1800;
  const SPRING = 0.04;
  const SPRING_LEN = 120;
  const CENTER = 0.015;
  const DAMPING = 0.85;

  function applyTreeLayout() {
    if (state.nodes.length === 0) {
      return;
    }

    const { width, height } = getViewportSize();
    const inDeg = {};
    state.nodes.forEach((node) => { inDeg[node.id] = 0; });
    state.edges.forEach((edge) => { inDeg[edge.target] = (inDeg[edge.target] || 0) + 1; });

    let roots = state.nodes.filter((node) => inDeg[node.id] === 0);
    if (roots.length === 0) {
      roots = [state.nodes[0]];
    }

    const visited = new Set();
    const levels = [];
    let queue = roots.map((node) => ({ node, level: 0 }));

    while (queue.length > 0) {
      const next = [];
      for (const { node, level } of queue) {
        if (visited.has(node.id)) {
          continue;
        }
        visited.add(node.id);
        if (!levels[level]) {
          levels[level] = [];
        }
        levels[level].push(node);

        state.edges
          .filter((edge) => edge.source === node.id)
          .map((edge) => state.nodes[state.indexMap[edge.target]])
          .filter(Boolean)
          .forEach((child) => next.push({ node: child, level: level + 1 }));
      }
      queue = next;
    }

    const unvisited = state.nodes.filter((node) => !visited.has(node.id));
    if (unvisited.length > 0) {
      levels.push(unvisited);
    }

    const levelHeight = height / (levels.length + 1);
    levels.forEach((row, levelIndex) => {
      const slotWidth = width / (row.length + 1);
      row.forEach((node, nodeIndex) => {
        node.x = slotWidth * (nodeIndex + 1);
        node.y = levelHeight * (levelIndex + 1);
        node.vx = 0;
        node.vy = 0;
      });
    });
  }

  function applyRadialLayout() {
    if (state.nodes.length === 0) {
      return;
    }

    const { width, height } = getViewportSize();
    const centerX = width / 2;
    const centerY = height / 2;
    const maxLoc = Math.max(...state.nodes.map((node) => node.linesOfCode), 1);

    state.nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / state.nodes.length;
      const radius = 80 + (node.linesOfCode / maxLoc) * 180;
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
      node.vx = 0;
      node.vy = 0;
    });
  }

  function simulate() {
    const { width, height } = getViewportSize();
    const centerX = width / 2;
    const centerY = height / 2;

    for (let i = 0; i < state.nodes.length; i++) {
      for (let j = i + 1; j < state.nodes.length; j++) {
        const dx = state.nodes[j].x - state.nodes[i].x;
        const dy = state.nodes[j].y - state.nodes[i].y;
        const dist2 = dx * dx + dy * dy + 1;
        const force = REPEL / dist2;
        state.nodes[i].vx -= force * dx;
        state.nodes[i].vy -= force * dy;
        state.nodes[j].vx += force * dx;
        state.nodes[j].vy += force * dy;
      }
    }

    for (const edge of state.edges) {
      const source = state.nodes[state.indexMap[edge.source]];
      const target = state.nodes[state.indexMap[edge.target]];
      if (!source || !target) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = (dist - SPRING_LEN) * SPRING;
      source.vx += delta * dx / dist;
      source.vy += delta * dy / dist;
      target.vx -= delta * dx / dist;
      target.vy -= delta * dy / dist;
    }

    for (const node of state.nodes) {
      node.vx += (centerX - node.x) * CENTER;
      node.vy += (centerY - node.y) * CENTER;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  function tick() {
    if (state.cfg.layout !== 'force' || state.alpha < 0.001) {
      draw();
      return;
    }
    simulate();
    state.alpha *= 0.98;
    draw();
    state.rafId = requestAnimationFrame(tick);
  }

  function startSimulation() {
    state.alpha = 1;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
    }
    tick();
  }

  return { applyTreeLayout, applyRadialLayout, startSimulation };
}
