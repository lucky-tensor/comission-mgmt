# Sesame Tool — Discovery & Audit Documentation

Source: `Documentation of Sesame tool 4-2-24.xlsx` (April 2, 2024)
Context: This document was produced during a ~2 year old rebuild discovery sprint. It contains field-by-field analysis of Sesame across its main screens, with decisions on what to keep, cross-references to Thrive TRM and Invoice Request Form fields, and operational comments from the person who uses the system day-to-day.

The spreadsheet contains 10 sheets. Substantive content is in: Sesame Application - Add, Retainer, Delivery, OfferClose, List Maintenance, Checker Reporting, and Fields from Sesame. The Function Key and Instructions sheets contain methodology notes; the Sesame Main Screen sheet is empty (likely held a screenshot).

Column schema used across field sheets:
`# | Field | Description | Purpose | Data use | How used | Calculated/Static | Required/Optional | Keep? | Retain in new tool | Req vs Opt | Invoice Form Field | Thrive Field | Comments`

---

## Sheet: Sesame Application - Add

Main job record screen. Title: "Sesame Application for Retainer / Delivery Documentation."

| # | Field | Description | Calculated/Static | Keep in new tool? | Req/Opt | Invoice Form | Thrive | Comments |
|---|---|---|---|---|---|---|---|---|
| 1 | Prev Record | Navigation — previous record | ? | yes | required | No | No | |
| 2 | Save Exit | Save and exit | — | yes | required | No | No | |
| 3 | Save | Save only | — | optional | optional | No | No | |
| 4 | Search | Search tool | — | yes | required | No | No | |
| 5 | Print Form | Print form | — | yes | required | No | No | Never used, but good to keep |
| 6 | Next Record | Navigation — next record | — | yes | required | No | No | |
| 7 | Gotten By | Individual who won the business | — | yes | required | No | Yes | |
| 8 | Gotten By - Practice | Practice that won the business | — | yes | required | No | Yes | |
| 9 | Individual | Executing individual | — | yes | required | Yes | Yes | *Not always complete |
| 10 | Practice | Executing practice | — | yes | required | No | Yes | |
| 11 | New/Core | New or core client | — | yes | required | Yes | Yes | *Not always complete; often found in QB |
| 12 | DG - Day gotten | Day search entered into system | — | yes | required | No | No | |
| 13 | DC - Day close | Search close date | — | yes | required | No | Yes | |
| 14 | SD - Start date | Candidate start date | — | yes | required | No | Yes | A good record to enter |
| 15 | Category - TECH or MFG | Identify if practice is TECH or MFG | — | no | not required | No | No | *Based on Practices in Thrive |
| 16 | CIE - Core industry experience | Not sure what this is used for | — | no | not required | No | No | |
| 17 | Type | Not sure what this is used for | — | no | not required | No | No | |
| 18 | EM - End market | Not sure what this is used for | — | no | not required | No | No | |
| 19 | CJF - Core job function | Core job function | — | optional | optional | No | Yes | *Job Title — believed to be a duplication |
| 20 | Level | Position level of the search | — | optional | optional | No | Yes | |
| 21 | Company Name | Client company name | — | — | — | Yes | Yes | "I usually use this field to add the parent/child companies together, and we should have a separate field for each." |
| 22 | Revenue | Client company revenue | — | no | not required | No | No | |
| 23 | LOS - Level of Service | To identify this is a search | — | optional | optional | No | No | Drop-down has other values but only "search" is used |
| 24 | Position Title | Position title for search | — | yes | required | No | Yes | |
| 25 | Status - Active/Closed/Inactive | Search status | — | yes | required | No | Yes | |
| 26 | Hiring Manager | Client contact | — | yes | required | No | Yes | "We need to add more fields for extra contacts." |
| 27 | Job Code | Job code for the search | — | yes | required | Yes | Yes | "We need to be consistent with the individual user and develop a different user id." |
| 28 | Confidential | Whether search is standard or confidential | — | yes | required | Yes | Yes | *Based on Invoice Verbiage field on request |
| 29 | Primary PE/VC | Sponsor | — | yes | required | No | Yes | "Usually I use this field to add important info taken from the agreement. Usually email address for contact." |
| 30 | Contact | Sponsor contact | — | yes | required | No | No | "Usually I use this field to add important info taken from the agreement." |
| 31 | AGRMT | Is agreement on file? | — | no | not required | No | No | |
| 32 | Secondary PE/VC | Secondary sponsor | — | yes | required | No | No | "Usually I use this field to add important info taken from the agreement." |
| 33 | Contact | Secondary sponsor contact | — | yes | required | No | No | "Usually I use this field to add important info taken from the agreement." |
| 34 | TOS - Terms of Search | Identifies process of search | — | yes | required | No | Yes | Values: Retained / Marketed / Contingent / BackFill. *Placement type in Thrive |
| 35 | IRS - Initial recruiting stage | N/A | — | no | not required | No | No | |
| 36 | CS - Candidate stage | N/A | — | no | not required | No | No | |
| 37 | IS - Interview stage | N/A | — | no | not required | No | No | |
| 38 | OS - Offer stage | N/A | — | no | not required | No | No | |
| 39 | FS - Fee Structure | Essential to identify the search rate fee | — | yes | required | No | Yes | Values: 1/3 / 30% / 31.5% / Flat |
| 40 | PS | N/A | — | no | not required | No | No | |
| 41 | State | Job location state | — | yes | required | Yes | Yes | *Fields in both systems but "we often chase this information" |
| 42 | Projected Close | Projected days until close | — | optional | optional | No | No | Only value used is 90 days despite other options in drop-down |
| 43 | Orig1 - First originator | Gotten-by or orig individual initials | — | yes | required | Yes | Yes | |
| 44 | Orig1% - First originator percentage | Gotten-by or orig individual percentage | — | yes | required | Yes | Yes | |
| 45 | Orig2 - Second originator | | — | yes | required | Yes | Yes | |
| 46 | Orig2% - Second originator percentage | | — | yes | required | Yes | Yes | |
| 47 | Orig3 - Third originator | | — | yes | required | Yes | Yes | |
| 48 | Orig3% - Third originator percentage | | — | yes | required | Yes | Yes | |
| 49 | Convrt1 - First converter | Converter individual initials | — | yes | required | Yes | Yes | |
| 50 | Convrt1% - First converter percentage | | — | yes | required | Yes | Yes | |
| 51 | Convrt2 - Second converter | | — | yes | required | Yes | Yes | |
| 52 | Convrt2% - Second converter percentage | | — | yes | required | Yes | Yes | |
| 53 | Convrt3 - Third converter | | — | yes | required | Yes | Yes | |
| 54 | Convrt3% - Third converter percentage | | — | yes | required | Yes | Yes | |
| 55 | Projected (Retainer/Delivery) | Projected retainer / delivery / totals | — | yes | required | No | No | "We calculate based on the search fee and comp plan" |
| 56 | Billed (R/D) | Billed retainer / delivery / totals | — | yes | required | No | No | |
| 57 | BillDate (R/D) | Bill date for retainer / delivery | — | yes | required | No | No | |
| 58 | Received (R/D) | Received retainer / delivery / totals | — | yes | required | No | No | |
| 59 | RecDate (R/D) | Received date for retainer / delivery | — | yes | required | No | No | |
| 60 | Actual | Actual retainer / delivery amount | — | no | not required | No | No | N/A |
| 61 | Recalc Retner & deliv | Recalculate changes and adjustments | — | optional | optional | No | No | "It is a good tool if it works!" |
| 62 | Tot ActRetPerc | Calculate the percentage of the search fee | — | yes | required | No | No | |
| 63 | LastUpdate | Audit trail | — | yes | required | No | No | "We need an improvement system for perfect auditing that shows who/what was changed/when" |

