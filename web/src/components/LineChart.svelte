<script module lang="ts">
  export interface Series {
    name: string;
    color: string;
    data: [number, number | null][];
    area?: boolean;
    dashed?: boolean;
    yAxis?: 0 | 1;
  }
</script>

<script lang="ts">
  // Zeitreihen mit ECharts (nur die benötigten Teile), dunkles Thema, passt sich der Breite an.
  import * as echarts from 'echarts/core';
  import { LineChart as EChartsLine } from 'echarts/charts';
  import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { onMount } from 'svelte';

  import { locale } from '../lib/i18n.svelte';

  echarts.use([EChartsLine, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer]);

  interface Props {
    series: Series[];
    height?: number;
    format?: (value: number) => string;
    formatRight?: (value: number) => string;
    legend?: boolean;
    markLine?: { value: number, label: string } | null;
    empty?: string;
    dayFormat?: boolean;
  }
  let { series, height = 240, format = v => String(v), formatRight, legend = true, markLine = null, empty = '', dayFormat = false }: Props = $props();

  let element: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  const hasData = $derived(series.some(s => s.data.some(p => p[1] != null)));

  function timeLabel(value: number): string {
    const date = new Date(value);
    if (dayFormat) {
      return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(date);
    }
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function render() {
    if (chart == null) {
      return;
    }
    const twoAxes = series.some(s => s.yAxis === 1);
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#6B7A8A' },
      grid: { left: 8, right: twoAxes ? 8 : 12, top: legend ? 30 : 12, bottom: 8, containLabel: true },
      legend: legend ? { show: true, top: 0, right: 0, textStyle: { color: '#C7D2DC', fontFamily: 'Inter, sans-serif', fontSize: 12 }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' } : { show: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0E141B',
        borderColor: '#2A3848',
        textStyle: { color: '#E6EDF3', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: '#3A4B5E' } },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          if (list.length === 0) {
            return '';
          }
          const when = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(list[0].value[0]));
          const rows = list.map((p: any) => {
            const right = series[p.seriesIndex]?.yAxis === 1 && formatRight != null;
            const value = p.value[1] == null ? '–' : (right ? formatRight!(p.value[1]) : format(p.value[1]));
            return `<div style="display:flex;gap:10px;justify-content:space-between"><span style="color:#9AAABB">${p.marker} ${p.seriesName}</span><span>${value}</span></div>`;
          });
          return `<div style="color:#9AAABB;margin-bottom:4px">${when}</div>${rows.join('')}`;
        }
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#1E2A36' } },
        axisTick: { show: false },
        axisLabel: { color: '#6B7A8A', formatter: (value: number) => timeLabel(value), hideOverlap: true },
        splitLine: { show: false }
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#6B7A8A', formatter: (value: number) => format(value) },
          splitLine: { lineStyle: { color: '#1E2A36' } },
          axisLine: { show: false },
          axisTick: { show: false }
        },
        {
          type: 'value',
          scale: true,
          show: twoAxes,
          axisLabel: { color: '#6B7A8A', formatter: (value: number) => (formatRight ?? format)(value) },
          splitLine: { show: false },
          axisLine: { show: false },
          axisTick: { show: false }
        }
      ],
      series: series.map((s, index) => ({
        name: s.name,
        type: 'line',
        yAxisIndex: s.yAxis ?? 0,
        data: s.data,
        showSymbol: false,
        smooth: 0.2,
        connectNulls: false,
        lineStyle: { color: s.color, width: 2, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: { color: s.color },
        areaStyle: s.area ? { color: s.color, opacity: 0.12 } : undefined,
        markLine: index === 0 && markLine != null ? {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: markLine.value, name: markLine.label }],
          lineStyle: { color: '#3A4B5E', type: 'dashed' },
          label: { color: '#9AAABB', formatter: markLine.label, position: 'insideEndTop', fontFamily: 'Inter, sans-serif', fontSize: 11 }
        } : undefined
      }))
    }, true);
  }

  onMount(() => {
    chart = echarts.init(element, undefined, { renderer: 'canvas' });
    render();
    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart?.dispose();
      chart = null;
    };
  });

  $effect(() => {
    // liest series, format, markLine reaktiv
    void series; void markLine; void format; void legend;
    render();
  });
</script>

<div style="position: relative; width: 100%; height: {height}px">
  <div bind:this={element} style="width: 100%; height: 100%"></div>
  {#if !hasData && empty}
    <div style="position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted-2); font-size: 12.5px; text-align: center; padding: 0 16px; pointer-events: none">{empty}</div>
  {/if}
</div>
