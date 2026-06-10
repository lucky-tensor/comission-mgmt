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
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  maxWidth: '860px',
  margin: '0 auto',
  padding: '2.5rem 1.5rem 4rem',
  fontFamily: 'system-ui, sans-serif',
  color: '#111827',
  lineHeight: 1.7,
};

const h1Style: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 800,
  color: '#111827',
  marginBottom: '0.25rem',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: '#6b7280',
  marginBottom: '2.5rem',
};

const h2Style: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  color: '#111827',
  marginTop: '2.5rem',
  marginBottom: '0.75rem',
  paddingBottom: '0.375rem',
  borderBottom: '1px solid #e5e7eb',
};

const h3Style: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#374151',
  marginTop: '1.25rem',
  marginBottom: '0.375rem',
};

const pStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: '#374151',
  marginBottom: '0.75rem',
};

const ulStyle: React.CSSProperties = {
  paddingLeft: '1.25rem',
  marginBottom: '0.75rem',
};

const liStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: '#374151',
  marginBottom: '0.25rem',
};

const termStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#111827',
};

const dtStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#111827',
  fontSize: '0.9375rem',
  marginTop: '0.75rem',
};

const ddStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: '#374151',
  marginLeft: '1rem',
  marginBottom: '0.25rem',
};