---

## Sheet: Retainer

Per-contributor retainer processing tab.

| # | Field | Description | Keep in new tool? | Req/Opt | Invoice Form | Thrive | Comments |
|---|---|---|---|---|---|---|---|
| 1 | Add/Edit/Del | Drop-down: add, edit, or delete a retainer line | yes | required | no | no | |
| 2 | Label | Originator or converter — identifies the role of this line | yes | required | Yes | Yes | |
| 3 | Cnslt | Initials of the individual collecting the origination or conversion | yes | required | Yes | Yes | |
| 4 | BRD | Billed retainer dollars — individual's revenue amount | yes | required | yes | no | |
| 5 | BRD Date | Date invoice was processed | yes | required | no | no | |
| 6 | Ret % | Percentage for this individual | yes | required | no | no | |
| 7 | ORet % | Origination retainer percentage | no | not required | no | no | N/A |
| 8 | CRet % | Conversion retainer percentage | no | not required | no | no | N/A |
| 9 | Count Credit | Unknown use | no | not required | no | no | |
| 10 | PRD | Paid retainer dollars | yes | required | no | no | |
| 11 | RRD | Received retainer dollars | yes | required | no | no | |
| 12 | RRD Date | Received retainer date | yes | required | Yes | Yes | |
| 13 | ARD | N/A | no | not required | Yes | Yes | |

---

## Sheet: Delivery

Per-contributor delivery processing tab.

