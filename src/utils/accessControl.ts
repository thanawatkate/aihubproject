import type { Project } from '../types/index.js';

/**
 * null allowedFeatures = all features allowed.
 * Non-null = allowlist of feature labels (e.g. text_generate, image_generate).
 */
export function assertFeatureAllowed(project: Project, feature: string): void {
  const allowed = project.allowedFeatures;
  if (allowed === null) return;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw Object.assign(new Error('Project has no allowed features'), {
      statusCode: 403,
      code: 'FEATURE_FORBIDDEN',
    });
  }
  if (!allowed.includes(feature)) {
    throw Object.assign(new Error(`Feature "${feature}" is not allowed for this project`), {
      statusCode: 403,
      code: 'FEATURE_FORBIDDEN',
    });
  }
}

export function publicErrorMessage(err: unknown, fallback: string): string {
  if (process.env.NODE_ENV === 'production') {
    return fallback;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
