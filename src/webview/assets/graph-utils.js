export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function basename(file) {
  const bits = String(file).split('/');
  return bits[bits.length - 1] || file;
}

export function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) {
    return [pattern];
  }

  return match[1]
    .split(',')
    .flatMap((part) => expandBraces(pattern.replace(match[0], part)));
}

function toPatternRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .split('**/')
    .join('__GLOBSTAR_DIR__')
    .split('**')
    .join('__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .split('__GLOBSTAR_DIR__')
    .join('(?:.*/)?')
    .split('__GLOBSTAR__')
    .join('.*');

  return new RegExp(`^${escaped}$`);
}

export function matchesAnyPattern(filePath, patterns) {
  const normalised = String(filePath).replace(/\\/g, '/');
  const fileBase = basename(normalised);

  return patterns.some((pattern) =>
    expandBraces(pattern).some((expanded) => {
      const re = toPatternRegExp(expanded);
      return re.test(normalised) || re.test(fileBase);
    })
  );
}

export function buildOverlay(graphData, insights, entryPointPatterns) {
  const overlay = {};

  graphData.nodes.forEach((node) => {
    if (matchesAnyPattern(node.path, entryPointPatterns)) {
      overlay[node.id] = { category: 'entrypoint', reason: 'Entry point' };
    }
  });

  if (!insights) {
    return overlay;
  }

  (insights.fanOut || []).forEach((fanOut) => {
    overlay[fanOut.nodes[0]] = {
      category: 'fan-out',
      reason: `Fan-out: imports ${fanOut.metric} files`,
    };
  });

  (insights.hubs || []).forEach((hub) => {
    overlay[hub.nodes[0]] = {
      category: 'hub',
      reason: `Hub: imported by ${hub.metric} files`,
    };
  });

  (insights.cycles || []).forEach((cycle) => {
    const reason = `In cycle with: ${cycle.nodes.map((id) => basename(id)).join(', ')}`;
    cycle.nodes.forEach((nodeId) => {
      overlay[nodeId] = { category: 'cycle', reason };
    });
  });

  return overlay;
}
