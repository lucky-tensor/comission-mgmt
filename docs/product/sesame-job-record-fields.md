# Sesame Job Record — Field Inventory

Source: `All Fields From Sesame Job Record.xlsx`
Context: Sesame is the customer's current (25-year-old) commission management tool. This inventory was produced during a rebuild discovery ~2 years ago. Fields marked "Not used" or "No longer used" reflect the state of the system at that time.

The spreadsheet contains a single sheet organized into four logical sections, listed below.

---

## Main Job Record

The top-level record for a search. One record per search engagement.

| Field | Description | Notes |
|---|---|---|
| Practice | Executing practice | |
| Individual | Executing individual | |
| GottenBy Practice | Practice that won the business | |
| Gotten By | Individual who won the business | |
| New/Core | New or core client | Not used — no definition of "new/core" was ever agreed upon |
| DG | Search start date | |
| DC | Search close date | |
| SD | Candidate start date | |
| Cat | Category | No longer used |
| CIE | Core industry experience | No longer used |
| EM | End market | No longer used |
| CJF | Core job function | No longer used |
| Level | Position level of the search | Accuracy questioned |
| Company | Client company name | |
| Revenue | Client company revenue | |
| LOS | Level of service | No longer used (uncertain if ever used) |
| Position Title | Position title for the search | |
| Status | Search status | Values include: Active, inactive, closed — others unknown |
| Hiring Manager | Client contact | Correct name or email format unclear |
| JOB CODE | Job code | |
| Confidential | Whether the search is confidential | |
| Primary PE/VC | Primary sponsor | |
| Contact | Primary sponsor contact | |
| AGRMT | Agreement on file | |
| Secondary PE/VC | Secondary sponsor | |
| Contact | Secondary sponsor contact | |
| TOS | Terms of search | Values: Retained, marketing, contingent |

### Pipeline Stage Fields

| Field | Description | Notes |
|---|---|---|
| IRS | Initial recruiting stage | |
| CS | Candidate stage | |
| IS | Interview stage | |
| OS | Offer stage | |
| FS | Fee structure | Appears among stage fields but description says "fee structure" |
| PS | Unknown | No description provided |
| State | US state for job location | |
| Projected Close | Projected days until close | |

### Attribution Fields

Up to three originators and three converters per job record, each with a percentage allocation.

| Field | Description |
|---|---|
| Orig1 | First originator |
| Orig1% | First originator percentage |
| Orig2 | Second originator |
| Orig2% | Second originator percentage |
| Orig3 | Third originator |
| Orig3% | Third originator percentage |
| Convrt1 | First converter |
| Convrt1% | First converter percentage |
| Convrt2 | Second converter |
| Convrt2% | Second converter percentage |
| Convrt3 | Third converter |
| Convrt3% | Third converter percentage |

### Fee Summary Fields

Two distinct fee phases — retainer and delivery — each tracked independently through a Projected → Billed → Received lifecycle.

| Field | Description |
|---|---|
| Retainer - Projected | Projected retainer amount |
| Retainer - Billed | Billed retainer amount |
| Retainer - BillDate | Date retainer was billed |
| Retainer - Received | Received retainer amount |
| Retainer - RecDate | Date retainer was received |
| Retainer - Actual | Actual retainer amount |
| Delivery - Projected | Projected delivery amount |
| Delivery - Billed | Billed delivery amount |
| Delivery - BillDate | Date delivery was billed |
| Delivery - Received | Received delivery amount |
| Delivery - RecDate | Date delivery was received |
| Delivery - Actual | Actual delivery amount |
| Totals - Projected | Projected total (retainer + delivery) |
| Totals - Billed | Billed total |
| Totals - Received | Received total |

---

## Retainer Tab

One row per contributor per job record, for retainer-phase commission tracking. Linked back to the job record via `UniqueIncrementingNumber`.

| Field | Description | Notes |
|---|---|---|
| Label | Origination or conversion | Identifies which role type this line represents |
| Cnslt | Individual collecting the origination or conversion | |
| Practice | The individual's practice | |
| PRet% | Paid retainer percentage | * |
| ARet% | Actual retainer percentage | * |
| ORet% | Origination retainer percentage | * |
| CRet% | Conversion retainer percentage | * |
| PRD | Paid retainer dollars | * |
| BRD | Billed retainer dollars | * |
| BRD Date | Bill date | * |
| RRD | Received retainer dollars | * |
| RRD Date | Received date | * |
| ARD | Unknown | No description provided |
| Job Code | Job code | Pulled from main record |
| Count Credit | Unknown | No description provided |
| Company | Company | Pulled from main record |
| DelInvDate | Delivery invoice date | Usage uncertain |
| RetInvDate | Retainer invoice date | Usage uncertain |
| Status | Status | Pulled from main record |
| PosTitle | Position title | Pulled from main record |
| ProjectedClose | Projected days to close | Pulled from main record |
| DG | Date gotten | Pulled from main record |
| DC | Date closed | Pulled from main record |
| UniqueIncrementingNumber | Record ID | Ties this retainer tab line to the job record |

*Fields prefixed with `*` in the source are highlighted — likely calculated or formula-driven fields in the original spreadsheet.

---

## Delivery Tab

One row per contributor per job record, for delivery-phase commission tracking. Mirrors the Retainer Tab structure. Linked back to the job record via `UniqueIncrementingNumber`.

| Field | Description | Notes |
|---|---|---|
| Label | Origination or conversion | |
| Cnslt | Individual collecting the delivery | |
| Practice | The individual's practice | |
| PDelt% | Paid delivery percentage | * |
| ADel% | Actual delivery percentage | * |
| PDD | Paid delivery dollars | * |
| BDD | Billed delivery dollars | * |
| BDD Date | Bill date | * |
| RDD | Received delivery dollars | * |
| RDD Date | Received date | * |
| ADD | Unknown | No description provided |
| Job Code | Job code | |
| Company | Company | |
| DelInvDate | Delivery invoice date | |
| RetInvDate | Retainer invoice date | |
| Status | Status | |
| PosTitle | Position title | |
| ProjectedClose | Projected days to close | |
| DG | Date gotten | |
| DC | Date closed | |
| UniqueIncrementingNumber | Record ID | Ties this delivery tab line to the job record |

*Fields prefixed with `*` in the source are highlighted — likely calculated or formula-driven fields in the original spreadsheet.

---

## Offer/Close Tab

All fields in this tab are documented as "Not Used" with the exception of Close Date and CloseInits, which have descriptions but were entered manually. The tab appears to have been designed to track candidate offer and placement details but was never adopted.

| Field | Description | Notes |
|---|---|---|
| OfferInits | — | Not used |
| Practice | — | Not used |
| Candidate | — | Not used |
| Offer Date | — | Not used |
| Amount | — | Not used |
| HF | — | Not used |
| Job# | — | Not used |
| Ores | — | Not used |
| UniqueIncrementingNumber | — | Not used |
| Candidate | — | Not used |
| Close Date | Close date | Manual entry |
| Amount | — | Not used |
| How Found | — | Not used |
| Base | — | Not used |
| Bonus | — | Not used |
| Other | — | Not used |
| CloseInits | Closer's initials | Manual entry |
| FRes | — | Not used |
| Research | — | Not used |
| ClosePractice | — | Not used |
| LastUpdated | — | Not used |
