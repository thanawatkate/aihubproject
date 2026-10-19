/** Split a migration file into statements. Comment lines are dropped first so a `;` inside a comment can't cut a statement. */
export function splitSqlStatements(sql: string): string[] {
  const body = sql
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('--');
    })
    .join('\n');
  return body
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}
