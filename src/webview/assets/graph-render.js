import { fmtTime } from './graph-utils.js';

export function createRenderer(state) {
  function nodeColor(node) {
    if (node.linesOfCode >= state.cfg.locDanger) {
      return '#f44747';
    }
    if (node.linesOfCode >= state.cfg.locWarning) {
      return '#ce9178';
    }
    return '#4ec9b0';
  }

  function nodeRadius(node) {
    return 6 * Math.min(1 + node.linesOfCode / 400, 4);
  }

  function getEdgeEndpoints(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const startOffset = Math.min(nodeRadius(source), Math.max(0, len / 2 - 1));
    const endOffset = Math.min(nodeRadius(target), Math.max(0, len / 2));

    return {
      startX: source.x + ux * startOffset,
      startY: source.y + uy * startOffset,
      endX: target.x - ux * endOffset,
      endY: target.y - uy * endOffset,
      ux,
      uy,
    };
  }

  function drawOverlay(node, radius, matchSearch) {
    const overlay = state.overlayById[node.id];
    if (!overlay || !matchSearch) {
      return;
    }

    if (overlay.category === 'entrypoint') {
      const triangleSize = Math.max(8, 12 / state.scale);
      state.ctx.fillStyle = '#ffd166';
      state.ctx.beginPath();
      state.ctx.moveTo(node.x, node.y - radius - triangleSize);
      state.ctx.lineTo(node.x - triangleSize * 0.8, node.y - radius - 2);
      state.ctx.lineTo(node.x + triangleSize * 0.8, node.y - radius - 2);
      state.ctx.closePath();
      state.ctx.fill();
      return;
    }

    state.ctx.beginPath();
    state.ctx.arc(node.x, node.y, radius + 3 / state.scale, 0, Math.PI * 2);
    state.ctx.lineWidth = 2 / state.scale;
    state.ctx.strokeStyle = overlay.category === 'cycle'
      ? '#ff5c57'
      : overlay.category === 'fan-out'
        ? '#4fc1ff'
        : '#d7ba7d';
    state.ctx.stroke();
  }

  function drawArrow(source, target, highlight) {
    const shaft = getEdgeEndpoints(source, target);
    const arrowLength = 8 / state.scale;
    const arrowWidth = 5 / state.scale;

    state.ctx.beginPath();
    state.ctx.moveTo(shaft.endX, shaft.endY);
    state.ctx.lineTo(
      shaft.endX - shaft.ux * arrowLength + shaft.uy * arrowWidth,
      shaft.endY - shaft.uy * arrowLength - shaft.ux * arrowWidth
    );
    state.ctx.lineTo(
      shaft.endX - shaft.ux * arrowLength - shaft.uy * arrowWidth,
      shaft.endY - shaft.uy * arrowLength + shaft.ux * arrowWidth
    );
    state.ctx.closePath();
    state.ctx.fillStyle = highlight ? state.ctx.strokeStyle : 'rgba(120,120,170,0.6)';
    state.ctx.fill();
  }

  function draw() {
    const dpr = devicePixelRatio;
    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    state.ctx.save();
    state.ctx.scale(dpr, dpr);
    state.ctx.translate(state.panX, state.panY);
    state.ctx.scale(state.scale, state.scale);

    state.ctx.lineWidth = 1;
    for (const edge of state.edges) {
      const source = state.nodes[state.indexMap[edge.source]];
      const target = state.nodes[state.indexMap[edge.target]];
      if (!source || !target) {
        continue;
      }

      const shaft = getEdgeEndpoints(source, target);
      state.ctx.beginPath();
      state.ctx.moveTo(shaft.startX, shaft.startY);
      state.ctx.lineTo(shaft.endX, shaft.endY);

      if (state.hoveredNode) {
        if (edge.source === state.hoveredNode.id) {
          state.ctx.strokeStyle = '#4fc1ff';
          state.ctx.globalAlpha = 1;
        } else if (edge.target === state.hoveredNode.id) {
          state.ctx.strokeStyle = '#ce9178';
          state.ctx.globalAlpha = 1;
        } else {
          state.ctx.strokeStyle = 'rgba(120,120,170,0.1)';
          state.ctx.globalAlpha = 0.1;
        }
      } else {
        state.ctx.strokeStyle = 'rgba(120,120,170,0.4)';
        state.ctx.globalAlpha = 1;
      }

      state.ctx.setLineDash([]);
      state.ctx.stroke();
      drawArrow(source, target, Boolean(state.hoveredNode && (
        edge.source === state.hoveredNode.id || edge.target === state.hoveredNode.id
      )));
      state.ctx.globalAlpha = 1;
    }

    for (const node of state.nodes) {
      const radius = nodeRadius(node);
      const matchSearch = !state.searchQuery
        || node.label.toLowerCase().includes(state.searchQuery)
        || node.id.toLowerCase().includes(state.searchQuery);

      state.ctx.globalAlpha = matchSearch ? 1 : 0.1;
      state.ctx.beginPath();
      state.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      state.ctx.fillStyle = nodeColor(node);
      state.ctx.fill();
      drawOverlay(node, radius, matchSearch);

      if (state.hoveredNode && state.hoveredNode.id === node.id && matchSearch) {
        state.ctx.strokeStyle = '#fff';
        state.ctx.lineWidth = 1.5;
        state.ctx.stroke();
      }

      state.ctx.fillStyle = matchSearch ? 'rgba(212,212,212,0.85)' : 'rgba(212,212,212,0.1)';
      state.ctx.font = `${Math.max(8, 9 / state.scale)}px monospace`;
      state.ctx.textAlign = 'center';
      state.ctx.fillText(node.label, node.x, node.y + radius + 10 / state.scale);
      state.ctx.globalAlpha = 1;
    }

    state.ctx.restore();
  }

  function fitView() {
    if (state.nodes.length === 0) {
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of state.nodes) {
      const radius = nodeRadius(node);
      minX = Math.min(minX, node.x - radius);
      maxX = Math.max(maxX, node.x + radius);
      minY = Math.min(minY, node.y - radius);
      maxY = Math.max(maxY, node.y + radius);
    }

    const width = state.canvas.width / devicePixelRatio;
    const height = state.canvas.height / devicePixelRatio;
    const pad = 40;
    state.scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 2);
    state.panX = (width - state.scale * (maxX + minX)) / 2;
    state.panY = (height - state.scale * (maxY + minY)) / 2;
    draw();
  }

  function updateStatus(graphData) {
    state.statusEl.textContent = `${graphData.nodes.length} files · ${graphData.edges.length} links · ${fmtTime(graphData.generatedAt)}`;
  }

  return { draw, fitView, nodeRadius, updateStatus };
}