| # | Field | Description | Keep in new tool? | Req/Opt | Invoice Form | Thrive | Comments |
|---|---|---|---|---|---|---|---|
| 1 | Add/Edit/Del | Drop-down: add, edit, or delete a delivery line | yes | required | no | no | |
| 2 | Label | Identifies the individual as a DELCON | yes | required | Yes | Yes | |
| 3 | Cnslt | Initials of the individual collecting the delivery | yes | required | Yes | Yes | |
| 4 | BDD | Billed delivery dollars — individual's revenue amount | yes | required | yes | no | |
| 5 | BDD Date | Date invoice was processed | yes | required | no | no | |
| 6 | Del % | Percentage for this individual | yes | required | no | no | |
| 7 | PDD | Paid delivery dollars | yes | required | no | no | |
| 8 | RDD | Received delivery dollars | yes | required | no | no | |
| 9 | RDD Date | Received delivery date | yes | required | no | no | |
| 10 | ADD | N/A | no | not required | no | no | |

---

## Sheet: OfferClose

Only one field was assessed as worth keeping.

| # | Field | Description | Keep in new tool? | Req/Opt | Invoice Form | Thrive | Comments |
|---|---|---|---|---|---|---|---|
| 1 | CloseInits | Delivery individual's initials to receive closing credit | yes | required | no | Yes | |

---

## Sheet: List Maintenance

Employee/consultant master list — the registry of individuals who can be assigned to searches.

| # | Field | Description | Keep in new tool? | Comments |
|---|---|---|---|---|
| 1 | List Maintenance | Search/add employee function | yes | |
| 2 | Add Data | Add a new individual | yes | |
| 3 | Type | Type of record (e.g., employee) | yes | |
| 4 | CODE | Individual's initials — used as their system identifier | yes | "Recommend using three initials for the new system because multi-employee has the same initials." |
| 5 | Description | Full name of the employee | yes | |
| 6 | CODELU | Initials combined with identifying name | yes | |
| 7 | Practice | The individual's practice | yes | |

---

## Sheet: Checker Reporting

A reconciliation report used to cross-check Sesame data against QuickBooks, ensuring amounts processed in both systems match. Run by date range using BRD Date filter.

Report fields: Practice | Consultant | Company | Position | Job Code | Amount

### Sample data rows (from the sheet)

| Practice | Consultant | Company | Position | Job Code | Amount |
|---|---|---|---|---|---|
| IND | JJ | Quikserv Corp | CEO | QuiHT21.1 | 0 |
| HC | AH | Elara Caring | SVP/EVP | ELRAH21.2 | 45,000 |
| TECH | FK | BrightEdge Technologies | Confidential Controller / Professional Services | BRIFK23.1 | 15,000 |
| TECH | FK | BrightEdge Technologies | Confidential Controller / Professional Services | BRIFK23.1 | 15,000 |
| DC | DC | Interstate Waste Services, Inc. | FP&A Analyst - NJ | INTDC23.6-1 | 5,000 |
| DP | BD | Interstate Waste Services, Inc. | FP&A Analyst - NJ | INTDC23.6-1 | 5,000 |
| TECH | JW | Colony Display, LLC | Chief Executive Officer | COLJW23.2 | 18,750 |
| TECH | JW | Colony Display, LLC | Chief Executive Officer | COLJW23.2 | 4,687 |
| HT/CHI | TM | Colony Display, LLC | Chief Executive Officer | COLJW23.2 | 14,063 |
| HC | AH | AGS Health LLC | General Manager, Coding & Automation | AGSAH23.1 | 13,875 |
| HC | CG | AGS Health LLC | General Manager, Coding & Automation | AGSAH23.1 | 13,875 |

**Job code pattern observed:** `[CompanyAbbrev][ConsultantInitials][YY].[SequenceNumber]`
Example: `BRIFK23.1` = BrightEdge + FK + 2023, first search. `INTDC23.6-1` suggests a sub-record or split on the 6th search.

**Multi-row pattern:** The same job code appears multiple times with different consultants and/or amounts — this represents the per-contributor split lines within a single search. Colony Display `COLJW23.2` shows three contributors (JW ×2, TM ×1) across different practices (TECH, HT/CHI) with amounts that appear to sum to the total fee.

---

## Sheet: Fields from Sesame

A second field reference list in this file, largely matching `All Fields From Sesame Job Record.xlsx` but with additional notes. Differences and additions noted below:

| Field | Additional note (not in first file) |
|---|---|
| DG | "Date search was entered into Sesame by Finance" |
| Cat | Value examples: MFG/ECOM |
| CJF | "Job title entered here (duplicate of position title field)" |
| Primary PE/VC | "Used to enter contacts email address" |
| Contact (primary) | "Often used to enter PO#'s or search terms from agreement" |
| Secondary PE/VC | "Used for payment terms from agreement" |
| Contact (secondary) | "Used for payment terms from agreement" |
| Delivery Tab — Label | Values: DELCON or ACTMGT (not just "origination or conversion") |
| CloseInits (Offer/Close) | Listed as "Not Used" in first file; this file marks it as required with Thrive = Yes |
