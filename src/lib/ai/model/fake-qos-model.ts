import type { QosModel, QosModelRequest, QosModelResult } from "@/lib/ai/model/qos-model";

type ScriptedResult = QosModelResult | Error;

/**
 * Scriptable model for tests. Each `complete` consumes the next result; the
 * last one repeats. Records every request so isolation tests can prove the
 * definition and catalogue were not replaced.
 */
export class FakeQosModel implements QosModel {
  readonly provider = "mock" as const;
  readonly modelId: string;
  readonly requests: QosModelRequest[] = [];
  private results: ScriptedResult[] = [{ type: "completed", text: "{}", usage: null }];

  constructor(modelId = "fake-model") {
    this.modelId = modelId;
  }

  script(...results: ScriptedResult[]) {
    this.results = results;
    return this;
  }

  async complete(request: QosModelRequest): Promise<QosModelResult> {
    this.requests.push(request);
    const next = this.results.length > 1 ? this.results.shift()! : this.results[0]!;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
