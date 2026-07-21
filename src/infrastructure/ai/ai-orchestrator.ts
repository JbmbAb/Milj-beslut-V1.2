// src/infrastructure/ai/ai-orchestrator.ts

import { AiRequest, AiResponse, IAiOrchestrator } from '../../domain/ai/ai-module';
import { ILlmProvider } from './llm-provider';
import { IPolicyValidator } from './policy-validator';
import { IResponseValidator } from './response-validator';
import { recordLLMCall } from '../observability/metrics';
import { Logger } from '../observability/logger';
import crypto from 'node:crypto';

export class AiOrchestrator implements IAiOrchestrator {
  private logger = new Logger('AiOrchestrator');

  constructor(
    private provider: ILlmProvider,
    private policyValidator: IPolicyValidator,
    private responseValidator: IResponseValidator
  ) {}

  async execute(request: AiRequest): Promise<AiResponse> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const traceId = (request.payload?.traceId as string) || crypto.randomUUID();

    this.logger.info(`Exekverar AI-förfrågan för capability: ${request.capability}`, {
      requestId,
      traceId,
      capability: request.capability,
    });

    // 1. Policy Validator (Inkommande guardrails)
    const policyResult = this.policyValidator.validate(request.prompt, request.policies);
    if (!policyResult.valid) {
      this.logger.warn(`Inkommande prompt blockerad av Policy Validator för requestId: ${requestId}`, {
        reason: policyResult.reason,
      });

      return {
        success: false,
        narrative: policyResult.reason || 'Säkerhetsblockering: Prompten bröt mot gällande policys.',
        citations: [],
        confidence: 'low',
        warnings: ['Säkerhetsblockering: Prompten godkändes inte av Policy Validator.'],
        audit: {
          requestId,
          traceId,
          modelUsed: 'none',
        },
      };
    }

    // 2. Anropa LLM Provider
    const providerResult = await this.provider.generate(request);
    const durationMs = Date.now() - startTime;

    // Registrera mätvärden och telemetri om anropet lyckades
    if (providerResult.success && providerResult.tokenUsage) {
      recordLLMCall({
        model: providerResult.modelUsed,
        inputTokens: providerResult.tokenUsage.promptTokens,
        outputTokens: providerResult.tokenUsage.completionTokens,
        durationMs,
        success: providerResult.success,
      });
    }

    if (!providerResult.success) {
      this.logger.error(`LLM Provider misslyckades för requestId: ${requestId}`, {
        warnings: providerResult.warnings,
      });

      return {
        success: false,
        narrative: providerResult.narrative,
        citations: [],
        confidence: 'low',
        warnings: providerResult.warnings,
        audit: {
          requestId,
          traceId,
          modelUsed: providerResult.modelUsed,
        },
      };
    }

    // 3. Response Validator (Utgående guardrails)
    const responseValidation = await this.responseValidator.validate(providerResult);
    if (!responseValidation.valid) {
      this.logger.warn(`Utgående svar blockerat av Response Validator för requestId: ${requestId}`, {
        errors: responseValidation.errors,
      });

      return {
        success: false,
        narrative: `Säkerhetsblockering: Svaret från AI:n uppfyllde inte kvalitets- eller säkerhetskraven. Fel: ${responseValidation.errors.join(', ')}`,
        citations: [],
        confidence: 'low',
        warnings: [...responseValidation.warnings, ...responseValidation.errors],
        audit: {
          requestId,
          traceId,
          modelUsed: providerResult.modelUsed,
        },
      };
    }

    this.logger.info(`AI-förfrågan framgångsrikt orkestrerad på ${durationMs}ms`, {
      requestId,
      traceId,
    });

    // 4. Returnera slutgiltigt strukturerat och validerat svar
    return {
      success: true,
      narrative: providerResult.narrative,
      citations: responseValidation.validatedCitations,
      confidence: providerResult.confidence,
      structuredData: providerResult.structuredData,
      warnings: [...providerResult.warnings, ...responseValidation.warnings],
      audit: {
        requestId,
        traceId,
        modelUsed: providerResult.modelUsed,
      },
    };
  }
}
