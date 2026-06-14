# Permission Manager — Features Guide

**Author:** siva <siva@enfono.com>
**App:** `permission_manager` | Module path: `permission_manager.permission_manager.*`
**Version:** 1.0.0

---

## Table of Contents

1. [Employee Approver Matrix](#1-employee-approver-matrix)
2. [Approver Delegation (OOO Cover)](#2-approver-delegation-ooo-cover)
3. [PM Workflow Engine](#3-pm-workflow-engine)
4. [Admin Reassignment](#4-admin-reassignment)
5. [Ad-hoc Forward to Approver](#5-ad-hoc-forward-to-approver)
6. [Multi-level HR Approval](#6-multi-level-hr-approval)
7. [My Approvals Inbox](#7-my-approvals-inbox)
8. [Permission Studio](#8-permission-studio)
9. [Permission Audit Log](#9-permission-audit-log)
10. [API Reference](#10-api-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Employee Approver Matrix

### What it does

Links each employee to a specific named user at each approval level.

When Ahmed submits a Purchase Order, it always goes to Khalid (his Level 1 approver) — not to anyone in the Purchase Manager role. Two people can hold the same role but approve for different teams.

### Where to set it up

Open any **Employee** record → **Approval Chain** tab.

| Field | Purpose |
|---|---|
| Approval Chain (grid) | One row per level per scope |
| Default Leave Substitute | Fallback when no delegation record is active |
| Disable Multi-level Approval | Bypass the matrix for this employee |

### Approval Chain grid columns

| Column | Notes |
|---|---|
| Level | 1 = first approver, 2 = second, etc. |
| Approver (User) | The exact person who approves at this level |
| Scope | All DocTypes / Specific Module / Specific DocType |
| Module / DocType | Filled when Scope is narrowed |

**Priority rule — most specific wins:**
```
Specific DocType  >  Specific Module  >  All DocTypes
```

### Example

Ahmed's Approval Chain:

| Level | Approver | Scope | DocType |
|---|---|---|---|
| 1 | khalid@co.com | All DocTypes | — |
| 1 | sara@co.com | Specific DocType | Sales Order |
| 2 | hr@co.com | All DocTypes | — |

- Ahmed submits a Purchase Order → goes to Khalid
- Ahmed submits a Sales Order → goes to Sara (DocType rule wins)
- After first approval → goes to HR (level 2)

---

## 2. Approver Delegation (OOO Cover)

### What it does

When an approver is on leave, a **PM Approver Delegation** record silently redirects their approvals to a substitute for a fixed date range. No workflow change needed.

### How to create one

Go to **PM Approver Delegation → New**:

| Field | Example |
|---|---|
| Original Approver | khalid@co.com |
| Substitute Approver | ali@co.com |
| From Date | 2026-06-01 |
| To Date | 2026-06-10 |
| Is Active | ✅ |
| Scope | All DocTypes / Specific Module / Specific DocType |

When the workflow engine resolves the approver, it checks delegation automatically. If an active record matches, Ali receives the approval instead of Khalid. The submitter and other users see no difference.

If multiple delegation records overlap, the most specific scope wins (same priority as the Approval Chain).

---

## 3. PM Workflow Engine

### What it does

A more flexible alternative to Frappe's built-in workflow. Key additions:

| Feature | Standard Frappe | PM Workflow |
|---|---|---|
| Multiple workflows per DocType | ✗ | ✓ (by company) |
| Company-level scoping | ✗ | ✓ |
| Parent-company inheritance | ✗ | ✓ (Allow Descendants) |
| Route to a specific named user | ✗ | ✓ via Approver Matrix |
| Delegation / OOO cover | ✗ | ✓ |
| Admin can reassign approver | ✗ | ✓ |
| Ad-hoc forward to any user mid-flow | ✗ | ✓ |
| Conditional transitions (amount, field value) | ✗ | ✓ |
| Require comment on a transition | ✗ | ✓ |
| Priority per approval step | ✗ | ✓ |
| Return document for correction | ✗ | ✓ |
| SLA reminders & escalation email | ✗ | ✓ |
| Visual workflow diagram | ✗ | ✓ |
| Bulk approval (up to 500) | ✗ | ✓ |

### Setup steps

#### Step 1 — Fill the Employee Approval Chain

Before creating the workflow, open each submitter's **Employee** record → **Approval Chain** tab and add rows (Level 1, Level 2, etc.).

#### Step 2 — Create Workflow States

Go to **Workflow State** and create the states your process needs, for example:

| Name | Style |
|---|---|
| Draft | Warning |
| Pending Approval | Warning |
| Approved | Success |
| Rejected | Danger |

For two levels, add: **Pending Level 2 Approval** (Warning).

#### Step 3 — Create Workflow Actions

Go to **Workflow Action Master** and create: `Submit for Approval`, `Approve`, `Reject`.

#### Step 4 — Add `workflow_state` field to the DocType

Add a Custom Field on the target DocType:

```
Fieldname:  workflow_state
Fieldtype:  Data
Label:      Workflow State
Read Only:  ✅
```

#### Step 5 — Create the PM Workflow

Go to **PM Workflow → New**:

```
Document Type:        Purchase Order
Workflow State Field: workflow_state
Company:              Your Company
Is Active:            ✅
```

**Transitions tab** (one-level example):

| From State | Action | Next State | Use Approver Matrix | Level | Fallback Role |
|---|---|---|---|---|---|
| Draft | Submit for Approval | Pending Approval | ☐ | — | — |
| Pending Approval | Approve | Approved | ✅ | 1 | Purchase Manager |
| Pending Approval | Reject | Rejected | ✅ | 1 | Purchase Manager |

**Two-level example:**

| From State | Action | Next State | Use Approver Matrix | Level | Fallback Role |
|---|---|---|---|---|---|
| Draft | Submit for Approval | Pending Approval | ☐ | — | — |
| Pending Approval | Approve | Pending Level 2 Approval | ✅ | 1 | Purchase Manager |
| Pending Approval | Reject | Rejected | ✅ | 1 | Purchase Manager |
| Pending Level 2 Approval | Approve | Approved | ✅ | 2 | Accounts Manager |
| Pending Level 2 Approval | Reject | Rejected | ✅ | 2 | Accounts Manager |

> **Fallback Role:** used when the submitter has no Employee record or no chain entry for that level. Always set one so approvals never get permanently stuck.

#### What happens when a document is saved

```
Ahmed saves a Purchase Order
  → PM Workflow engine fires (company matches, workflow active)
  → Reads Ahmed's Approval Chain: Level 1 = Khalid
  → Creates PM Workflow Action assigned to Khalid

  Form shows banner: "Pending approval from: Khalid"
  Only Khalid sees the Approve / Reject buttons

  Khalid clicks Approve → document moves to Approved state
```

### Additional options

**Conditional Transitions** — Add a Python expression in the **Condition** field of any transition row. Only transitions whose condition evaluates to `True` are offered to the approver. The expression is evaluated against `doc` and has access to `frappe.db.get_value`, `frappe.db.get_list`, `frappe.session`, `frappe.utils`, etc.

```python
doc.grand_total > 50000        # only route through Finance for large invoices
doc.department == "Operations" # department-specific path
frappe.session.user == "ceo@co.com"  # actor-specific gate
```

**Multi-path example (amount-based routing):**

| From State | Action | Next State | Condition |
|---|---|---|---|
| Pending | Approve | Approved | `doc.grand_total <= 50000` |
| Pending | Approve | Finance Review | `doc.grand_total > 50000` |
| Finance Review | Approve | Approved | — |
| Finance Review | Reject | Rejected | — |

**Require Comment** — tick on any transition (e.g. Reject) to force the approver to type a reason before proceeding.

**Priority per transition** — each transition row has a Priority field (Low / Medium / High / Critical, default Medium). When an approver takes an action, a dialog lets them confirm or change the priority for the next step. This priority is stamped on the PM Workflow Action record and shown as a badge in the inbox. If multiple transitions are active at the same step, the highest priority wins.

**Return for Correction** — tick `Return for Correction` on any transition. When an approver uses it, a comment is mandatory, the document reverts to Draft so the submitter can edit it, and the submitter receives a notification.

**SLA Reminders & Escalation** — set `Reminder After (days)` and `Escalate After (days)` on the PM Workflow. A daily scheduled job sends email reminders to the approver, and escalation emails to the `Escalation Email` address when overdue.

**Visual Workflow Diagram** — open any PM Workflow record and click **Actions → View Diagram** to see an SVG flowchart of all states and transitions. States are colour-coded (amber = draft, green = submitted, red = cancelled). Return-for-correction arrows are shown as dashed orange lines.

**Company Inheritance** — set `Allow Descendants = ✅` and one workflow covers a parent company and all its subsidiaries. A child company can override by creating its own PM Workflow for the same DocType.

**Workflow Help button** — available in the form's actions menu; shows the current state and who can perform the next action.

**Bulk Approval** — select documents in a list view, choose the action from the Actions menu:
- ≤ 20 documents: runs immediately with a progress bar
- 21–500 documents: queued as a background job

---

### Complete Example: Purchase Invoice — 2-level approval with ad-hoc

#### Scenario

- All Purchase Invoices go to the submitter's direct manager (Level 1) first
- Invoices above ₹50,000 also require Finance Head approval (Level 2)
- Occasionally, a manager wants a senior colleague to review before signing (ad-hoc)

#### Workflow States (create in Workflow State)

| Name | Style |
|---|---|
| Draft | Warning |
| Pending L1 Approval | Warning |
| Pending L2 Approval | Warning |
| Approved | Success |
| Rejected | Danger |

#### Workflow Actions (create in Workflow Action Master)

`Submit for Approval`, `Approve`, `Reject`, `Return for Correction`

#### PM Workflow — Transitions tab

| # | From State | Action | Next State | Condition | Use Matrix | Level | Fallback Role | Require Comment |
|---|---|---|---|---|---|---|---|---|
| 1 | Draft | Submit for Approval | Pending L1 Approval | — | ☐ | — | — | ☐ |
| 2 | Pending L1 Approval | Approve | Approved | `doc.grand_total <= 50000` | ✅ | 1 | Purchase Manager | ☐ |
| 3 | Pending L1 Approval | Approve | Pending L2 Approval | `doc.grand_total > 50000` | ✅ | 1 | Purchase Manager | ☐ |
| 4 | Pending L1 Approval | Reject | Rejected | — | ✅ | 1 | Purchase Manager | ✅ |
| 5 | Pending L1 Approval | Return for Correction | Draft | — | ✅ | 1 | Purchase Manager | ✅ |
| 6 | Pending L2 Approval | Approve | Approved | — | ✅ | 2 | Accounts Manager | ☐ |
| 7 | Pending L2 Approval | Reject | Rejected | — | ✅ | 2 | Accounts Manager | ✅ |

> Rows 2 and 3 have the same *From State* and *Action* but different conditions — PM Workflow evaluates both and fires whichever condition is true. If the amount is ≤ 50,000, row 2 fires (direct approval). If > 50,000, row 3 fires (escalates to L2).

#### Employee Approval Chain setup (for the submitter, e.g. Ravi)

| Level | Approver | Scope |
|---|---|---|
| 1 | khalid@co.com | All DocTypes |
| 2 | finance@co.com | Specific DocType: Purchase Invoice |

#### End-to-end flow

```
Ravi saves a Purchase Invoice (₹30,000)
  → Pending L1 Approval
  → Action created for Khalid (Level 1, from Approval Chain)
  → Khalid approves → condition: 30,000 ≤ 50,000 → Approved ✅

Ravi saves another Purchase Invoice (₹80,000)
  → Pending L1 Approval
  → Action created for Khalid
  → Khalid approves → condition: 80,000 > 50,000 → Pending L2 Approval
  → Action created for Finance Head (Level 2)
  → Finance Head approves → Approved ✅

  [Ad-hoc scenario]
  → Khalid is unsure, clicks ⇢ Forward → picks Sara (CFO)
  → Khalid's action marked Forwarded; Sara gets ad-hoc action in her inbox
  → Sara approves → workflow continues as if Khalid approved (moves to L2 or Approved)
```

#### Return for Correction flow

```
Ravi submits invoice with wrong tax
  → Pending L1 Approval
  → Khalid clicks "Return for Correction" (comment required: "GST rate wrong")
  → Invoice goes back to Draft; Ravi gets notification
  → Ravi fixes and re-submits → cycle restarts from Pending L1 Approval
```

---

### Routing by Role, Department, or User

PM Workflow transitions support three approver types. Mix and match within the same workflow:

| Approver Type | When to use | How to configure |
|---|---|---|
| **User (via Approver Matrix)** | Route to a specific named person per submitter | Tick `Use Approver Matrix`; fill the submitter's Employee Approval Chain |
| **Role** | Route to whoever holds a role (any member can approve) | Set `Approver Type = Role`, `Allowed = Finance Manager` |
| **User (fixed)** | Always route to the same person regardless of submitter | Set `Approver Type = User`, `Allowed = cfo@co.com` |

**Department-wise routing** — combine a Role approver with a condition that checks the submitter's department:

```python
# Transition condition — only fires if the submitter is in Operations
frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "department") == "Operations"
```

Create one transition per department, each with its matching condition and the appropriate Role or User for that department.

**Example — department-specific Finance approver:**

| From State | Action | Next State | Condition | Approver Type | Allowed |
|---|---|---|---|---|---|
| Pending | Approve | Approved | `frappe.db.get_value("Employee", {"user_id": doc.owner}, "department") == "Operations"` | Role | Operations Head |
| Pending | Approve | Approved | `frappe.db.get_value("Employee", {"user_id": doc.owner}, "department") == "Sales"` | Role | Sales Head |
| Pending | Approve | Approved | *(no condition — fallback for all other depts)* | Role | Department Manager |

---

### Example: Employee Exit Clearance (Relieving)

When an employee is relieving, multiple departments must sign off before the exit is complete. This is a sequential multi-department clearance — not a simple approval chain.

#### Doctype used

`hr_suite` already has an **Exit Clearance** doctype with per-department checkboxes:

| Checkbox field | Department responsible |
|---|---|
| `handover_completed` | Reporting Manager |
| `access_revoked` | IT |
| `assets_returned` | Admin |
| `payroll_closed` + `eosb_completed` | Finance |
| `final_attendance_verified` + `annual_leave_disbursement_completed` + `exit_interview_completed` | HR |

The doctype auto-calculates `clearance_percentage` and sets `status = Cleared` when all boxes are ticked.

> **No code changes needed.** PM Workflow is wired on top of Exit Clearance purely through configuration. When you save the PM Workflow, the `workflow_state` field is auto-created on Exit Clearance.

#### Scenario

HR creates an Exit Clearance for Ravi (leaving employee). Each department gets it in their My Approvals inbox in sequence, ticks their checkbox(es), and clicks "Clear".

#### PM Workflow setup

**Document Type:** `Exit Clearance`
**Workflow State Field:** `workflow_state` *(auto-created on save)*

#### Workflow States

| Name | Style |
|---|---|
| Draft | Warning |
| Manager Clearance Pending | Warning |
| IT Clearance Pending | Warning |
| Assets Clearance Pending | Warning |
| Finance Clearance Pending | Warning |
| HR Clearance Pending | Warning |
| Cleared | Success |
| Rejected | Danger |

#### Transitions tab

| From State | Action | Next State | Use Matrix | Level | Approver Type | Allowed | Require Comment |
|---|---|---|---|---|---|---|---|
| Draft | Initiate | Manager Clearance Pending | ☐ | — | Role | HR Manager | ☐ |
| Manager Clearance Pending | Clear | IT Clearance Pending | ✅ | 1 | — | — | ☐ |
| Manager Clearance Pending | Reject | Rejected | ✅ | 1 | — | — | ✅ |
| IT Clearance Pending | Clear | Assets Clearance Pending | ☐ | — | Role | IT Manager | ☐ |
| IT Clearance Pending | Reject | Rejected | ☐ | — | Role | IT Manager | ✅ |
| Assets Clearance Pending | Clear | Finance Clearance Pending | ☐ | — | Role | Admin Manager | ☐ |
| Assets Clearance Pending | Reject | Rejected | ☐ | — | Role | Admin Manager | ✅ |
| Finance Clearance Pending | Clear | HR Clearance Pending | ☐ | — | Role | Accounts Manager | ☐ |
| Finance Clearance Pending | Reject | Rejected | ☐ | — | Role | Accounts Manager | ✅ |
| HR Clearance Pending | Clear | Cleared | ☐ | — | Role | HR Manager | ☐ |
| HR Clearance Pending | Reject | Rejected | ☐ | — | Role | HR Manager | ✅ |

> **Manager step** uses `Use Approver Matrix = ✅, Level = 1` — resolves to Ravi's direct manager from his Employee Approval Chain. All other steps are Role-based so any team member holding that role can act.

#### End-to-end flow

```
HR creates Exit Clearance for Ravi
  → workflow_state = "Draft"
  → HR clicks "Initiate" → Manager Clearance Pending

Ravi's manager (Khalid) sees it in My Approvals inbox
  → Opens record → ticks "Handover Completed" → clicks "Clear"
  → workflow_state = "IT Clearance Pending"

IT Manager sees it in inbox
  → ticks "Access Revoked" → clicks "Clear"
  → workflow_state = "Assets Clearance Pending"

Admin Manager sees it in inbox
  → ticks "Assets Returned" → clicks "Clear"
  → workflow_state = "Finance Clearance Pending"

Accounts Manager sees it in inbox
  → ticks "Payroll Closed" + "EOSB Completed" → clicks "Clear"
  → workflow_state = "Finance Clearance Pending" → "HR Clearance Pending"

HR Manager sees it in inbox
  → ticks remaining 3 checkboxes → clicks "Clear"
  → clearance_percentage = 100% → status auto-sets to "Cleared" ✅
  → HR then processes Full and Final Settlement separately
```

#### Key design decisions

| Decision | Reason |
|---|---|
| Use Exit Clearance from hr_suite, not a new doctype | Doctype already exists with the right fields and auto-percentage logic |
| Full and Final Settlement stays separate | It's an HR-internal financial document — other departments don't need access to it |
| Sequential states, not parallel | Each department completes before the next begins — assets can't clear before IT access is revoked |
| Role-based from IT onwards | Any team member with the role can act; no single-person bottleneck if someone is absent |
| Rejection ends at Rejected | HR reopens a fresh cycle if a step is disputed; avoids infinite correction loops |
| workflow_state auto-created | PM Workflow creates the custom field on Exit Clearance automatically when saved — no manual setup |

#### Ad-hoc use case

Finance needs the CFO to verify a settlement amount before clearing:

- Accounts Manager clicks **⇢ Forward → CFO** in inbox
- CFO reviews, clicks "Clear" → Finance Clearance moves to HR Clearance Pending
- Normal flow continues

---

## 4. Admin Reassignment

### What it does

Lets a System Manager or HR Manager manually redirect a stuck approval to a different user — without touching the workflow configuration.

### How to use it

1. Open the stuck document
2. A banner shows: **"Pending approval from: Khalid"**
3. Click **Reassign Approver** in the Workflow button group
4. Pick a new user, optionally enter a reason, click **Reassign**

### What happens

- The open PM Workflow Action is updated to the new approver
- A comment is posted on the document timeline:
  ```
  🔄 Approver Reassigned
  From: Khalid → To: Ali
  By: admin@co.com | Reason: On leave
  ```
- An email notification is sent to the new approver
- The button is only visible to System Manager and HR Manager roles

---

## 5. Ad-hoc Forward to Approver

### What it does

Lets the current action holder forward a specific document to any other user for a one-time ad-hoc approval — without changing the PM Workflow definition. The workflow resumes its normal path once the ad-hoc approver acts.

**When to use it:**
- A document needs a one-time sign-off from someone outside the standard chain (e.g. a high-value invoice needs the CFO's eye before it reaches Finance)
- The normal approver wants to delegate a specific document to a colleague
- An ad-hoc review is needed that isn't worth encoding as a permanent workflow state

**When NOT to use it:**
- If the extra approval is always required → add a state to the PM Workflow definition instead
- If an approver is on leave → use Approver Delegation (OOO cover) instead

### How to use it

1. Open **My Approvals** inbox (`/app/pm-approval-inbox`)
2. On any pending row, click the **⇢** (Forward) button — visible only when the action is assigned to you
3. A dialog appears:
   - **Forward To** — pick any active System User
   - **Note** — optional reason for forwarding
4. Click **Forward**

### What happens

- Your action is marked **Forwarded** (disappears from your pending inbox)
- A new **Open** action is created for the target user — they see it in their inbox with the same Approve / Reject buttons
- The target user's inbox row shows an **Ad-hoc** amber badge so they know the origin
- A comment is added to the document timeline: *"Forwarded to [Name] for ad-hoc approval"*
- An email notification is sent to the target user

### After the ad-hoc approver acts

When the ad-hoc approver clicks Approve or Reject:
- The workflow applies their action normally (same transitions as the original approver would have used)
- The document moves to the next state
- All Open and Forwarded actions from the previous state are automatically closed
- Normal workflow continues from the new state

### Restrictions

- Only the user the action is **assigned to** can forward it (not just any role member)
- An ad-hoc action cannot be forwarded again (no chaining)
- System Managers can forward any action regardless of assignment

### PM Workflow Action fields

| Field | Purpose |
|---|---|
| `is_adhoc` | Marks this as a forwarded ad-hoc action (checkbox) |
| `adhoc_for` | Link back to the original forwarded action |
| Status: Forwarded | The original action's status while the ad-hoc action is pending |

---

## 6. Multi-level HR Approval

### What it does

Replaces Frappe's single-approver model for **Leave Applications** and **Expense Claims** with a dynamic chain that follows each employee's `Reports To` hierarchy.

> Requires the **HRMS** app to be installed. The PM Workflow engine works without HRMS.

### Configuration

1. In **HR Settings**, tick:
   - Enable Multi-level Leave Approval
   - Enable Multi-level Expense Claim Approval

2. In each **Employee** record, set **Reports To** to their direct manager.

3. Optional: tick **Disable Multi-level Approval** on an Employee to use a single approver for that person.

### How it works

```
Ravi submits a Leave Application
  → leave_approver set to Priya (direct manager)
  → Priya approves → leave_approver set to Ali (Priya's manager)
  → Ali approves → leave_approver set to HR Manager
  → HR Manager approves → document submitted, status = Approved

Any approver can Reject at their step → opens a reason dialog → document closed
```

Expense Claims follow the same chain.

### Permission filtering

With the feature on, list views show each user only:
- Records they submitted
- Records where they are the current approver
- Records where they were a previous approver

HR Managers, HR Users, and System Managers always see all records.

### Limitations of the built-in multi-level HR chain

The built-in chain always follows `Reports To` — it cannot route differently by role, department, or leave type. For more control, use the **PM Workflow engine** on Leave Application instead (or in addition).

### Advanced leave routing with PM Workflow

When you need **role-wise, department-wise, or conditional** routing for leave, set up a PM Workflow on the `Leave Application` doctype rather than relying solely on the built-in chain.

#### Example — route by leave type

Long leaves (> 5 days) require HR Head approval in addition to the direct manager:

| From State | Action | Next State | Condition | Approver Type | Allowed |
|---|---|---|---|---|---|
| Draft | Apply | Manager Approval Pending | — | User (Matrix) | Level 1 |
| Manager Approval Pending | Approve | Approved | `doc.total_leave_days <= 5` | User (Matrix) | Level 1 |
| Manager Approval Pending | Approve | HR Approval Pending | `doc.total_leave_days > 5` | User (Matrix) | Level 1 |
| Manager Approval Pending | Reject | Rejected | — | User (Matrix) | Level 1 |
| HR Approval Pending | Approve | Approved | — | Role | HR Manager |
| HR Approval Pending | Reject | Rejected | — | Role | HR Manager |

#### Example — route by department

Operations employees need department head sign-off; all others go directly to HR:

| From State | Action | Next State | Condition | Approver Type | Allowed |
|---|---|---|---|---|---|
| Draft | Apply | Dept Head Pending | `frappe.db.get_value("Employee", {"user_id": doc.owner}, "department") == "Operations"` | Role | Operations Manager |
| Draft | Apply | HR Approval Pending | `frappe.db.get_value("Employee", {"user_id": doc.owner}, "department") != "Operations"` | Role | HR Manager |
| Dept Head Pending | Approve | HR Approval Pending | — | Role | Operations Manager |
| Dept Head Pending | Reject | Rejected | — | Role | Operations Manager |
| HR Approval Pending | Approve | Approved | — | Role | HR Manager |
| HR Approval Pending | Reject | Rejected | — | Role | HR Manager |

#### Example — user-specific approver (named person regardless of role)

If a particular senior employee always needs the MD to approve their leave personally:

| From State | Action | Next State | Condition | Approver Type | Allowed |
|---|---|---|---|---|---|
| Draft | Apply | MD Approval Pending | `doc.owner == "senior@co.com"` | User | md@co.com |
| Draft | Apply | Manager Approval Pending | `doc.owner != "senior@co.com"` | User (Matrix) | Level 1 |
| MD Approval Pending | Approve | Approved | — | User | md@co.com |
| ... | ... | ... | ... | ... | ... |

#### Choosing between built-in chain and PM Workflow for leave

| Need | Use |
|---|---|
| Simple hierarchy following `Reports To` for all employees | Built-in multi-level HR approval |
| Different approval paths by leave type, duration, or department | PM Workflow on Leave Application |
| Named user approval for a specific employee | PM Workflow with User approver + condition |
| Ad-hoc forwarding during leave approval | PM Workflow (built-in chain has no forward feature) |
| Inbox visibility across all doc types in one place | PM Workflow (shows in My Approvals inbox) |

---

## 7. My Approvals Inbox

### What it does

A standalone page at `/app/pm-approval-inbox` where **any logged-in user** can see all documents waiting for their approval across all PM Workflows — in one place, without visiting each document individually.

### How to open it

- Navigate to `/app/pm-approval-inbox`
- Or click **My Approvals** from the Apps screen

### What it shows

Pending approvals are grouped into three categories:

| Group | When it appears |
|---|---|
| **Approval Pending** | Transition requires approve / review / verify / validate / authorise |
| **Decision Pending** | General decisions that don't match other categories |
| **Acknowledgement Pending** | Transition requires acknowledge / accept / confirm / noted |

Each group shows a table with these columns:

| Column | Description |
|---|---|
| Date | When the approval was created |
| Priority | Set by the previous approver (Critical / High / Medium / Low) — defaults to Medium |
| Transaction | The DocType (e.g. Purchase Order) |
| # | Document name — click to open it |
| Role ID | The role through which you have permission (or "Direct" if assigned by name) |
| With | Who currently holds the action (full name, or role if unassigned) |
| Approval | Current workflow state of the document |
| Days | Days waiting — turns amber after 7 days, red after 30 |
| Creator | Full name of the person who submitted the document |
| Actions | Approve / Reject buttons + **⇢ Forward** button + → link to open the document |

**Inline document preview** — click anywhere on a row (not on a button) to expand a mini-preview of the document's key fields directly in the inbox, without opening a new page. Fields are prioritised: `in_preview` fields first, then bold fields, then list-view fields. Technical and system fields (exchange rate, naming series, child tables, etc.) are hidden automatically.

### Using the inbox

**Single action:**
1. Click **Approve** (green) or **Reject** (red) on any row
2. A dialog appears with a **Priority** dropdown (Low / Medium / High / Critical) and an optional Comment field
3. Set the priority for the next approver (or leave as Medium), add a note if needed, then confirm
4. The transition is applied and the inbox reloads

**Bulk approve / reject:**
1. Tick the checkboxes on rows you want to act on (or use *Select all* in the group header)
2. The **Bulk approve checked** / **Bulk reject checked** buttons appear
3. Confirm — actions run one by one; a summary shows how many succeeded

**Filter:**
- **Search box** — filters by DocType name, document number, creator, or workflow state
- **Transaction dropdown** — narrows to a single DocType
- **From Date / To Date** — optional date range filter; leave either blank to filter open-ended (e.g. set only *From Date* to see everything since that date)
- All filters work together

**Date sorting:** click the **Date** column header to toggle between newest-first (↓) and oldest-first (↑). The sort indicator updates in place.

**Stats bar:** shows item count per group, plus a warning if there are high-priority or overdue (>30 days) items.

**Collapse / expand groups:** click any group header to hide or show its rows.

**Refresh:** click the **Refresh** button to reload without reloading the page. The page also reloads automatically each time you navigate back to it.

### Inbox tabs

| Tab | What it shows |
|---|---|
| **Pending** | All open approvals waiting for you (default view) |
| **History** | Completed approvals only (last 200) — shows both actions you took as approver and actions on documents you submitted. Columns: Date, Transaction, #, Approved At State (the state when action was taken), Current State (where the document is now), Actioned By, Via Role |
| **Analytics** | Summary tiles (open / completed / overdue), volume by DocType, pending by age, and top approvers by completions in the last 30 days |

---

## 8. Permission Studio

**Access:** `/app/permission-studio` — visible to **System Manager** role only.

A visual dashboard for inspecting and editing Frappe permissions without writing code or touching the database directly.

### User View

See what a specific user can and cannot do across all DocTypes.

1. Select a **User** from the dropdown
2. Optionally filter by **Module** or search by DocType name
3. The matrix shows one row per DocType with columns for each permission type

**Cell symbols:**

| Symbol | Colour | Meaning |
|---|---|---|
| ✓ | Green | Allowed |
| ✗ | Red | Not allowed |
| ◐ | Amber | Allowed only if user is the document owner |
| — | Gray | Not applicable |

**"Why?" trace:** click any cell to see a 6-step explanation of how the permission was resolved (roles, if_owner, User Permissions, DocShare).

**View Restrictions:** shows all User Permission rules and recent DocShare records for this user.

**Override panel:** set an explicit allow/deny for the selected user on a specific DocType, bypassing their role-based permissions. Supports the `if_owner` flag too.

### DocType View

See and edit all role permissions for a DocType.

1. Select a **DocType**
2. The matrix shows every role with its full permission row
3. **Search bar** — filter rows by role name
4. Click **Edit Permissions** to enter edit mode

In edit mode:
- Click any ✓/✗ cell → flips and saves instantly
- Click the **Own** column (○ / ✓) → toggles `if_owner` (permission applies only when the user owns the document)
- **+ Add Role** → pick role and permission level → row added with read = 1
- Hover any row → trash icon → click to delete that role's permissions
- **Reset to Standard** → deletes all custom perms, restores Frappe defaults

**Bulk Apply:** apply the same role permissions to a list of DocTypes in one step.

### Role View

See everything a role can access, grouped by module.

1. Select a **Role**
2. Shows: total DocTypes, user count, and a per-module breakdown
3. **Search bar** — filter rows by DocType name (persists if you switch between view and edit mode)
4. **Own column** — shows whether `if_owner` is set per DocType
5. Click **Edit Permissions** to toggle permissions or `if_owner` inline

### Profile View

See permissions through the lens of a **Role Profile** (a saved bundle of roles).

1. Select a **Role Profile**
2. Shows the combined effective permissions from all roles in that profile
3. Useful for auditing what a user inherits from a profile before assigning it

### Who Can? (Reverse Lookup)

Find out exactly which users can perform a specific action on a DocType.

1. Select a **DocType** and a **Permission Type** (read, write, delete, submit…)
2. A grid of user cards appears — each shows the user's name and which roles grant the permission

Use this to answer: "Who can delete Sales Invoices?"

### Role Comparison

Compare two roles side-by-side.

1. Select **Role 1** and **Role 2**
2. A merged table shows both roles' permissions per DocType
3. Toggle **Diff Only** to hide identical rows — focus on where they differ

### Health Dashboard

System-wide permission health at a glance:

- **Score (0–100):** penalises excessive permissions on sensitive DocTypes
- **Tiles:** total custom perms, orphaned User Permissions, DocTypes with no permissions, over-privileged roles
- **Simulate User Access:** pick a user → see a module-by-module breakdown of what they can access and why

### Accounts Tab (Chart of Accounts Restriction)

Restrict which accounts a specific user can see in the Chart of Accounts.

- Accounts are shown as an **expandable tree** grouped by company and account type
- Click any folder to expand / collapse it; use **⊞ Expand All** / **⊟ Collapse All** for quick navigation
- Drag accounts from the available tree into the **Restricted** panel to block them
- Remove chips from the Restricted panel to restore access
- The restriction is applied via a `PM_Base_{user}` role with Custom DocPerm rows

### CSV Export

Available in DocType View, Role View, and Role Comparison — click **Export CSV** to download the current matrix as a spreadsheet.

---

## 9. Permission Audit Log

### What it does

Every change made through Permission Studio is recorded in the **PM Permission Log** DocType. This gives System Managers a full history of who changed what permission and when.

### What is logged

| Change | When logged |
|---|---|
| Toggle a permission bit (read, write, delete, etc.) | `update_permission` |
| Toggle `if_owner` | `update_if_owner` |
| Add a role to a DocType | `add_role_permission` |
| Remove a role from a DocType | `remove_role_permission` |
| Reset to standard | `reset_to_standard` |
| Bulk apply permissions | `bulk_apply_role_permissions` |

### Log record fields

| Field | Description |
|---|---|
| Changed By | User who made the change |
| Changed On | Exact date and time |
| Source | Which Studio action triggered it |
| DocType Name | The DocType that was modified |
| Role | The role affected |
| Perm Level | 0 = standard, 1+ = level-restricted |
| Permission Type | e.g. `read`, `write`, `delete` |
| Old Value | Value before the change |
| New Value | Value after the change |
| IP Address | Requester's IP address |

### How to view it

- Open **Permission Studio → Audit Log tab** — filter by DocType or Role and see a table of recent changes
- Or go directly to **PM Permission Log** in the DocType list (System Manager only)

---

## 10. API Reference

All methods are `@frappe.whitelist()`.

### My Approvals Inbox

```javascript
// Get all pending approvals for the current user
frappe.call({
    method: "permission_manager.permission_manager.api.approvals.get_my_pending_approvals"
})
// Returns: { total: int, groups: [{ label, items: [...] }] }

// Apply a workflow action directly from the inbox
frappe.call({
    method: "permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",
    args: {
        doctype: "Purchase Order",
        docname: "PO-00001",
        action: "Approve",
        comment: "Looks good.",   // optional
        priority: "High"          // optional — Low / Medium / High / Critical
    }
})
// Returns: { success: true, docname, action }

// Get approval history for the current user
frappe.call({
    method: "permission_manager.permission_manager.api.approvals.get_my_approval_history",
    args: { limit: 100 }
})

// Get analytics summary
frappe.call({
    method: "permission_manager.permission_manager.api.approvals.get_approval_analytics"
})

// Forward a pending action to another user as ad-hoc approver
frappe.call({
    method: "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.forward_workflow_action",
    args: {
        action_name: "PM-WFA-00001",   // PM Workflow Action name
        to_user: "ali@co.com",
        comment: "Please review before I sign off"   // optional
    }
})
// Returns: { adhoc_action: "PM-WFA-00002" }

// Get permission audit log entries
frappe.call({
    method: "permission_manager.permission_manager.api.approvals.get_permission_audit_log",
    args: { doctype_name: "Sales Invoice", role: "", limit: 50 }
})
```

### PM Workflow Engine

```javascript
// Get the active workflow name for a document
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_workflow_name",
    args: { doctype: "Purchase Order", docname: "PO-00001" }
})

// Get transitions available to the current user
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_transitions",
    args: { doc: frm.doc }
})

// Apply a workflow action
frappe.call({
    method: "permission_manager.permission_manager.workflow.apply_workflow",
    args: { doc: frm.doc, action: "Approve", comment: "OK", priority: "High" }
})

// Get SVG diagram data for a workflow
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_diagram_data",
    args: { workflow_name: "My PO Workflow" }
})
// Returns: { states: [...], transitions: [...], workflow_name }

// Bulk approve (up to 500 documents)
frappe.call({
    method: "permission_manager.permission_manager.workflow.bulk_workflow_approval",
    args: {
        docnames: JSON.stringify(["PO-001", "PO-002"]),
        doctype: "Purchase Order",
        action: "Approve"
    }
})
```

### Admin Reassignment

```javascript
// Reassign a pending approval (System Manager / HR Manager only)
frappe.call({
    method: "permission_manager.permission_manager.workflow.reassign_workflow_approver",
    args: {
        doctype: "Purchase Order",
        docname: "PO-00001",
        new_approver: "ali@co.com",
        reason: "Khalid is on leave"
    }
})

// Get the current pending approver for a document
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_pending_workflow_action",
    args: { doctype: "Purchase Order", docname: "PO-00001" }
})
// Returns: { name, assigned_to, assigned_to_name, workflow_state }
```

### Permission Studio — Read

```javascript
// User permission matrix
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_user_matrix",
    args: { user: "john@co.com", module: "Accounts" }   // module optional
})

// All roles for a DocType
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
    args: { doctype: "Sales Invoice" }
})

// All DocTypes a role can access
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_role_matrix",
    args: { role: "Accounts Manager" }
})

// Why does a user have / not have a permission?
frappe.call({
    method: "permission_manager.permission_manager.api.resolver.explain_permission",
    args: { user: "john@co.com", doctype: "Sales Invoice", ptype: "delete" }
})

// Who has a permission on a DocType?
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.get_users_with_permission",
    args: { doctype: "Sales Invoice", ptype: "delete" }
})

// Compare two roles
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.compare_roles",
    args: { role1: "Accounts Manager", role2: "Accounts User" }
})

// Health stats
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.get_permission_health"
})

// Simulate what a user can access
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.simulate_user_access",
    args: { user: "john@co.com" }
})
```

### Permission Studio — Write

```javascript
// Initialise custom perms (copy standard → custom) before editing
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.init_custom_perms",
    args: { doctype: "Delivery Note" }
})

// Toggle a single permission bit
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.update_permission",
    args: { doctype: "Delivery Note", role: "Logistics Manager", permlevel: 0, ptype: "print", value: 1 }
})

// Toggle the if_owner flag (permission applies only when user owns the document)
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.update_if_owner",
    args: { doctype: "Delivery Note", role: "Logistics Manager", permlevel: 0, value: 1 }
})

// Add a new role row
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.add_role_permission",
    args: { doctype: "Delivery Note", role: "Fleet Manager", permlevel: 0 }
})

// Remove a role row
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.remove_role_permission",
    args: { doctype: "Delivery Note", role: "Fleet Manager", permlevel: 0 }
})

// Reset to standard (delete all custom perms)
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.reset_to_standard",
    args: { doctype: "Delivery Note" }
})

// Apply the same permissions to multiple DocTypes at once
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.bulk_apply_role_permissions",
    args: {
        doctypes: ["Delivery Note", "Purchase Receipt"],
        role: "Warehouse Manager",
        permissions: { read: 1, write: 1, create: 1, delete: 0, if_owner: 0 }
    }
})

// Export current matrix as CSV
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.export_matrix_csv",
    args: { data_type: "doctype", identifier: "Sales Invoice" }
    // data_type: "doctype" | "user" | "role" | "comparison"
})
```

---

## 11. Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| "Approval Chain" tab not visible in Employee | Custom fields not imported | Run `bench execute permission_manager.permission_manager.install.import_fixtures` |
| PM Workflow buttons not appearing on form | No active PM Workflow for that DocType + Company | Create a PM Workflow with `Is Active = 1` for the correct Company |
| Approve/Reject visible to wrong user | `Use Approver Matrix` not ticked, or Approval Chain not filled | Tick `Use Approver Matrix` on the transition; fill the submitter's Approval Chain |
| All managers can approve instead of specific person | Transition does not use Approver Matrix | Tick `Use Approver Matrix`; ensure submitter has an Employee record |
| Delegation not working | `Is Active` not ticked, or dates wrong | Check PM Approver Delegation: Is Active = ✅, dates bracket today |
| Reassign Approver button not visible | User lacks System Manager or HR Manager role | Assign one of those roles |
| My Approvals inbox is empty | No open PM Workflow Actions assigned to the user or their roles | Verify a PM Workflow is active and actions have been created for their documents |
| Priority always shows Medium in inbox | Actions were created before the priority field was added | Re-trigger the workflow (re-save the document) to create a new action with priority stamped |
| Workflow diagram not showing | PM Workflow has no transitions defined | Add at least one transition row to the PM Workflow |
| Multi-level HR approval not working | HRMS not installed, or HR Settings toggles off | Install HRMS; enable the toggles in HR Settings |
| Permission Studio blank | User is not System Manager | Assign System Manager role |
| Assets not loading after install | JS/CSS not built | Run `bench build --app permission_manager` |
| Changes in Permission Studio not saving | Redis cache stale | Run `bench clear-cache` or hard-reload the browser |
| ProgrammingError on PM Workflow table | `bench migrate` not run after install | Run `bench --site <site> migrate` |
| ⇢ Forward button not visible | Action is not assigned directly to you (assigned via role) | Forward is only available when `assigned_to = current user`; System Managers can always forward |
| Ad-hoc approver doesn't see the action | `is_adhoc` / `adhoc_for` columns missing (schema not migrated) | Run `bench --site <site> migrate` or manually add columns — see install notes |
| Forwarded action still shows in inbox | Status not updated to Forwarded | Reload the inbox; if persisting, check that `forward_workflow_action` ran without error |
