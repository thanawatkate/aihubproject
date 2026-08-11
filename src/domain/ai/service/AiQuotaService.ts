import type { AiUsageRepository } from '../repository/AiUsageRepository.js';
import type { QuotaStatus } from '../../../types/index.js';
import { env } from '../../../config/env.js';
import { estimateQuotaHold, type QuotaHoldKind } from '../../../utils/quotaHoldEstimate.js';

export class AiQuotaExceededException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiQuotaExceededException';
  }
}

export interface QuotaReservationHandle {
  status: QuotaStatus;
  reserved: boolean;
  month: string;
  reservedRequests: number;
  reservedTokens: number;
  reservedCost: number;
}

export interface ReserveRequestOptions {
  kind?: QuotaHoldKind;
  textChars?: number;
  /** Explicit overrides (tests / callers with better estimates) */
  reserveTokens?: number;
  reserveCost?: number;
}

export class AiQuotaService {
  constructor(private readonly repo: AiUsageRepository) {}

  /** Soft pre-check (tokens/cost + non-atomic requests). Prefer reserveRequest for generate paths. */
  async assertCanStartRequest(projectKey: string, month?: string): Promise<QuotaStatus> {
    const status = await this.getStatus(projectKey, month);
    if (!status.package.hardLimitEnabled) return status;

    for (const [metric, limit] of Object.entries(status.limits)) {
      if (limit === null) continue;
      const current = status.usage[metric as keyof typeof status.usage] ?? 0;
      if (current >= limit) {
        throw new AiQuotaExceededException(`AI quota exceeded for ${metric}`);
      }
    }
    return status;
  }

  /**
   * Atomically reserve request + estimated token/cost holds.
   * Always call releaseRequestReservation(handle) in finally.
   */
  async reserveRequest(
    projectKey: string,
    options: ReserveRequestOptions = {},
  ): Promise<QuotaReservationHandle> {
    const status = await this.getStatus(projectKey);
    const empty: QuotaReservationHandle = {
      status,
      reserved: false,
      month: status.month,
      reservedRequests: 0,
      reservedTokens: 0,
      reservedCost: 0,
    };

    if (!status.package.hardLimitEnabled) {
      return empty;
    }

    const requestLimit = status.limits.requestsCount;
    const tokenLimit = status.limits.totalTokens;
    const costLimit = status.limits.estimatedCost;

    if (requestLimit === null && tokenLimit === null && costLimit === null) {
      return empty;
    }

    const hold = estimateQuotaHold(options.kind ?? 'text', options.textChars ?? 0, {
      safetyMult: env.QUOTA_RESERVE_SAFETY_MULT,
      maxTokens: env.QUOTA_RESERVE_TOKENS_PER_REQUEST,
      maxCost: env.QUOTA_RESERVE_COST_PER_REQUEST,
      outputTokensDefault: env.QUOTA_RESERVE_OUTPUT_TOKENS_DEFAULT,
      usdPer1k: env.QUOTA_RESERVE_USD_PER_1K_TOKENS,
    });
    const reserveTokens = tokenLimit === null
      ? 0
      : (options.reserveTokens ?? hold.tokens);
    const reserveCost = costLimit === null
      ? 0
      : (options.reserveCost ?? hold.cost);
    const reserveRequests = requestLimit === null ? 0 : 1;

    const ok = await this.repo.tryReserveQuota({
      month: status.month,
      scopeType: 'project',
      scopeId: projectKey,
      requestLimit,
      tokenLimit,
      costLimit,
      reserveTokens,
      reserveCost,
    });

    if (!ok) {
      throw new AiQuotaExceededException('AI quota exceeded (request/token/cost reservation)');
    }

    return {
      status,
      reserved: true,
      month: status.month,
      reservedRequests: reserveRequests,
      reservedTokens: reserveTokens,
      reservedCost: reserveCost,
    };
  }

  async releaseRequestReservation(
    projectKey: string,
    handle: Pick<QuotaReservationHandle, 'month' | 'reserved' | 'reservedRequests' | 'reservedTokens' | 'reservedCost'>,
  ): Promise<void> {
    if (!handle.reserved) return;
    try {
      await this.repo.releaseQuotaReservation({
        month: handle.month,
        scopeType: 'project',
        scopeId: projectKey,
        reservedRequests: handle.reservedRequests,
        reservedTokens: handle.reservedTokens,
        reservedCost: handle.reservedCost,
      });
    } catch (err) {
      console.error('[AiQuotaService] releaseQuotaReservation failed:', (err as Error).message);
    }
  }

  async getStatus(projectKey: string, month?: string): Promise<QuotaStatus> {
    const m      = month ?? new Date().toISOString().slice(0, 7);
    // Try project-scoped package first, fall back to global
    let pkg = await this.repo.getCurrentPackage('project', projectKey);
    if (pkg.packageKey === 'global_default') {
      pkg = await this.repo.getCurrentPackage('global', '');
    }
    const usage  = await this.repo.getMonthlyUsage(m, 'project', projectKey);
    const limits = {
      requestsCount: pkg.requestLimitMonthly,
      totalTokens:   pkg.tokenLimitMonthly,
      estimatedCost: pkg.costLimitMonthly,
    };
    const percentages = {
      requestsCount: this.pct(usage.requestsCount, limits.requestsCount),
      totalTokens:   this.pct(usage.totalTokens,   limits.totalTokens),
      estimatedCost: this.pct(usage.estimatedCost, limits.estimatedCost),
    };
    return { month: m, package: pkg, usage, limits, percentages };
  }

  private pct(current: number, limit: number | null): number {
    if (limit === null || limit <= 0) return 0;
    return Math.round((current / limit) * 10000) / 100;
  }
}
