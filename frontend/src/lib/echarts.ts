/**
 * A trimmed ECharts build: only the chart types and components Localake draws.
 * The full `echarts` barrel is roughly 1 MB minified; this is a fraction of it.
 */
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent, LegendComponent, TitleComponent, TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart, BarChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  CanvasRenderer,
]);

export default echarts;
