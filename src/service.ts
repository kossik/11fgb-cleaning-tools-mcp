import type { AppConfig } from "./config.js";
import { calculatorDefinitions, type CalculatorId } from "./calculators/index.js";
import { loadRates } from "./rates.js";
import { openReport, sealReport } from "./security/reportToken.js";
import type { CalculationResult } from "./types.js";

export class CalculationService {
  constructor(private readonly config: AppConfig) {}

  private async core(calculator: CalculatorId, rawInput: unknown) {
    const definition = calculatorDefinitions[calculator];
    const input = definition.schema.parse(rawInput) as Record<string, unknown>;
    const rates = await loadRates(this.config.calculatorDataUrl, this.config.calculatorDataToken);
    const result = definition.calculate(input, rates);
    return { input, result };
  }

  private withLinks(calculator: CalculatorId, result: CalculationResult, token: string, expiresAt: string): CalculationResult {
    const definition = calculatorDefinitions[calculator];
    const reportUrl = `${this.config.publicSiteUrl}/tools/${definition.slug}/r/${encodeURIComponent(token)}`;
    const ctaBase = calculator === "office-cleaning-cost" ? "/book?service=office-cleaning" : "/book?service=house-cleaning";
    return {
      ...result,
      visualization_url: reportUrl,
      methodology_url: `${this.config.publicSiteUrl}/developers/mcp/methodology#${calculator}`,
      cta_url: `${this.config.publicSiteUrl}${ctaBase}&estimate=${encodeURIComponent(token)}`,
      expires_at: expiresAt,
    };
  }

  async calculate(calculator: CalculatorId, rawInput: unknown): Promise<CalculationResult> {
    const { input, result } = await this.core(calculator, rawInput);
    const { token, expiresAt } = sealReport(this.config.reportTokenKey, {
      calculator,
      input,
      methodology_version: result.methodology_version,
    });
    return this.withLinks(calculator, result, token, expiresAt);
  }

  async fromToken(token: string): Promise<CalculationResult> {
    const payload = openReport(this.config.reportTokenKey, token);
    const { result } = await this.core(payload.calculator, payload.input);
    if (result.methodology_version !== payload.methodology_version) {
      result.warnings = [
        ...result.warnings,
        `This report was created with methodology ${payload.methodology_version} and has been recalculated with ${result.methodology_version}.`,
      ];
    }
    return this.withLinks(payload.calculator, result, token, new Date(payload.exp * 1000).toISOString());
  }
}
