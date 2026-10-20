import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useEffect, useRef } from 'react';
import { useThemeMode } from '../theme/theme';

// 按需引入，只打包用到的图表与组件
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** ECharts 的 React 包装：随容器尺寸自适应，option 变化时整体替换，跟随全站深浅色主题。 */
export function EChart({ option, height = 300 }: { option: EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { mode } = useThemeMode();
  const latest = useRef(option);
  latest.current = option;

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, mode === 'dark' ? 'dark' : undefined);
    chart.current = instance;
    instance.setOption({ backgroundColor: 'transparent', ...latest.current }, { notMerge: true });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [mode]);

  // 父组件每次渲染都会生成新的 option 对象：内容没变时不重设，避免图表清空后重播动画
  const applied = useRef('');
  useEffect(() => {
    const serialized = JSON.stringify(option);
    if (serialized === applied.current) return;
    applied.current = serialized;
    chart.current?.setOption({ backgroundColor: 'transparent', ...option }, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
