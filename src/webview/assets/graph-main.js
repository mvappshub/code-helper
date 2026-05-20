async function boot() {
  const [{ state, vscode }, { buildOverlay }, { createRenderer }, { createSimulator }, { setupInteraction }] =
    await Promise.all([
      import('./graph-state.js'),
      import('./graph-utils.js'),
      import('./graph-render.js'),
      import('./graph-simulate.js'),
      import('./graph-interaction.js'),
    ]);

  const renderer = createRenderer(state);
  const simulator = createSimulator(
    state,
    renderer.draw,
    () => ({
      width: state.canvas.width / devicePixelRatio,
      height: state.canvas.height / devicePixelRatio,
    })
  );

  function resize() {
    const rect = state.wrap.getBoundingClientRect();
    state.canvas.width = rect.width * devicePixelRatio;
    state.canvas.height = rect.height * devicePixelRatio;
    state.canvas.style.width = `${rect.width}px`;
    state.canvas.style.height = `${rect.height}px`;
    renderer.draw();
  }

  function applyGraphData(graphData) {
    const oldPos = {};
    state.nodes.forEach((node) => {
      oldPos[node.id] = { x: node.x, y: node.y };
    });

    const width = state.canvas.width / devicePixelRatio;
    const height = state.canvas.height / devicePixelRatio;
    state.nodes = graphData.nodes.map((node) => ({
      ...node,
      x: oldPos[node.id]?.x ?? width / 2 + (Math.random() - 0.5) * 200,
      y: oldPos[node.id]?.y ?? height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));

    state.indexMap = {};
    state.nodes.forEach((node, index) => {
      state.indexMap[node.id] = index;
    });

    state.edges = graphData.edges.filter((edge) =>
      state.indexMap[edge.source] !== undefined && state.indexMap[edge.target] !== undefined
    );
    state.emptyState.style.display = state.nodes.length === 0 ? 'flex' : 'none';

    if (state.cfg.layout === 'tree') {
      simulator.applyTreeLayout();
    } else if (state.cfg.layout === 'radial') {
      simulator.applyRadialLayout();
    }

    renderer.updateStatus(graphData);
    simulator.startSimulation();
  }

  new ResizeObserver(resize).observe(state.wrap);
  setupInteraction(state, {
    applyRadialLayout: simulator.applyRadialLayout,
    applyTreeLayout: simulator.applyTreeLayout,
    draw: renderer.draw,
    fitView: renderer.fitView,
    nodeRadius: renderer.nodeRadius,
    postMessage: vscode.postMessage,
    startSimulation: simulator.startSimulation,
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type !== 'update') {
      return;
    }
    if (state.latestGeneratedAt && msg.data.generatedAt < state.latestGeneratedAt) {
      return;
    }

    state.latestGeneratedAt = msg.data.generatedAt;
    state.cfg = msg.config;
    state.layoutSelect.value = state.cfg.layout;
    state.overlayById = buildOverlay(msg.data, msg.insights, msg.entryPointPatterns || []);
    applyGraphData(msg.data);
  });

  resize();
}

(async () => {
  try {
    await boot();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    vscodeApi?.postMessage({
      type: 'webviewError',
      message: error.message,
      stack: error.stack ?? '',
    });
    document.body.innerHTML = `<pre style="color: var(--vscode-errorForeground); padding: 1em;">Webview crashed: ${String(error.message || error)}</pre>`;
  }
})();
