import type { Pool, RowDataPacket } from 'mysql2/promise';

export interface AdminAuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

export class AdminAuditService {
  constructor(private readonly db: Pool) {}

  async record(entry: AdminAuditEntry): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO ai_admin_audit_log
           (action, resource_type, resource_id, ip, user_agent, meta_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          entry.action.slice(0, 80),
          entry.resourceType.slice(0, 60),
          entry.resourceId?.slice(0, 120) ?? null,
          entry.ip?.slice(0, 64) ?? null,
          entry.userAgent?.slice(0, 255) ?? null,
          entry.meta ? JSON.stringify(entry.meta) : null,
        ],
      );
    } catch (err) {
      console.error('[AdminAuditService] record failed:', (err as Error).message);
    }
  }

  async list(opts: {
    page: number;
    limit: number;
    action?: string;
  }): Promise<{ items: RowDataPacket[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page);
    const limit = Math.min(100, Math.max(1, opts.limit));
    const offset = (page - 1) * limit;

    let rows: RowDataPacket[];
    let total: number;

    if (opts.action) {
      const action = opts.action.slice(0, 80);
      const [items] = await this.db.execute<RowDataPacket[]>(
        `SELECT id, action, resource_type, resource_id, ip, user_agent, meta_json, created_at
         FROM ai_admin_audit_log
         WHERE action = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [action, limit, offset],
      );
      const [countRows] = await this.db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM ai_admin_audit_log WHERE action = ?`,
        [action],
      );
      rows = items;
      total = Number(countRows[0]?.['total'] ?? 0);
    } else {
      const [items] = await this.db.execute<RowDataPacket[]>(
        `SELECT id, action, resource_type, resource_id, ip, user_agent, meta_json, created_at
         FROM ai_admin_audit_log
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );
      const [countRows] = await this.db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM ai_admin_audit_log`,
      );
      rows = items;
      total = Number(countRows[0]?.['total'] ?? 0);
    }

    return { items: rows, total, page, limit };
  }

  async purgeOlderThanDays(days: number): Promise<number> {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(days)));
    const [result] = await this.db.execute(
      `DELETE FROM ai_admin_audit_log
       WHERE created_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)`,
      [safeDays],
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  }
}
