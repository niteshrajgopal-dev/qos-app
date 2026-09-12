import * as React from "react";

export interface StepperProps {
  steps?: Array<string | { label: string }>;
  current?: number;
}

export declare function Stepper(props: StepperProps): JSX.Element;
