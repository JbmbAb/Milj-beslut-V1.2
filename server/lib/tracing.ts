import { trace, type Span, SpanStatusCode } from '@opentelemetry/api';

type SpanLike = Pick<Span, 'setAttribute' | 'setAttributes' | 'recordException' | 'setStatus' | 'end'>;

export const tracer = trace.getTracer('legal-search');

export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: (span: SpanLike) => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, (span) => {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        span.setAttribute(key, value);
      }
    });
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        return result
          .catch((err) => {
            span.recordException(err);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          })
          .finally(() => span.end()) as T;
      }
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.end();
      throw err;
    }
  });
}
