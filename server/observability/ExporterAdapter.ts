import { logger } from '../logger';

/**
 * Stub exporter — real OTLP SDK wiring comes later.
 * start() is safe to call at boot.
 */
export class ExporterAdapter {
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
      logger.warn(
        'OTel ExporterAdapter: OTEL_EXPORTER_OTLP_ENDPOINT saknas — metrics stannar i-process (noop SDK)',
      );
      return;
    }

    logger.info('OTel ExporterAdapter: endpoint konfigurerad (SDK export ej aktiverad ännu)', {
      endpoint,
    });
  }

  isStarted(): boolean {
    return this.started;
  }
}
