/**
 * Chart.js-based plot for GraphElement — pan/zoom via chartjs-plugin-zoom.
 * Mathematical viewport is independent of canvas element geometry.
 */

import { useEffect, useMemo, useRef } from 'react';
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
import type { GraphViewport } from './types';
import { isValidViewport } from './types';
import { sampleAllExpressions } from './sampling';

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

/** Draw x=0 / y=0 axes through the plot area. */
const axisPlugin: Plugin<'line' | 'scatter'> = {
  id: 'graphAxes',
  beforeDatasetsDraw(chart) {
    const settings = (chart.options.plugins as { graphSettings?: GraphElement['settings'] })
      ?.graphSettings;
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

ChartJS.register(axisPlugin);

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

  const samples = useMemo(
    () =>
      sampleAllExpressions(element.expressions, element.viewport, {
        pixelWidth: Math.max(width, 1),
      }),
    [element.expressions, element.viewport, width],
  );

  const data: ChartData<'line' | 'scatter'> = useMemo(() => {
    const datasets: ChartData<'line' | 'scatter'>['datasets'] = [];

    for (const sampled of samples) {
      sampled.segments.forEach((segment, segIndex) => {
        datasets.push({
          type: 'line',
          label: `${sampled.expressionId}:${segIndex}`,
          data: segment.map((p) => ({ x: p.x, y: p.y as number })),
          borderColor: sampled.color,
          backgroundColor: sampled.color,
          borderWidth: sampled.strokeWidth,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0,
          spanGaps: false,
          showLine: true,
        });
      });
    }

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
  }, [samples, element.points]);

  const options: ChartOptions<'line' | 'scatter'> = useMemo(() => {
    const { viewport, settings } = element;
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
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: interactive,
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed?.x;
              return typeof x === 'number' ? `x = ${x.toPrecision(4)}` : '';
            },
            label: (item) => {
              const y = item.parsed?.y;
              return typeof y === 'number' ? `y = ${y.toPrecision(4)}` : '';
            },
          },
        },
        // custom plugin config
        graphSettings: settings,
        zoom: {
          limits: {
            x: { min: -1e6, max: 1e6, minRange: 1e-4 },
            y: { min: -1e6, max: 1e6, minRange: 1e-4 },
          },
          pan: {
            enabled: interactive,
            mode: 'xy',
            onPanComplete: ({ chart }) => {
              const next = readViewportFromChart(chart);
              if (next) onViewportChange(next);
            },
          },
          zoom: {
            wheel: { enabled: interactive, speed: 0.08 },
            pinch: { enabled: interactive },
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
        // react-chartjs-2 passes native event on chart — use lastEvent
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
  }, [element, interactive, onViewportChange, onCursorMove]);

  // Keep chart scales in sync when viewport changes from outside (limits editor / reset).
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

  return (
    <div
      className="graph-plot"
      style={{ width, height, pointerEvents: interactive ? 'auto' : 'none' }}
    >
      <Chart
        ref={chartRef as never}
        type="line"
        data={data as ChartData<'line'>}
        options={options as ChartOptions<'line'>}
      />
    </div>
  );
}
