/**
 * Demo seed step 10 — Commission Run.
 *
 * NOTE: The commission_runs table is not yet present in schema.sql (it is scoped
 * to a future Phase 2 issue). This step logs a placeholder so the orchestrator
 * can tick the checklist item once the table is added.
 *
 * When commission_runs is added to schema.sql, implement the insert here:
 *   - 1 CommissionRun in Approved state covering 4 placements
 *   - 1 linked payroll export CSV artifact record
 */

export async function seedDemoCommissionRun(): Promise<void> {
  // TODO(Phase 2): insert commission_runs + payroll_export_artifacts rows
  // once the commission_runs table is added to schema.sql.
  console.log(
    '[demo-seed] Step 10: commission_runs table not yet in schema — skipping (Phase 2 scope).',
  );
}
