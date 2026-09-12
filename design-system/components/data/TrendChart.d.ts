import * as React from "react";

export interface TrendChartProps {
  series?: Array<{ label?: string; values: number[]; color?: string }>;
  labels?: string[];
  height?: number;
  area?: boolean;
  yTicks?: number;
  valueFormat?: (v: number) => React.ReactNode;
}

export declare function TrendChart(props: TrendChartProps): JSX.Element;

export interface SparklineProps {
  values?: number[];
  width?: number;
  height?: number;
  tone?: string;
}

export declare function Sparkline(props: SparklineProps): JSX.Element;

export interface BarChartProps {
  data?: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  valueFormat?: (v: number) => React.ReactNode;
}

export declare function BarChart(props: BarChartProps): JSX.Element;

export interface ChartLegendProps {
  items?: Array<{ label: string; color?: string }>;
}

export declare function ChartLegend(props: ChartLegendProps): JSX.Element;
