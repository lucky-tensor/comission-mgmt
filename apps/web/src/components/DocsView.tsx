/**
 * DocsView — in-app documentation viewer.
 *
 * Renders user-facing documentation for every authenticated role.
 * ExternalPartner sees only the Partner Guide and Glossary sections.
 * All internal roles (Producer, FinanceAdmin, Manager, Executive, HR)
 * see the full documentation.
 *
 * No external markdown dependency is used; content is inline JSX.
 *
 * Issue: feat: webapp — inclusive product documentation accessible to all
 *        roles (#197)
 */

import type { AppRole } from 'core/auth';

interface DocsViewProps {
  role: AppRole;
}

// ---------------------------------------------------------------------------
// Styles — Tailwind class strings (theme tokens, no raw hex)
// ---------------------------------------------------------------------------

const pageClass = 'max-w-docs mx-auto px-6 pt-10 pb-16 text-ink leading-normal';

const h1Class = 'text-2xl font-extrabold text-ink mb-1';

const subtitleClass = 'text-base text-ink-subtle mb-10';

const h2Class = 'text-xl font-bold text-ink mt-10 mb-3 pb-1.5 border-b border-border';

const h3Class = 'text-base font-bold text-ink-muted mt-5 mb-1.5';

const pClass = 'text-base text-ink-muted mb-3';

const ulClass = 'pl-5 mb-3';

const liClass = 'text-base text-ink-muted mb-1';

const termClass = 'font-semibold text-ink';

const dtClass = 'font-bold text-ink text-base mt-3';

const ddClass = 'text-base text-ink-muted ml-4 mb-1';

const noticeClass =
  'bg-surface-sunken border border-border rounded-lg px-5 py-3.5 mb-6 text-sm text-ink-muted';

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function CoreConceptsSection() {
  return (
    <>
      <h2 className={h2Class}>Core Concepts</h2>

      <h3 className={h3Class}>Placements</h3>
      <p className={pClass}>
        A <span className={termClass}>placement</span> is a filled job requisition — a candidate
        placed with a client by one or more producers. Each placement carries a fee amount (the
        gross revenue recognised when the invoice is paid) and a set of split attributions that
        divide credit among contributing producers.
      </p>

      <h3 className={h3Class}>Contributors</h3>
      <p className={pClass}>
        <span className={termClass}>Contributors</span> are the producers credited on a placement.
        Contributions are expressed as percentages that must sum to 100%. A producer can be a sole
        contributor or share credit with colleagues, including cross-team splits that require
        manager approval.
      </p>

      <h3 className={h3Class}>Commission Plans</h3>
      <p className={pClass}>
        A <span className={termClass}>commission plan</span> defines how a producer earns from their
        placements — typically a tiered percentage of billed fees, sometimes with a draw (guaranteed
        floor) that is recovered against future earnings. Plans are assigned per producer and must
        be formally acknowledged before taking effect.
      </p>

      <h3 className={h3Class}>Commission Runs</h3>
      <p className={pClass}>
        A <span className={termClass}>commission run</span> is the periodic batch calculation that
        applies each producer&apos;s plan to the confirmed placements in a billing period, producing
        a payout figure. Finance Admin reviews each run for data completeness, approves the batch,
        and issues invoices. Disputed amounts can be escalated through the approval workflow.
      </p>
    </>
  );
}

function RoleGuidesSection() {
  return (
    <>
      <h2 className={h2Class}>Role Workflow Guides</h2>

      <h3 className={h3Class}>Finance Admin</h3>
      <p className={pClass}>Finance Admins own the end-to-end commission cycle. Your workflow:</p>
      <ul className={ulClass}>
        <li className={liClass}>
          Review the <strong>Data Gap Queue</strong> to identify placements missing fee amounts,
          split attributions, or invoice details before running commissions.
        </li>
        <li className={liClass}>
          Open <strong>Commission Run Review</strong> to inspect calculated payouts, approve the
          batch, or flag exceptions for manager or executive review.
        </li>
        <li className={liClass}>
          Track invoice status in the <strong>Invoice &amp; Collection</strong> panel — mark
          invoices as paid to finalise producer earnings for the period.
        </li>
        <li className={liClass}>
          Use <strong>Reconciliation</strong> to audit period-over-period variance and resolve
          discrepancies before closing the books.
        </li>
      </ul>

      <h3 className={h3Class}>Producer</h3>
      <p className={pClass}>
        Producers use the <strong>My Portal</strong> to stay informed about their earnings:
      </p>
      <ul className={ulClass}>
        <li className={liClass}>View confirmed and pending placements attributed to you.</li>
        <li className={liClass}>
          See your current commission plan, draw balance, and estimated payout for the open period.
        </li>
        <li className={liClass}>
          Acknowledge a new commission plan when HR or Finance Admin assigns one — the plan is not
          active until acknowledged.
        </li>
        <li className={liClass}>
          Raise a payout dispute directly from a placement row if the amount appears incorrect.
        </li>
      </ul>

      <h3 className={h3Class}>Manager</h3>
      <p className={pClass}>Managers oversee their team&apos;s placement splits and commissions:</p>
      <ul className={ulClass}>
        <li className={liClass}>
          Approve or reject cross-team split requests in the <strong>Team View</strong> before they
          flow into a commission run.
        </li>
        <li className={liClass}>
          Review attribution timelines to ensure credit is allocated correctly across billing
          periods.
        </li>
        <li className={liClass}>
          Escalate tiebreaker disputes to Finance Admin when two teams claim overlapping credit.
        </li>
      </ul>

      <h3 className={h3Class}>Executive</h3>
      <p className={pClass}>
        Executives monitor firm-wide financial health and provide final-tier dispute resolution:
      </p>
      <ul className={ulClass}>
        <li className={liClass}>
          The <strong>Executive Dashboard</strong> shows total fees billed, outstanding payables,
          and escalated disputes awaiting your approval.
        </li>
        <li className={liClass}>
          <strong>Profitability Analytics</strong> breaks down margin by client, recruiter, team,
          and practice area.
        </li>
        <li className={liClass}>
          <strong>Exception &amp; Dispute Trends</strong> surfaces recurring split or data-quality
          problems to guide process improvements.
        </li>
      </ul>

      <h3 className={h3Class}>HR / People Ops</h3>
      <p className={pClass}>HR manages plan lifecycle and draw balances:</p>
      <ul className={ulClass}>
        <li className={liClass}>
          Assign commission plans to producers and monitor acknowledgment status — unacknowledged
          plans cannot be activated.
        </li>
        <li className={liClass}>
          View draw balances and recovery schedules to ensure producers repay advances on the agreed
          timeline.
        </li>
      </ul>
    </>
  );
}

