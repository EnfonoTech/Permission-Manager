# Permission Manager

**Author:** siva <siva@enfono.com>  
**License:** MIT  
**Frappe Compatibility:** v14 / v15+  

A unified Frappe custom app that combines three powerful modules into one:

1. **Multi-level HR Approval** — ladder-style approval chains for Leave Applications and Expense Claims  
2. **PM Workflow Engine** — company-scoped, dimension-aware, comment-enabled workflow system  
3. **Permission Studio** — visual permission matrix dashboard for System Managers  

---

## Installation

```bash
cd /home/gym/new-bench
bench get-app permission_manager /path/to/permission_manager  # or via git
bench --site your-site.local install-app permission_manager
bench --site your-site.local migrate
bench build --app permission_manager
```

---

## Feature 1 — Multi-level HR Approval

### Overview

Replaces the single-approver model for Leave Applications and Expense Claims with a full ladder-style approval chain based on the employee reporting hierarchy (`Reports To` in Employee master).

### How It Works

1. Employee submits a Leave Application or Expense Claim.  
2. The system auto-assigns the employee's direct manager as the first approver.  
3. Each approver can **Forward** (to the next manager up the chain) or **Reject** (with a mandatory reason).  
4. HR Managers and Administrators perform **final approval** (submits the document).  
5. A history of all previous approvers is tracked automatically.  

### Configuration

Enable in **HR Settings:**

| Field | Description |
|---|---|
| Enable Multi-level Leave Approval | Activates ladder approval for Leave Applications |
| Enable Multi-level Expense Claim Approval | Activates ladder approval for Expense Claims |

**Per-employee opt-out:** Set **Disable Multi-level Approval** on the Employee record.

### Status Flow

```
Leave Application:    Open → Pending Next Approval → ... → Approved / Rejected
Expense Claim:        Draft → Pending Next Approval → ... → Approved / Rejected
```

### Email Notifications

Bundled notifications fire automatically:
- Next approver notified on forward  
- Applicant notified on final Approved / Rejected  

### API Methods

| Method | Description |
|---|---|
| `permission_manager.permission_manager.ladder_approve.leave_application.api.forward_leave` | Forward or final-approve a Leave Application |
| `permission_manager.permission_manager.ladder_approve.leave_application.api.reject_leave` | Reject a Leave Application |
| `permission_manager.permission_manager.ladder_approve.expense_claim.api.forward_expense_claim` | Forward or final-approve an Expense Claim |
| `permission_manager.permission_manager.ladder_approve.expense_claim.api.reject_expense_claim` | Reject an Expense Claim |

---

## Feature 2 — PM Workflow Engine

### Overview

An enhanced workflow system extending Frappe's built-in workflows with:

- **Company-level scoping** — different workflows per company, with parent fallback via `Allow Descendants`
- **User-specific workflows** — applies only to documents from a specific user
- **Accounting dimension routing** — route by Cost Center, Project, or custom dimensions
- **Priority-based resolution** — User > Accounting Dimension > Cost Center > Project > Company
- **Comment support** — optional or required comment per transition
- **Bulk approval** — approve up to 500 documents at once (background for large batches)
- **Email alerts** — per-state email templates with PDF attachment

### DocTypes

| DocType | Description |
|---|---|
| PM Workflow | Main workflow definition (states + transitions) |
| PM Workflow Document State | State definitions with docstatus, edit permissions, email triggers |
| PM Workflow Transition | Action definitions with approver type (Role/User), conditions |
| PM Workflow Action | Tracks pending approvals per document |
| PM Workflow Action Permitted Role | Roles/users permitted to act on a workflow action |

### Creating a Workflow

1. Go to **PM Workflow → New**
2. Set **Document Type**, **Company**, and optionally **User**, **Project**, **Cost Center**
3. Add **States** (e.g., Draft → Pending Approval → Approved)
4. Add **Transitions** (e.g., "Approve" from "Pending" → "Approved", Role: "Purchase Manager")
5. Enable **Is Active** and save

### Transition Conditions (Python)

```python
# Example: only allow approval if total exceeds 5000
doc.grand_total > 5000
```

Available: `frappe.db.get_value`, `frappe.db.get_list`, `frappe.session`, `frappe.utils.*`

### API Methods

