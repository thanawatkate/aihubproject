-- =============================================================
-- Round-2 hardening: quota reservation + admin audit trail
-- =============================================================

CREATE TABLE IF NOT EXISTS `ai_quota_reservations` (
  `usage_month`       VARCHAR(7)      NOT NULL,
  `scope_type`        VARCHAR(30)     NOT NULL DEFAULT 'project',
  `scope_id`          VARCHAR(100)    NOT NULL DEFAULT '',
  `reserved_requests` INT UNSIGNED    NOT NULL DEFAULT 0,
  `reserved_tokens`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reserved_cost`     DECIMAL(14,8)   NOT NULL DEFAULT 0,
  `updated_at`        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`usage_month`, `scope_type`, `scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_admin_audit_log` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action`         VARCHAR(80)     NOT NULL,
  `resource_type`  VARCHAR(60)     NOT NULL,
  `resource_id`    VARCHAR(120)    NULL,
  `ip`             VARCHAR(64)     NULL,
  `user_agent`     VARCHAR(255)    NULL,
  `meta_json`      JSON            NULL,
  `created_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_admin_audit_created` (`created_at`),
  KEY `idx_ai_admin_audit_action` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
