-- =============================================================
-- Round-3 hardening: DB-backed in-flight concurrency leases
-- (quota token/cost columns are ensured by migrate.ts for MySQL compatibility)
-- =============================================================

CREATE TABLE IF NOT EXISTS `ai_inflight_leases` (
  `lease_id`     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_type`   VARCHAR(30)     NOT NULL DEFAULT 'project',
  `scope_id`     VARCHAR(100)    NOT NULL,
  `request_id`   VARCHAR(64)     NOT NULL,
  `created_at`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   TIMESTAMP       NOT NULL,
  PRIMARY KEY (`lease_id`),
  UNIQUE KEY `uq_ai_inflight_request` (`request_id`),
  KEY `idx_ai_inflight_scope_expires` (`scope_type`, `scope_id`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