const noticeStyle: React.CSSProperties = {
  background: '#eff6ff',
  border: '1px solid #bfdbfe',
  borderRadius: '0.5rem',
  padding: '0.875rem 1.125rem',
  marginBottom: '1.5rem',
  fontSize: '0.875rem',
  color: '#1e40af',
};

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function CoreConceptsSection() {
  return (
    <>
      <h2 style={h2Style}>Core Concepts</h2>

      <h3 style={h3Style}>Placements</h3>
      <p style={pStyle}>
        A <span style={termStyle}>placement</span> is a filled job requisition — a candidate placed
        with a client by one or more producers. Each placement carries a fee amount (the gross
        revenue recognised when the invoice is paid) and a set of split attributions that divide
        credit among contributing producers.
      </p>

      <h3 style={h3Style}>Contributors</h3>
      <p style={pStyle}>
        <span style={termStyle}>Contributors</span> are the producers credited on a placement.
        Contributions are expressed as percentages that must sum to 100%. A producer can be a sole
        contributor or share credit with colleagues, including cross-team splits that require
        manager approval.
      </p>

      <h3 style={h3Style}>Commission Plans</h3>
      <p style={pStyle}>
        A <span style={termStyle}>commission plan</span> defines how a producer earns from their
        placements — typically a tiered percentage of billed fees, sometimes with a draw (guaranteed
        floor) that is recovered against future earnings. Plans are assigned per producer and must
        be formally acknowledged before taking effect.
      </p>

      <h3 style={h3Style}>Commission Runs</h3>
      <p style={pStyle}>
        A <span style={termStyle}>commission run</span> is the periodic batch calculation that
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
      <h2 style={h2Style}>Role Workflow Guides</h2>

      <h3 style={h3Style}>Finance Admin</h3>
      <p style={pStyle}>Finance Admins own the end-to-end commission cycle. Your workflow:</p>
      <ul style={ulStyle}>
        <li style={liStyle}>
          Review the <strong>Data Gap Queue</strong> to identify placements missing fee amounts,
          split attributions, or invoice details before running commissions.
        </li>
        <li style={liStyle}>
          Open <strong>Commission Run Review</strong> to inspect calculated payouts, approve the
          batch, or flag exceptions for manager or executive review.
        </li>
        <li style={liStyle}>
          Track invoice status in the <strong>Invoice &amp; Collection</strong> panel — mark
          invoices as paid to finalise producer earnings for the period.
        </li>
        <li style={liStyle}>
          Use <strong>Reconciliation</strong> to audit period-over-period variance and resolve
          discrepancies before closing the books.
        </li>
      </ul>

      <h3 style={h3Style}>Producer</h3>
      <p style={pStyle}>
        Producers use the <strong>My Portal</strong> to stay informed about their earnings:
      </p>
      <ul style={ulStyle}>
        <li style={liStyle}>View confirmed and pending placements attributed to you.</li>
        <li style={liStyle}>
          See your current commission plan, draw balance, and estimated payout for the open period.
        </li>
        <li style={liStyle}>
          Acknowledge a new commission plan when HR or Finance Admin assigns one — the plan is not
          active until acknowledged.
        </li>
        <li style={liStyle}>
          Raise a payout dispute directly from a placement row if the amount appears incorrect.
        </li>
      </ul>

      <h3 style={h3Style}>Manager</h3>
      <p style={pStyle}>Managers oversee their team&apos;s placement splits and commissions:</p>
      <ul style={ulStyle}>
        <li style={liStyle}>
          Approve or reject cross-team split requests in the <strong>Team View</strong> before they
          flow into a commission run.
        </li>
        <li style={liStyle}>
          Review attribution timelines to ensure credit is allocated correctly across billing
          periods.
        </li>
        <li style={liStyle}>
          Escalate tiebreaker disputes to Finance Admin when two teams claim overlapping credit.
        </li>
      </ul>

      <h3 style={h3Style}>Executive</h3>
      <p style={pStyle}>
        Executives monitor firm-wide financial health and provide final-tier dispute resolution:
      </p>
      <ul style={ulStyle}>
        <li style={liStyle}>
          The <strong>Executive Dashboard</strong> shows total fees billed, outstanding payables,
          and escalated disputes awaiting your approval.
        </li>
        <li style={liStyle}>
          <strong>Profitability Analytics</strong> breaks down margin by client, recruiter, team,
          and practice area.
        </li>
        <li style={liStyle}>
          <strong>Exception &amp; Dispute Trends</strong> surfaces recurring split or data-quality
          problems to guide process improvements.
        </li>
      </ul>

      <h3 style={h3Style}>HR / People Ops</h3>
      <p style={pStyle}>HR manages plan lifecycle and draw balances:</p>
      <ul style={ulStyle}>
        <li style={liStyle}>
          Assign commission plans to producers and monitor acknowledgment status — unacknowledged
          plans cannot be activated.
        </li>
        <li style={liStyle}>
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
      <h2 style={h2Style}>Partner Guide</h2>
      <p style={pStyle}>
        As an External Partner you have a read-only view of the placements and payout amounts that
        relate to your partnership agreement.
      </p>
      <ul style={ulStyle}>
        <li style={liStyle}>
          Open <strong>My Placements</strong> to see every placement where your firm is a credited
          contributor, along with the associated fee split and current invoice status.
        </li>
        <li style={liStyle}>
          Payout amounts shown are subject to invoice collection — amounts marked{' '}
          <em>Pending Invoice</em> will update once the client pays.
        </li>
        <li style={liStyle}>
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
      <h2 style={h2Style}>Glossary</h2>
      <dl>
        <dt style={dtStyle}>Attribution</dt>
        <dd style={ddStyle}>
          The percentage of a placement fee credited to a specific producer or partner.
        </dd>

        <dt style={dtStyle}>Billing Period</dt>
        <dd style={ddStyle}>
          The calendar interval (typically monthly or quarterly) over which placements are
          aggregated for a commission run.
        </dd>

        <dt style={dtStyle}>Commission Plan</dt>
        <dd style={ddStyle}>
          The contractual schedule defining how a producer&apos;s earnings are calculated from their
          placement fees, including tier thresholds and draw terms.
        </dd>

        <dt style={dtStyle}>Commission Run</dt>
        <dd style={ddStyle}>
          The batch calculation that produces payout amounts for all producers in a given billing
          period.
        </dd>

        <dt style={dtStyle}>Contributor</dt>
        <dd style={ddStyle}>
          A producer or partner credited with a percentage of a placement fee.
        </dd>

        <dt style={dtStyle}>Data Gap</dt>
        <dd style={ddStyle}>
          A placement record that is missing one or more required fields (fee amount, split
          attributions, or invoice reference) that must be resolved before a commission run can
          proceed.
        </dd>

        <dt style={dtStyle}>Draw</dt>
        <dd style={ddStyle}>
          A guaranteed minimum advance paid to a producer ahead of earned commissions. Draw balances
          are recovered from future commission earnings.
        </dd>

        <dt style={dtStyle}>Exception</dt>
        <dd style={ddStyle}>
          A commission line item flagged for review because it falls outside expected parameters
          (e.g. unusually high fee, missing approval).
        </dd>

        <dt style={dtStyle}>Placement</dt>
        <dd style={ddStyle}>
          A successfully filled job requisition that generates a billable fee.
        </dd>

        <dt style={dtStyle}>Reconciliation</dt>
        <dd style={ddStyle}>
          The process of comparing commission run outputs against source placement and invoice data
          to confirm accuracy before closing a billing period.
        </dd>

        <dt style={dtStyle}>Split</dt>
        <dd style={ddStyle}>
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
    <div style={pageStyle} data-testid="docs-view">
      <h1 style={h1Style}>Documentation</h1>
      <p style={subtitleStyle}>User guides and reference material for Commission Mgmt.</p>

      {!isInternal && (
        <div style={noticeStyle} data-testid="docs-partner-notice">
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
