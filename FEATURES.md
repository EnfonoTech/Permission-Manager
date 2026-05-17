# Permission Manager — Features & Working Guide

**Author:** siva <siva@enfono.com>
**App:** `permission_manager` | Inner module path: `permission_manager.permission_manager.*`

This document explains every feature with real configuration steps, what happens under the hood, and example scenarios.

---

## Table of Contents

1. [Employee Approver Matrix](#1-employee-approver-matrix)
2. [Approver Delegation (OOO Cover)](#2-approver-delegation-ooo-cover)
3. [PM Workflow Engine](#3-nl-workflow-engine)
4. [Admin Reassignment](#4-admin-reassignment)
5. [Multi-level HR Approval (Ladder Approve)](#5-multi-level-hr-approval)
6. [Permission Studio](#6-permission-studio)
7. [API Reference](#7-api-reference)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Employee Approver Matrix

### What it does

Links every employee to a named user at each approval level — so when user A submits a Purchase Order, it always goes to user B (their level-1 approver) and then user C (level-2), regardless of which role those users hold.

This solves the real-world problem where two people hold the same role (e.g., two Purchase Managers) but each should only approve for their own team's submitters.

### Where to configure

Open any **Employee** record. The form has an **"Approval Chain"** tab (it appears between the "Attendance & Leaves" tab and the "Salary" tab).

Inside that tab you will find:

| Field | Purpose |
|---|---|
| **Approval Chain** (grid) | One row per level per scope |
| **Default Leave Substitute** | Fallback user when no active Delegation record exists |
| **Disable Multi-level Approval** | Tick to bypass the matrix for this employee (single-approver flow) |

### Setting up the Approval Chain grid

Each row in the grid has:

| Column | Values | Notes |
|---|---|---|
| Level | 1, 2, 3 … | 1 = first person to approve; 2 = second, etc. |
| Approver (User) | Any active User | The exact person who will receive the approval |
| Approver Name | Auto-filled | Read-only; pulled from User's `full_name` |
| Scope | All DocTypes / Specific Module / Specific DocType | Limit this row to a subset of documents |
| Module | (if Scope = Specific Module) | e.g., Buying, Accounts |
| DocType | (if Scope = Specific DocType) | e.g., Purchase Order |

**Resolution priority (most specific wins):**
```
Specific DocType  >  Specific Module  >  All DocTypes
```

If two rows exist for the same level, one scoped to "Purchase Order" and one to "All DocTypes", the Purchase Order row wins when the document is a Purchase Order.

### Example setup

**Scenario:** Ahmed (engineer) reports to Khalid (manager) for all approvals, except for Sales Orders where he reports directly to Sara (sales director).

Ahmed's Employee → Approval Chain tab:

| Level | Approver | Scope | DocType |
|---|---|---|---|
| 1 | khalid@company.com | All DocTypes | — |
| 1 | sara@company.com | Specific DocType | Sales Order |
| 2 | hr@company.com | All DocTypes | — |

Result:
- Ahmed submits a Purchase Order → goes to Khalid
- Ahmed submits a Sales Order → goes to Sara (DocType rule wins)
- After Khalid or Sara approves → goes to HR (level 2)

### How resolution works internally

When a workflow action is triggered for a document owned by Ahmed:

```
resolve_approver(
    submitter_user = "ahmed@company.com",
    level          = 1,
    doctype        = "Purchase Order",
    workflow_name  = "PO Approval"
)
```

1. Finds Ahmed's Employee record (matched by `user_id`)
2. Reads all rows from his `pm_approval_chain` child table where `level = 1`
3. Scores each row: DocType-specific = 3, Module-specific = 2, All DocTypes = 1
4. Returns the highest-scoring approver
5. Checks for an active **Delegation** record (see section 2) and substitutes if found

---

## 2. Approver Delegation (OOO Cover)

### What it does

When an approver is on leave or unavailable, a **PM Approver Delegation** record can redirect all their pending and future approvals to a substitute — for a fixed date range, and optionally scoped to specific DocTypes or Modules.

### How to create a Delegation

Go to **PM Approver Delegation** (List → New):

| Field | Example | Notes |
|---|---|---|
| Original Approver | khalid@company.com | The person going on leave |
| Substitute Approver | ali@company.com | Who covers in their absence |
| From Date | 2026-06-01 | Delegation active from |
| To Date | 2026-06-10 | Delegation active until |
| Is Active | ✅ | Must be ticked |
| Scope | All DocTypes / Specific Module / Specific DocType | Optional narrowing |
| Reason | Annual leave | Shown in audit trail |
| Delegated By | admin@company.com | Who created the delegation |

### Priority rules

If multiple delegation records exist for the same original approver on the same day:
```
Specific DocType  >  Specific Module  >  All DocTypes
```

### What happens automatically

When `resolve_approver()` finds Khalid as the mapped approver, it then calls `_apply_delegation(khalid, doctype)`:

- Queries PM Approver Delegation where `original_approver = Khalid`, `is_active = 1`, and today is within `from_date`–`to_date`
- Returns Ali's email if a match is found
- Otherwise returns Khalid

The delegation is transparent — no code change is needed in the workflow. Approvals simply reach Ali's inbox instead of Khalid's.

---

## 3. PM Workflow Engine

### What it does

An alternative to Frappe's built-in workflow system. Key advantages:

| Feature | Standard Frappe | PM Workflow |
|---|---|---|
| One workflow per DocType | ✓ | ✓ |
| Multiple workflows per DocType | ✗ | ✓ (by company / user / dimension) |
| Company-level scoping | ✗ | ✓ |
| Parent-company inheritance | ✗ | ✓ (Allow Descendants) |
| User-specific workflow override | ✗ | ✓ |
| Route to a specific named user | ✗ | ✓ via Employee Approver Matrix |
| Delegation / OOO cover | ✗ | ✓ |
| Admin can reassign approver | ✗ | ✓ |
| Required comment on transition | ✗ | ✓ |
| Bulk approval (up to 500) | ✗ | ✓ |
| Self-approval control per transition | ✗ | ✓ |

### Creating a PM Workflow with Employee Approver Matrix

This is the recommended setup when you need specific named users to approve — not just anyone in a role. For example: two Purchase Managers exist but each should only approve for their own team's submitters.

---

#### Prerequisite — Fill the Employee Approval Chain

Before creating the workflow, open each **Employee** record that will submit documents → **Approval Chain** tab → add rows:

| Level | Approver | Scope |
|---|---|---|
| 1 | manager@company.com | All DocTypes |
| 2 | hr@company.com | All DocTypes |

Repeat for every submitter. The approver here is a named user — not a role.

---

#### Step 1 — Create Workflow States

Go to **Workflow State** and create:

| Name | Style |
|---|---|
| Draft | Warning |
| Pending Approval | Warning |
| Approved | Success |
| Rejected | Danger |

For two-level approval, add a second state:

| Name | Style |
|---|---|
| Pending Level 2 Approval | Warning |

---

#### Step 2 — Create Workflow Actions

Go to **Workflow Action Master** and create:
- `Submit for Approval`
- `Approve`
- `Reject`

---

#### Step 3 — Add `workflow_state` field to the DocType

The PM Workflow stores the current state in a field on the document itself. Add a Custom Field:

```
DocType:    Purchase Order   (or whichever DocType you are targeting)
Fieldname:  workflow_state
Fieldtype:  Data
Label:      Workflow State
Read Only:  ✅
```

---

#### Step 4 — Create the PM Workflow

Go to **PM Workflow → New** and fill the header:

```
Name:                Purchase Order Approval
Document Type:       Purchase Order
Workflow State Field: workflow_state
Company:             Your Company
Is Active:           ✅
Send Email Alert:    ✅
```

**States tab** — add one row per state:

| State | Doc Status | Allow Edit — Type | Allow Edit — Value |
|---|---|---|---|
| Draft | 0 | Role | Purchase User |
| Pending Approval | 0 | Role | System Manager |
| Approved | 1 | Role | System Manager |
| Rejected | 2 | Role | System Manager |

**Transitions tab** — this is where the matrix is wired in:

| From State | Action | Next State | Approver Type | Approver | Use Approver Matrix | Approval Level | Fallback Role |
|---|---|---|---|---|---|---|---|
| Draft | Submit for Approval | Pending Approval | Role | Purchase User | ☐ | — | — |
| Pending Approval | Approve | Approved | — | — | ✅ | 1 | Purchase Manager |
| Pending Approval | Reject | Rejected | — | — | ✅ | 1 | Purchase Manager |

> **Important:** `Use Approver Matrix` is ticked only on the Approve/Reject rows — not on "Submit for Approval". Anyone with the Purchase User role can submit; the matrix restricts who can approve.

**For two-level approval**, add the middle state and split the transitions:

| From State | Action | Next State | Use Approver Matrix | Level | Fallback Role |
|---|---|---|---|---|---|
| Draft | Submit for Approval | Pending Approval | ☐ | — | — |
| Pending Approval | Approve | Pending Level 2 Approval | ✅ | 1 | Purchase Manager |
| Pending Approval | Reject | Rejected | ✅ | 1 | Purchase Manager |
| Pending Level 2 Approval | Approve | Approved | ✅ | 2 | Accounts Manager |
| Pending Level 2 Approval | Reject | Rejected | ✅ | 2 | Accounts Manager |

The Level number on each transition must match the Level column in the employee's Approval Chain grid.

---

#### Step 5 — What happens when a document is saved

```
Ahmed saves a Purchase Order
  → PM Workflow detects it (company matches, workflow active)
  → Reads Ahmed's Employee Approval Chain: Level 1 = Khalid
  → Creates PM Workflow Action:
       assigned_to   = khalid@company.com
       for_submitter = ahmed@company.com

  Form shows banner: "Pending approval from: Khalid Ahmed"

  Khalid opens the PO → sees Approve / Reject in the actions menu
  No one else sees those buttons

  Khalid clicks Approve → state → "Approved", PO submitted
```

If Khalid is unavailable → System Manager clicks **Reassign Approver** → picks another user → that person gets the buttons.

---

#### What the Fallback Role does

| Situation | What happens |
|---|---|
| Submitter has no Employee record | Fallback Role is used — anyone in that role can approve |
| Employee has no Level 1 chain entry | Fallback Role is used |
| Fallback Role is also blank | The transition is invisible to everyone — no one can approve |

Always set a Fallback Role so approvals never get permanently stuck.

---

#### One-level vs two-level summary

**One level** — one approver per submitter:
- States: Draft → Pending Approval → Approved / Rejected
- Transitions: matrix on Approve/Reject at Level 1

**Two levels** — two sequential approvers per submitter:
- States: Draft → Pending Approval → Pending Level 2 Approval → Approved / Rejected
- Transitions: matrix on Level 1 transitions, then matrix on Level 2 transitions
- Employee chain must have both Level 1 and Level 2 rows filled

### Transition Conditions

Python expressions evaluated against `doc`:

```python
# Only allow if total exceeds 50,000
doc.grand_total > 50000

# Only allow if submitted within 30 days
doc.transaction_date >= frappe.utils.add_to_date(frappe.utils.now(), days=-30, as_string=True)

# Only if a specific field is filled
doc.custom_approval_notes not in (None, "")

# Based on a linked record's field value
frappe.db.get_value("Customer", doc.customer, "customer_group") == "VIP"
```

### Require Comment

On any transition (especially Reject), tick **Require Comment**.

- When the approver clicks that action, a dialog appears with a mandatory Comment field
- The comment is recorded in the document timeline
- The dialog cannot be submitted without filling in the comment

### Company Inheritance

```
Enfono Group (parent)
  ├── Enfono India
  └── Enfono UAE
```

Create one PM Workflow with `Company = Enfono Group` and `Allow Descendants = ✅`. It applies to all three companies. A child company can override by creating its own PM Workflow for the same DocType.

### Workflow Help button

Every form with an active PM Workflow gets a **Workflow Help** item in the actions menu. Clicking it shows:
- Current state
- Available next actions and who can perform them

### Bulk Approval

From a list view:
1. Select documents
2. Choose the action from the **Actions** menu
3. ≤ 20 docs → runs immediately with a progress bar
4. 21–500 docs → queued as a background job
5. Per-document result summary shown at the end

---

## 4. Admin Reassignment

### What it does

When a workflow action is stuck (the assigned approver is unavailable and no delegation record exists), a **System Manager** or **HR Manager** can manually redirect it to any other user — without modifying the workflow configuration.

### How to use it

1. Open the document that is stuck in a workflow state
2. A banner below the page title shows: **"Pending approval from: Khalid Ahmed"**
3. In the top-right **Workflow** button group, click **Reassign Approver**
4. A dialog appears:
   - **Current Approver** shown for reference
   - **Reassign To** — pick any active User
   - **Reason** — optional; added as a comment on the document
5. Click **Reassign**

### What happens

- The open **PM Workflow Action** record's `assigned_to` is updated to the new user
- An audit comment is added to the document timeline:
  ```
  🔄 Approver Reassigned
  From: Khalid Ahmed → To: Ali Hassan
  By: admin@company.com
  Reason: Khalid is on annual leave
  ```
- An email notification is sent to the new approver with a link to the document
- The reassigned user now sees the document in their pending approvals list

### Who can reassign

Only users with the **System Manager** or **HR Manager** role see the Reassign Approver button. It is hidden for all other roles.

---

## 5. Multi-level HR Approval

### What it does

Replaces Frappe's single-approver model for Leave Applications and Expense Claims with a dynamic chain that follows the `Reports To` hierarchy in Employee records.

```
Employee (submits)
  → Direct Manager (Forward / Reject)
      → Department Head (Forward / Reject)
          → HR Manager (Final Approve / Reject → Submit)
```

> **Note:** This feature requires the HRMS app to be installed. The PM Workflow engine (section 3) works independently of HRMS.

### Configuration

#### Step 1 — Enable in HR Settings

Tick:
- **Enable Multi-level Leave Approval**
- **Enable Multi-level Expense Claim Approval**

#### Step 2 — Set the reporting hierarchy

In each **Employee** record, set **Reports To** to their direct manager's Employee record. The chain is followed automatically.

#### Step 3 — Optional per-employee bypass

On an Employee record, tick **Disable Multi-level Approval** (in the Approval Chain tab) to use a single approver for that person.

### Leave Application — walkthrough

**Scenario:** Ravi applies for 3 days leave.

1. Ravi saves a Leave Application → `leave_approver` is auto-set to Priya (his direct manager)
2. Priya sees **Approve** and **Reject** buttons
3. Priya clicks **Approve** → status: Pending Next Approval, `leave_approver` → Ali (Priya's manager)
4. Ali clicks **Approve** → `leave_approver` → HR Manager
5. HR Manager clicks **Approve** → document submitted, status: Approved

At any step: clicking **Reject** opens a reason dialog, sets status to Rejected, and submits the document.

### Expense Claim — walkthrough

Same chain as Leave Application but applied to Expense Claims:
1. Submit → approver set to direct manager
2. Each manager forwards up the chain
3. HR Manager gives final approval and submits

### Custom fields added

| DocType | Field | Description |
|---|---|---|
| Leave Application | `custom_previous_approvers` | List of all prior approvers |
| Leave Application | `custom_rejection_reason` | Shown when status = Rejected |
| Expense Claim | `custom_previously_approved_by` | List of all prior approvers |
| Expense Claim | `custom_rejection_reason` | Shown when approval_status = Rejected |
| HR Settings | `enable_multi_level_leave_approval` | Feature toggle |
| HR Settings | `enable_multi_level_expense_claim_approval` | Feature toggle |
| Employee | `custom_disable_multilevel_approval` | Per-employee bypass toggle |

### Permission query behaviour

With the feature enabled, list views are filtered so each user sees only:
- Records they own (submitted by them)
- Records where they are the **current approver**
- Records where they appear in **previous approvers**

HR Managers, HR Users, and System Managers always see all records.

---

## 6. Permission Studio

### What it does

A visual dashboard at `/app/permission-studio` for System Managers to inspect and edit permissions without writing code.

### User View

See what a specific user can access across all DocTypes.

1. Select a **User** from the dropdown
2. Optionally filter by **Module** or use the **Search** box
3. The matrix shows one row per DocType with columns for each permission type

**Cell symbols:**

| Symbol | Colour | Meaning |
|---|---|---|
| ✓ | Green | Allowed unconditionally |
| ✗ | Red | No role grants this |
| ◐ | Amber | Allowed only if user owns the document |
| — | Gray | Not applicable for this DocType |

**"Why?" trace:** Click any cell to open a 6-step explanation:
1. Administrator check
2. Role permission check (which roles grant this, standard vs custom)
3. `if_owner` evaluation
4. User Permission restrictions
5. DocShare check
6. Final verdict with reason

**View Restrictions:** Opens a panel showing all User Permission rules and the last 100 DocShare records for this user.

### DocType View

See and edit all role permissions for a specific DocType.

1. Select a **DocType**
2. The matrix shows all roles with their full permission row
3. Click **Edit Permissions** to enter edit mode

**On first edit:** Standard perms are copied to Custom DocPerm automatically. A yellow hint bar confirms edit mode is active.

**Editing:**
- Click any ✓/✗ cell → flips and saves instantly
- Click the **Owner** column circle → toggles `if_owner`
- **+ Add Role** → dialog to pick role and permission level → row inserted with read=1
- Hover a row → trash icon appears → click to delete the role row
- **Reset to Standard** (red button) → deletes all custom perms, restores standard

**Bulk apply:** Enter a list of DocTypes in the bulk dialog to apply the same role permissions across all of them in one step.

### Role View

See everything a role can access, grouped by module.

1. Select a **Role**
2. Shows: user count, total DocTypes, per-module tables
3. Each module lists every DocType the role touches with its full permission bits

Edit mode is also available in Role View — change permissions for the selected role across all DocTypes from one place.

### Who Can? (Reverse Lookup)

**Tab: "Who Can?"**

Find out which users (via their roles) have a specific permission on a DocType.

1. Select a **DocType** and a **Permission Type** (read, write, delete…)
2. A grid of user cards appears — each card shows the user's name, email, and which roles grant them this access

Use this to audit: "Who can delete Sales Invoices?"

### Role Comparison

**Tab: "Compare"**

Compare two roles side-by-side across all DocTypes.

1. Select **Role 1** and **Role 2**
2. A merged table shows both roles' permissions per DocType
3. Toggle **Diff Only** to hide rows where both roles are identical (focus on differences)

Use this before assigning a new role to verify it doesn't grant more than intended.

### Health Dashboard

**Tab: "Health"**

System-wide permission health overview:

- **Score** (0–100): penalises roles that have excessive permissions on sensitive DocTypes
- **Tiles:** Total custom perms, orphaned User Permissions (no matching record), DocTypes with no permissions, over-privileged roles
- **Simulate User Access** → pick a user → see a module-by-module breakdown of what they can access

### CSV Export

From the DocType View, Role View, or Comparison, click **Export CSV** to download the current matrix as a spreadsheet.

---

## 7. API Reference

All methods are `@frappe.whitelist()` and require appropriate role unless stated.

### Employee Approver Matrix

```python
# Resolve the effective approver for a submitter at a given level
# (internal — called automatically by the workflow engine)
from permission_manager.permission_manager.workflow import resolve_approver

approver = resolve_approver(
    submitter_user="ahmed@company.com",
    level=1,
    doctype="Purchase Order",
    workflow_name="PO Approval - Company A"
)
# Returns: "khalid@company.com" (or substitute if delegation active)
```

### PM Workflow Engine

```javascript
// Get active workflow name for a document
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_workflow_name",
    args: { doctype: "Purchase Order", docname: "PUR-ORD-2026-00001" }
})

// Get transitions available to the current user
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_transitions",
    args: { doc: frm.doc }
})

// Apply a workflow action with optional comment
frappe.call({
    method: "permission_manager.permission_manager.workflow.apply_workflow",
    args: { doc: frm.doc, action: "Approve", comment: "Looks good." }
})

// Bulk approve up to 500 documents
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
// Reassign a pending approval to a different user (System Manager / HR Manager only)
frappe.call({
    method: "permission_manager.permission_manager.workflow.reassign_workflow_approver",
    args: {
        doctype: "Purchase Order",
        docname: "PUR-ORD-2026-00001",
        new_approver: "ali@company.com",
        reason: "Khalid is on leave"
    }
})
// Returns: { success: true, action: "NWA-0001", old_approver: "khalid@company.com", new_approver: "ali@company.com" }

// Get the current pending approver for a document
frappe.call({
    method: "permission_manager.permission_manager.workflow.get_pending_workflow_action",
    args: { doctype: "Purchase Order", docname: "PUR-ORD-2026-00001" }
})
// Returns: { name, assigned_to, assigned_to_name, workflow_state }
```

### Permission Studio — Read

```javascript
// Full permission matrix for a user
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_user_matrix",
    args: { user: "john@example.com", module: "Accounts" }  // module optional
})

// All roles and permissions for a DocType
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
    args: { doctype: "Sales Invoice" }
})

// All DocTypes a role can access
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.get_role_matrix",
    args: { role: "Accounts Manager" }
})

// Why does a user have/not have a permission?
frappe.call({
    method: "permission_manager.permission_manager.api.resolver.explain_permission",
    args: { user: "john@example.com", doctype: "Sales Invoice", ptype: "delete" }
})

// Who has a permission on a DocType?
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.get_users_with_permission",
    args: { doctype: "Sales Invoice", ptype: "delete" }
})

// Compare two roles side by side
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.compare_roles",
    args: { role1: "Accounts Manager", role2: "Accounts User" }
})

// System permission health stats
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.get_permission_health"
})

// Simulate what a user can access (module breakdown)
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.simulate_user_access",
    args: { user: "john@example.com" }
})
```

### Permission Studio — Write

```javascript
// Initialise custom perms (copy standard → custom)
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.init_custom_perms",
    args: { doctype: "Delivery Note" }
})

// Toggle a single permission bit
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.update_permission",
    args: { doctype: "Delivery Note", role: "Logistics Manager", permlevel: 0, ptype: "print", value: 1 }
})

// Toggle if_owner flag
frappe.call({
    method: "permission_manager.permission_manager.api.matrix.update_if_owner",
    args: { doctype: "Delivery Note", role: "Logistics Manager", permlevel: 0, value: 1 }
})

// Add a new role row (read=1 by default)
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

// Apply the same role permissions to multiple DocTypes at once
frappe.call({
    method: "permission_manager.permission_manager.api.lookup.bulk_apply_role_permissions",
    args: {
        doctypes: ["Delivery Note", "Purchase Receipt", "Stock Entry"],
        role: "Warehouse Manager",
        permissions: { read: 1, write: 1, create: 1, delete: 0 }
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

## 8. Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| "Approval Chain" tab not visible in Employee | Custom fields not imported | Run `bench execute permission_manager.permission_manager.install.import_fixtures` |
| Fields from Salary tab appearing inside Approval Chain tab | Wrong `insert_after` value in custom field | Run `bench execute permission_manager.permission_manager.install.fix_approval_tab_position` then `bench execute frappe.clear_cache` |
| PM Workflow buttons not appearing on form | No active PM Workflow for that DocType + Company, or wrong company on document | Create an PM Workflow with `Is Active = 1` for the correct Company |
| Approve/Reject button visible to wrong user | Transition's `use_approver_matrix` not ticked, or Employee Approval Chain not configured | Tick `Use Approver Matrix` on the transition; add rows to the submitter's Approval Chain |
| All Purchase Managers can approve instead of specific person | Transition does not use Employee Approver Matrix | Tick `Use Approver Matrix`; ensure submitter has an Employee record with the chain filled |
| Delegation not working | `Is Active` not ticked, or dates wrong, or date range doesn't include today | Check PM Approver Delegation record: Is Active = ✅, From/To dates bracket today |
| "Reassign Approver" button not visible | User lacks System Manager or HR Manager role | Assign one of those roles |
| ProgrammingError on PM Workflow table | `bench migrate` not run yet | Run `bench --site <site> migrate` |
| PM Workflow actions not created on save | No active workflow found, or `process_workflow_actions` hook not firing | Check `doc_events.*` in hooks.py; verify the PM Workflow is active |
| Multi-level HR approval not working | HRMS not installed, or HR Settings toggles off | Install HRMS; enable toggles in HR Settings |
| Permission Studio blank | User not System Manager | Assign System Manager role |
| Assets not loading after install | JS/CSS not built | Run `bench build --app permission_manager` |
| Changes in Permission Studio not saving | Redis cache stale | Run `bench clear-cache` or hard-reload browser |