function PartnerGuideSection() {
  return (
    <>
      <h2 className={h2Class}>Partner Guide</h2>
      <p className={pClass}>
        As an External Partner you have a read-only view of the placements and payout amounts that
        relate to your partnership agreement.
      </p>
      <ul className={ulClass}>
        <li className={liClass}>
          Open <strong>My Placements</strong> to see every placement where your firm is a credited
          contributor, along with the associated fee split and current invoice status.
        </li>
        <li className={liClass}>
          Payout amounts shown are subject to invoice collection — amounts marked{' '}
          <em>Pending Invoice</em> will update once the client pays.
        </li>
        <li className={liClass}>
          If you believe a placement amount or split percentage is incorrect, contact your
          Commission Mgmt account manager to raise a dispute on your behalf.
        </li>
      </ul>
    </>
  );
}

function GlossarySection() {
  return (
    <>
      <h2 className={h2Class}>Glossary</h2>
      <dl>
        <dt className={dtClass}>Attribution</dt>
        <dd className={ddClass}>
          The percentage of a placement fee credited to a specific producer or partner.
        </dd>

        <dt className={dtClass}>Billing Period</dt>
        <dd className={ddClass}>
          The calendar interval (typically monthly or quarterly) over which placements are
          aggregated for a commission run.
        </dd>

        <dt className={dtClass}>Commission Plan</dt>
        <dd className={ddClass}>
          The contractual schedule defining how a producer&apos;s earnings are calculated from their
          placement fees, including tier thresholds and draw terms.
        </dd>

        <dt className={dtClass}>Commission Run</dt>
        <dd className={ddClass}>
          The batch calculation that produces payout amounts for all producers in a given billing
          period.
        </dd>

        <dt className={dtClass}>Contributor</dt>
        <dd className={ddClass}>
          A producer or partner credited with a percentage of a placement fee.
        </dd>

        <dt className={dtClass}>Data Gap</dt>
        <dd className={ddClass}>
          A placement record that is missing one or more required fields (fee amount, split
          attributions, or invoice reference) that must be resolved before a commission run can
          proceed.
        </dd>

        <dt className={dtClass}>Draw</dt>
        <dd className={ddClass}>
          A guaranteed minimum advance paid to a producer ahead of earned commissions. Draw balances
          are recovered from future commission earnings.
        </dd>

        <dt className={dtClass}>Exception</dt>
        <dd className={ddClass}>
          A commission line item flagged for review because it falls outside expected parameters
          (e.g. unusually high fee, missing approval).
        </dd>

        <dt className={dtClass}>Placement</dt>
        <dd className={ddClass}>
          A successfully filled job requisition that generates a billable fee.
        </dd>

        <dt className={dtClass}>Reconciliation</dt>
        <dd className={ddClass}>
          The process of comparing commission run outputs against source placement and invoice data
          to confirm accuracy before closing a billing period.
        </dd>

        <dt className={dtClass}>Split</dt>
        <dd className={ddClass}>
          A placement where fee credit is divided among two or more contributors. Cross-team splits
          require manager approval.
        </dd>
      </dl>
    </>
  );
}

// ---------------------------------------------------------------------------
// DocsView
// ---------------------------------------------------------------------------

const INTERNAL_ROLES: ReadonlySet<AppRole> = new Set([
  'Producer',
  'FinanceAdmin',
  'Manager',
  'Executive',
  'HR',
]);

export function DocsView({ role }: DocsViewProps) {
  const isInternal = INTERNAL_ROLES.has(role);

  return (
    <div className={pageClass} data-testid="docs-view">
      <h1 className={h1Class}>Documentation</h1>
      <p className={subtitleClass}>User guides and reference material for Commission Mgmt.</p>

      {!isInternal && (
        <div className={noticeClass} data-testid="docs-partner-notice">
          You are viewing the partner documentation. For questions about your placements or payout,
          contact your account manager.
        </div>
      )}

      {isInternal && (
        <>
          <CoreConceptsSection />
          <RoleGuidesSection />
        </>
      )}

      <PartnerGuideSection />
      <GlossarySection />
    </div>
  );
}
