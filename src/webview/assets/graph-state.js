export const vscode = acquireVsCodeApi();

export const state = {
  cfg: { locWarning: 500, locDanger: 1000, layout: 'force' },
  overlayById: {},
  latestGeneratedAt: '',
  nodes: [],
  edges: [],
  indexMap: {},
  scale: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  lastMX: 0,
  lastMY: 0,
  hoveredNode: null,
  searchQuery: '',
  mouseDownPos: null,
  mouseDownTime: 0,
  rafId: null,
  alpha: 1,
  canvas: document.getElementById('graph-canvas'),
  wrap: document.getElementById('canvas-wrap'),
  tooltip: document.getElementById('tooltip'),
  statusEl: document.getElementById('status'),
  layoutSelect: document.getElementById('layout-select'),
  emptyState: document.getElementById('empty-state'),
  searchInput: document.getElementById('search-input'),
};

state.ctx = state.canvas.getContext('2d');

export function getViewportSize() {
  return {
    width: state.canvas.width / devicePixelRatio,
    height: state.canvas.height / devicePixelRatio,
  };
}
