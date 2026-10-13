/**
 * Chart.js-based plot for GraphElement — pan/zoom via chartjs-plugin-zoom.
 * Mathematical viewport is independent of canvas element geometry.
 * Native annotations: legend, shaded regions, curve segments, point labels.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { GraphElement } from '../../types/canvas';
import type { GraphExpression, GraphPoint, GraphRegion, GraphViewport } from './types';
import {
  expressionDisplayLabel,
  isValidViewport,
  shouldShowLegend,
} from './types';
import { sampleAllExpressions } from './sampling';
import { useGraphUiStore } from './graphUiStore';
import { uiAddGraphRegion } from './graphComponentUi';

ChartJS.register(
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  zoomPlugin,
);

type GraphPluginOpts = {
  graphSettings?: GraphElement['settings'];
  regions?: GraphRegion[];
  expressions?: GraphExpression[];
  points?: GraphPoint[];
  samples?: ReturnType<typeof sampleAllExpressions>;
};

function pluginOpts(chart: ChartJS): GraphPluginOpts {
  return (chart.options.plugins as GraphPluginOpts) ?? {};
}

/** Draw x=0 / y=0 axes through the plot area. */
const axisPlugin: Plugin<'line' | 'scatter'> = {
  id: 'graphAxes',
  beforeDatasetsDraw(chart) {
    const settings = pluginOpts(chart).graphSettings;
    if (!settings) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.clip();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';

    if (settings.showXAxis && yScale.min <= 0 && yScale.max >= 0) {
      const y = yScale.getPixelForValue(0);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
    }
    if (settings.showYAxis && xScale.min <= 0 && xScale.max >= 0) {
      const x = xScale.getPixelForValue(0);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};

/** Shade x-intervals / rectangles behind curves. */
const regionFillPlugin: Plugin<'line' | 'scatter'> = {
  id: 'graphRegionFills',
  beforeDatasetsDraw(chart) {
    const regions = pluginOpts(chart).regions ?? [];
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.clip();

    for (const region of regions) {
      if (!region.visible) continue;
      if (region.type === 'curve_segment') continue;
      const x0 = xScale.getPixelForValue(Math.min(region.xMin, region.xMax));
      const x1 = xScale.getPixelForValue(Math.max(region.xMin, region.xMax));
      let y0 = chartArea.top;
      let y1 = chartArea.bottom;
      if (
        region.type === 'rectangle' &&
        region.yMin != null &&
        region.yMax != null
      ) {
        y0 = yScale.getPixelForValue(Math.max(region.yMin, region.yMax));
        y1 = yScale.getPixelForValue(Math.min(region.yMin, region.yMax));
      }
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      const top = Math.min(y0, y1);
      const bottom = Math.max(y0, y1);
      ctx.fillStyle = 'rgba(37, 99, 235, 0.14)';
      ctx.fillRect(left, top, right - left, bottom - top);

      if (region.label.trim()) {
        ctx.fillStyle = 'rgba(30, 41, 59, 0.75)';
        ctx.font = '11px Georgia, "Times New Roman", serif';
        ctx.textBaseline = 'top';
        const labelX = Math.max(left + 4, chartArea.left + 2);
        const labelY = Math.max(top + 4, chartArea.top + 2);
        ctx.fillText(region.label.trim(), labelX, labelY);
      }
    }
    ctx.restore();
  },
};

/** Emphasise curve segments using sampled geometry. */
const regionSegmentPlugin: Plugin<'line' | 'scatter'> = {
  id: 'graphRegionSegments',
  afterDatasetsDraw(chart) {
    const regions = pluginOpts(chart).regions ?? [];
    const samples = pluginOpts(chart).samples ?? [];
    const expressions = pluginOpts(chart).expressions ?? [];
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.clip();

    for (const region of regions) {
      if (!region.visible || region.type !== 'curve_segment') continue;
      if (!region.expressionId) continue;
      const sampled = samples.find((s) => s.expressionId === region.expressionId);
      const expr = expressions.find((e) => e.id === region.expressionId);
      if (!sampled) continue;
      const xMin = Math.min(region.xMin, region.xMax);
      const xMax = Math.max(region.xMin, region.xMax);
      ctx.strokeStyle = expr?.style.color ?? '#dc2626';
      ctx.lineWidth = Math.max((expr?.style.strokeWidth ?? 2) + 2.5, 3.5);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.9;

      for (const segment of sampled.segments) {
        let started = false;
        for (const p of segment) {
          if (p.x < xMin || p.x > xMax || !Number.isFinite(p.y)) {
            started = false;
            continue;
          }
          const px = xScale.getPixelForValue(p.x);
          const py = yScale.getPixelForValue(p.y as number);
          if (!started) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        if (started) ctx.stroke();
      }

      if (region.label.trim()) {
        const midX = (xMin + xMax) / 2;
        let midY: number | null = null;
        for (const segment of sampled.segments) {
          for (const p of segment) {
            if (Math.abs(p.x - midX) < (xMax - xMin) / 40 && Number.isFinite(p.y)) {
              midY = p.y as number;
              break;
            }
          }
          if (midY != null) break;
        }
        if (midY != null) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
          ctx.font = '11px Georgia, "Times New Roman", serif';
          ctx.fillText(
            region.label.trim(),
            xScale.getPixelForValue(midX) + 4,
            yScale.getPixelForValue(midY) - 10,
          );
        }
      }
    }
    ctx.restore();
  },
};

type LabelPlacement = { x: number; y: number; w: number; h: number };

/** Draw GraphPoint labels with simple collision avoidance. */
const pointLabelPlugin: Plugin<'line' | 'scatter'> = {
  id: 'graphPointLabels',
  afterDatasetsDraw(chart) {
    const points = (pluginOpts(chart).points ?? []).filter(
      (p) => p.visible && p.label.trim(),
    );
    if (points.length === 0) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;

    ctx.save();
    ctx.font = '11px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    const placed: LabelPlacement[] = [];

    const overlaps = (a: LabelPlacement) =>
      placed.some(
        (b) =>
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y,
      );

    for (const p of points) {
      const px = xScale.getPixelForValue(p.x);
      const py = yScale.getPixelForValue(p.y);
      if (
        px < chartArea.left - 20 ||
        px > chartArea.right + 20 ||
        py < chartArea.top - 20 ||
        py > chartArea.bottom + 20
      ) {
        continue;
      }
      const text = p.label.trim();
      const metrics = ctx.measureText(text);
      const w = metrics.width;
      const h = 14;
      const candidates = [
        { x: px + 8, y: py - 10 },
        { x: px + 8, y: py + 12 },
        { x: px - w - 8, y: py - 10 },
        { x: px - w - 8, y: py + 12 },
        { x: px - w / 2, y: py - 18 },
      ];
      let chosen = candidates[0]!;
      for (const c of candidates) {
        const box = { x: c.x, y: c.y - h / 2, w, h };
        const inBounds =
          box.x >= chartArea.left &&
          box.x + box.w <= chartArea.right &&
          box.y >= chartArea.top &&
          box.y + box.h <= chartArea.bottom;
        if (inBounds && !overlaps(box)) {
          chosen = c;
          placed.push(box);
          break;
        }
        chosen = c;
      }
      if (placed[placed.length - 1]?.x !== chosen.x) {
        placed.push({ x: chosen.x, y: chosen.y - h / 2, w, h });
      }
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillText(text, chosen.x, chosen.y);
    }
    ctx.restore();
  },
};

ChartJS.register(axisPlugin, regionFillPlugin, regionSegmentPlugin, pointLabelPlugin);

interface Props {
  element: GraphElement;
  /** CSS pixel size of the plot area (already zoom-adjusted by parent). */
  width: number;
  height: number;
  interactive: boolean;
  onViewportChange: (viewport: GraphViewport) => void;
  onCursorMove?: (coords: { x: number; y: number } | null) => void;
}

function readViewportFromChart(chart: ChartJS): GraphViewport | null {
  const x = chart.scales.x;
  const y = chart.scales.y;
  if (!x || !y) return null;
  const next: GraphViewport = {
    xMin: x.min,
    xMax: x.max,
    yMin: y.min,
    yMax: y.max,
  };
  return isValidViewport(next) ? next : null;
}

export function GraphPlot({
  element,
  width,
  height,
  interactive,
  onViewportChange,
  onCursorMove,
}: Props) {
  const chartRef = useRef<ChartJS<'line' | 'scatter'> | null>(null);
  const viewportRef = useRef(element.viewport);
  viewportRef.current = element.viewport;
  const regionTool = useGraphUiStore((s) =>
    s.regionTool?.graphId === element.id ? s.regionTool : null,
  );
  const clearRegionTool = useGraphUiStore((s) => s.clearRegionTool);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [dragBox, setDragBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const regionSelectActive = Boolean(regionTool);

  const samples = useMemo(
    () =>
      sampleAllExpressions(element.expressions, element.viewport, {
        pixelWidth: Math.max(width, 1),
      }),
    [element.expressions, element.viewport, width],
  );

  const showLegend = shouldShowLegend(element.settings, element.expressions);

  /** One dataset per visible expression for legend (first segment carries label). */
  const data: ChartData<'line' | 'scatter'> = useMemo(() => {
    const datasets: ChartData<'line' | 'scatter'>['datasets'] = [];
    const legendSeen = new Set<string>();

    for (const sampled of samples) {
      const expr = element.expressions.find((e) => e.id === sampled.expressionId);
      const display = expr ? expressionDisplayLabel(expr) : sampled.expressionId;
      sampled.segments.forEach((segment, segIndex) => {
        const isLegendEntry = !legendSeen.has(sampled.expressionId);
        if (isLegendEntry) legendSeen.add(sampled.expressionId);
        datasets.push({
          type: 'line',
          label: isLegendEntry ? display : `${display}:${segIndex}`,
          data: segment.map((p) => ({ x: p.x, y: p.y as number })),
          borderColor: sampled.color,
          backgroundColor: sampled.color,
          borderWidth: sampled.strokeWidth,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0,
          spanGaps: false,
          showLine: true,
          // Hide duplicate segment entries from legend
          ...(isLegendEntry
            ? {}
            : { legend: { display: false } as never }),
        });
      });
    }

    // Filter legend via generateLabels instead of per-dataset flags for Chart.js v4
    const visiblePoints = element.points.filter((p) => p.visible);
    if (visiblePoints.length > 0) {
      datasets.push({
        type: 'scatter',
        label: 'points',
        data: visiblePoints.map((p) => ({ x: p.x, y: p.y })),
        backgroundColor: visiblePoints.map((p) => p.color),
        borderColor: visiblePoints.map((p) => p.color),
        pointRadius: 4,
        pointHoverRadius: 6,
        showLine: false,
      });
    }

    return { datasets };
  }, [samples, element.points, element.expressions]);

  const options: ChartOptions<'line' | 'scatter'> = useMemo(() => {
    const { viewport, settings } = element;
    const legendLabels = new Set(
      element.expressions.filter((e) => e.visible).map((e) => expressionDisplayLabel(e)),
    );
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'x',
      },
      layout: {
        padding: { bottom: showLegend ? 4 : 0 },
      },
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          align: 'start',
          labels: {
            boxWidth: 18,
            boxHeight: 2,
            padding: 10,
            color: '#334155',
            font: { size: 11, family: 'Georgia, "Times New Roman", serif' },
            filter: (item) => {
              const text = item.text ?? '';
              if (text === 'points') return false;
              // Keep only primary expression labels (no :segIndex suffixes that aren't display)
              if (text.includes(':') && !legendLabels.has(text)) return false;
              return legendLabels.has(text) || !text.includes(':');
            },
          },
        },
        tooltip: {
          enabled: interactive,
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed?.x;
              return typeof x === 'number' ? `x = ${x.toPrecision(4)}` : '';
            },
            label: (item) => {
              const y = item.parsed?.y;
              const name = item.dataset.label;
              const yText = typeof y === 'number' ? `y = ${y.toPrecision(4)}` : '';
              if (name && name !== 'points' && !name.includes(':')) {
                return `${name}: ${yText}`;
              }
              return yText;
            },
          },
        },
        graphSettings: settings,
        regions: element.regions ?? [],
        expressions: element.expressions,
        points: element.points,
        samples,
        zoom: {
          limits: {
            x: { min: -1e6, max: 1e6, minRange: 1e-4 },
            y: { min: -1e6, max: 1e6, minRange: 1e-4 },
          },
          pan: {
            enabled: interactive && !regionSelectActive,
            mode: 'xy',
            onPanComplete: ({ chart }) => {
              const next = readViewportFromChart(chart);
              if (next) onViewportChange(next);
            },
          },
          zoom: {
            wheel: { enabled: interactive && !regionSelectActive, speed: 0.08 },
            pinch: { enabled: interactive && !regionSelectActive },
            mode: 'xy',
            onZoomComplete: ({ chart }) => {
              const next = readViewportFromChart(chart);
              if (next) onViewportChange(next);
            },
          },
        },
      } as ChartOptions<'line' | 'scatter'>['plugins'],
      scales: {
        x: {
          type: 'linear',
          min: viewport.xMin,
          max: viewport.xMax,
          grid: {
            display: settings.showGrid,
            color: 'rgba(15, 23, 42, 0.08)',
          },
          border: { display: false },
          title: {
            display: !!settings.xAxisLabel,
            text: settings.xAxisLabel,
            color: '#334155',
          },
          ticks: {
            maxTicksLimit: 10,
            color: '#64748b',
            font: { size: 10 },
          },
        },
        y: {
          type: 'linear',
          min: viewport.yMin,
          max: viewport.yMax,
          grid: {
            display: settings.showGrid,
            color: 'rgba(15, 23, 42, 0.08)',
          },
          border: { display: false },
          title: {
            display: !!settings.yAxisLabel,
            text: settings.yAxisLabel,
            color: '#334155',
          },
          ticks: {
            maxTicksLimit: 10,
            color: '#64748b',
            font: { size: 10 },
          },
        },
      },
      onHover: (_event, _elements, chart) => {
        if (!interactive || !onCursorMove) return;
        const area = chart.chartArea;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        if (!area || !xScale || !yScale) return;
        const native = (chart as ChartJS & { _lastEvent?: { x?: number; y?: number } })
          ._lastEvent;
        if (!native || native.x == null || native.y == null) {
          onCursorMove(null);
          return;
        }
        if (
          native.x < area.left ||
          native.x > area.right ||
          native.y < area.top ||
          native.y > area.bottom
        ) {
          onCursorMove(null);
          return;
        }
        onCursorMove({
          x: xScale.getValueForPixel(native.x) ?? 0,
          y: yScale.getValueForPixel(native.y) ?? 0,
        });
      },
    };
  }, [
    element,
    interactive,
    onViewportChange,
    onCursorMove,
    samples,
    showLegend,
    regionSelectActive,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const x = chart.scales.x;
    const y = chart.scales.y;
    if (!x || !y) return;
    const v = element.viewport;
    if (x.min === v.xMin && x.max === v.xMax && y.min === v.yMin && y.max === v.yMax) {
      return;
    }
    x.options.min = v.xMin;
    x.options.max = v.xMax;
    y.options.min = v.yMin;
    y.options.max = v.yMax;
    chart.update('none');
  }, [element.viewport]);

  const finishRegionDrag = (endClientX: number, endClientY: number) => {
    const chart = chartRef.current;
    const tool = regionTool;
    const start = dragRef.current;
    dragRef.current = null;
    setDragBox(null);
    if (!chart || !tool || !start) {
      clearRegionTool();
      return;
    }
    const rect = chart.canvas.getBoundingClientRect();
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) {
      clearRegionTool();
      return;
    }
    const px0 = start.startX - rect.left;
    const py0 = start.startY - rect.top;
    const px1 = endClientX - rect.left;
    const py1 = endClientY - rect.top;
    const x0 = xScale.getValueForPixel(Math.min(px0, px1));
    const x1 = xScale.getValueForPixel(Math.max(px0, px1));
    const y0 = yScale.getValueForPixel(Math.max(py0, py1));
    const y1 = yScale.getValueForPixel(Math.min(py0, py1));
    if (
      typeof x0 !== 'number' ||
      typeof x1 !== 'number' ||
      !Number.isFinite(x0) ||
      !Number.isFinite(x1) ||
      x0 === x1
    ) {
      clearRegionTool();
      return;
    }
    if (tool.regionType === 'rectangle') {
      if (
        typeof y0 !== 'number' ||
        typeof y1 !== 'number' ||
        !Number.isFinite(y0) ||
        !Number.isFinite(y1) ||
        y0 === y1
      ) {
        clearRegionTool();
        return;
      }
      uiAddGraphRegion(element.id, {
        type: 'rectangle',
        x_min: x0,
        x_max: x1,
        y_min: y0,
        y_max: y1,
      });
    } else if (tool.regionType === 'curve_segment') {
      const expressionId =
        tool.expressionId ?? element.expressions.find((e) => e.visible)?.id;
      if (!expressionId) {
        clearRegionTool();
        return;
      }
      uiAddGraphRegion(element.id, {
        type: 'curve_segment',
        expression_id: expressionId,
        x_min: x0,
        x_max: x1,
      });
    } else {
      uiAddGraphRegion(element.id, {
        type: 'x_interval',
        x_min: x0,
        x_max: x1,
      });
    }
    clearRegionTool();
  };

  return (
    <div
      className={[
        'graph-plot',
        regionSelectActive ? 'is-region-select' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        width,
        height,
        pointerEvents: interactive ? 'auto' : 'none',
        position: 'relative',
        cursor: regionSelectActive ? 'crosshair' : undefined,
      }}
      onPointerDown={(e) => {
        if (!regionSelectActive) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          curX: e.clientX,
          curY: e.clientY,
        };
        setDragBox({ left: 0, top: 0, width: 0, height: 0 });
      }}
      onPointerMove={(e) => {
        if (!regionSelectActive || !dragRef.current) return;
        dragRef.current.curX = e.clientX;
        dragRef.current.curY = e.clientY;
        const chart = chartRef.current;
        if (!chart) return;
        const rect = chart.canvas.getBoundingClientRect();
        const x0 = dragRef.current.startX - rect.left;
        const y0 = dragRef.current.startY - rect.top;
        const x1 = e.clientX - rect.left;
        const y1 = e.clientY - rect.top;
        const left = Math.min(x0, x1);
        const top =
          regionTool?.regionType === 'x_interval'
            ? chart.chartArea.top
            : Math.min(y0, y1);
        const boxH =
          regionTool?.regionType === 'x_interval'
            ? chart.chartArea.height
            : Math.abs(y1 - y0);
        setDragBox({
          left,
          top,
          width: Math.abs(x1 - x0),
          height: boxH,
        });
      }}
      onPointerUp={(e) => {
        if (!regionSelectActive || !dragRef.current) return;
        finishRegionDrag(e.clientX, e.clientY);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragBox(null);
        clearRegionTool();
      }}
    >
      <Chart
        ref={chartRef as never}
        type="line"
        data={data as ChartData<'line'>}
        options={options as ChartOptions<'line'>}
      />
      {dragBox && dragBox.width > 1 && (
        <div
          className="graph-region-drag-box"
          style={{
            position: 'absolute',
            left: dragBox.left,
            top: dragBox.top,
            width: dragBox.width,
            height: dragBox.height,
            background: 'rgba(37, 99, 235, 0.16)',
            border: '1px solid rgba(37, 99, 235, 0.45)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}
      {regionSelectActive && (
        <div
          className="graph-region-tool-hint"
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            fontSize: 11,
            color: '#334155',
            background: 'rgba(255,255,255,0.85)',
            padding: '2px 6px',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          Drag to highlight ({regionTool?.regionType.replace('_', ' ')})
        </div>
      )}
    </div>
  );
}
