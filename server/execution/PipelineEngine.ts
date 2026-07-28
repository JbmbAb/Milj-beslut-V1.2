import { trace } from '@opentelemetry/api';
import type { ExecutableNode, ExecutablePipeline } from '../compiler/types';
import { createExecutionIdentity } from '../observability/ExecutionIdentity';
import { createObservationContext, type ObservationContext } from '../observability/ObservationContext';
import { executionSpanAttributes } from '../observability/executionSpanAttributes';
import { MetricRecorder } from '../observability/MetricRecorder';

export class PipelineEngine {
  private readonly tracer = trace.getTracer('mimer-pipeline');

  constructor(
    private readonly registryVersion: string,
    private readonly metricsContractHash: string,
    private readonly observabilitySchemaVersion: string,
  ) {}

  async execute(
    pipeline: ExecutablePipeline,
    input: { municipality?: string; caseType?: string; geoMode?: string },
  ): Promise<void> {
    // Fas A: pipelineHash mirrors executionHash until a dedicated definition hash exists.
    const identity = createExecutionIdentity(
      pipeline.id,
      pipeline.version,
      pipeline.hashes.executionHash,
      pipeline.hashes.manifestHash,
      pipeline.hashes.executionHash,
      this.registryVersion,
      this.metricsContractHash,
      this.observabilitySchemaVersion,
    );

    const ctx = createObservationContext(identity, input);

    const rootSpan = this.tracer.startSpan('pipeline.execute', {
      attributes: executionSpanAttributes(ctx),
    });

    try {
      MetricRecorder.recordRequest(ctx);

      for (const nodeId of pipeline.executionOrder) {
        const node = pipeline.nodes.find((n) => n.id === nodeId);
        if (!node) {
          throw new Error(`Executable node missing for id ${nodeId}`);
        }

        const nodeCtx = createObservationContext(identity, {
          ...input,
          nodeId: node.id,
          capabilityId: node.capabilityId,
        });

        const span = this.tracer.startSpan(`node.${node.id}`, {
          attributes: executionSpanAttributes(nodeCtx),
        });

        const start = performance.now();

        try {
          await this.executeNode(node, nodeCtx);

          const duration = performance.now() - start;
          MetricRecorder.recordNodeExecution(nodeCtx, duration, 'success');

          span.end();
        } catch (err) {
          const duration = performance.now() - start;
          MetricRecorder.recordNodeExecution(nodeCtx, duration, 'error');

          span.recordException(err as Error);
          span.end();
          throw err;
        }
      }
    } finally {
      rootSpan.end();
    }
  }

  /** Stub node runner — replace with capability dispatch in a later phase. */
  async executeNode(_node: ExecutableNode, _ctx: ObservationContext): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