| Method | Description |
|---|---|
| `permission_manager.permission_manager.workflow.get_workflow_name` | Resolve active workflow for a document |
| `permission_manager.permission_manager.workflow.get_transitions` | Get allowed transitions for current user |
| `permission_manager.permission_manager.workflow.apply_workflow` | Execute a workflow action |
| `permission_manager.permission_manager.workflow.bulk_workflow_approval` | Bulk-apply a workflow action |
| `permission_manager.permission_manager.workflow.get_workflow_info` | Get workflow state info for the UI |

---

## Feature 3 — Permission Studio

### Overview

A visual dashboard at `/app/permission-studio` for System Managers to inspect effective permissions.

**Three views:**

| View | Description |
|---|---|
| User View | Full permission matrix for a user across all DocTypes |
| DocType View | All roles and their permissions for a specific DocType |
| Role View | All DocTypes a role can access, grouped by module |

**"Why?" Explainer:** Click any cell in User View to trace exactly why a permission is allowed, conditional, or denied — including role checks, `if_owner` conditions, User Permissions, and DocShare records.

**Restrictions & Shares panel:** Click **View Restrictions** to inspect User Permission restrictions and DocShare records for any user.

### Access

System Manager role required. Navigate to `/app/permission-studio`.

### API Methods

| Method | Description |
|---|---|
| `permission_manager.permission_manager.api.matrix.get_user_matrix` | Full permission matrix for a user |
| `permission_manager.permission_manager.api.matrix.get_doctype_matrix` | Permission matrix for a DocType |
| `permission_manager.permission_manager.api.matrix.get_role_matrix` | Permission matrix for a role |
| `permission_manager.permission_manager.api.resolver.explain_permission` | Step-by-step permission trace |
| `permission_manager.permission_manager.api.restrictions.get_user_restrictions` | User Permission restrictions |
| `permission_manager.permission_manager.api.restrictions.get_user_shares` | DocShare records for a user |

---

## File Structure

```
permission_manager/
├── permission_manager/
│   ├── hooks.py                              ← All hooks wired here
│   ├── modules.txt
│   ├── workflow.py                           ← PM Workflow engine
│   │
│   ├── ladder_approve/                       ← Multi-level approval
│   │   ├── utils.py
│   │   ├── leave_application/api.py
│   │   └── expense_claim/api.py
│   │
│   ├── api/                                  ← Permission Studio APIs
│   │   ├── matrix.py
│   │   ├── resolver.py
│   │   └── restrictions.py
│   │
│   ├── permission_manager/                   ← Module folder
│   │   ├── doctype/
│   │   │   ├── pm_workflow/
│   │   │   ├── pm_workflow_action/
│   │   │   ├── pm_workflow_action_permitted_role/
│   │   │   ├── pm_workflow_document_state/
│   │   │   └── pm_workflow_transition/
│   │   └── page/
│   │       └── permission_studio/
│   │
│   ├── fixtures/
│   │   ├── custom_field.json                 ← Custom fields for Leave, Expense, HR Settings, Employee
│   │   ├── notification.json                 ← Email notifications
│   │   └── property_setter.json             ← Status field options
│   │
│   └── public/
│       ├── js/
│       │   ├── leave_application.js          ← Leave approval UI
│       │   ├── expense_claim.js              ← Expense approval UI
│       │   ├── pm_workflow.js                ← Workflow action buttons (desk-wide)
│       │   ├── permission_manager.bundle.js  ← Permission Studio UI
│       │   ├── components/
│       │   │   ├── matrix_view.js
│       │   │   ├── role_explorer.js
│       │   │   ├── user_explorer.js
│       │   │   └── why_explainer.js
│       │   └── utils/helpers.js
│       └── scss/
│           └── permission_manager.bundle.scss
```

---

## After Installation

```bash
# Build frontend assets
bench build --app permission_manager

# Import fixtures (custom fields, notifications, property setters)
bench --site your-site.local import-fixtures --app permission_manager

# Then:
# 1. Enable Multi-level Approval in HR Settings
# 2. Create PM Workflows via the PM Workflow list
# 3. Visit /app/permission-studio as System Manager
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Approve/Reject buttons not showing | Check HR Settings toggles and employee `Reports To` |
| PM Workflow not loading | Ensure workflow `Is Active` is checked and company matches |
| Permission Studio blank | Confirm System Manager role is assigned |
| Assets not loading | Run `bench build --app permission_manager` |

---

## Contributing

```bash
cd apps/permission_manager
pre-commit install
```

Uses `ruff`, `eslint`, `prettier`, `pyupgrade`.

## License

MIT
