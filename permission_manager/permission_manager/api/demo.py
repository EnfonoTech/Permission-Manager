"""
Permission Manager — Demo Setup & Teardown
Author: siva <siva@enfono.com>

Creates a complete working demo of PM Workflow with Employee Approver Matrix.
All demo records are prefixed with PM-DEMO for clean teardown.
"""

import frappe
from frappe import _
from frappe.utils import add_days, today

_DEMO_USERS = [
    {"email": "demo.submitter@pm-demo.test",  "first_name": "Demo", "last_name": "Submitter"},
    {"email": "demo.approver1@pm-demo.test",  "first_name": "Demo", "last_name": "Approver L1"},
    {"email": "demo.approver2@pm-demo.test",  "first_name": "Demo", "last_name": "Approver L2"},
]

_DEMO_STATES = [
    {"workflow_state_name": "PM Demo Draft",      "style": "Warning"},
    {"workflow_state_name": "PM Demo Pending L1", "style": "Warning"},
    {"workflow_state_name": "PM Demo Pending L2", "style": "Warning"},
    {"workflow_state_name": "PM Demo Approved",   "style": "Success"},
    {"workflow_state_name": "PM Demo Rejected",   "style": "Danger"},
]

_DEMO_ACTIONS = [
    {"workflow_action_name": "PM Demo Submit"},
    {"workflow_action_name": "PM Demo Approve"},
    {"workflow_action_name": "PM Demo Reject"},
]

_SUBMITTER  = "demo.submitter@pm-demo.test"
_APPROVER1  = "demo.approver1@pm-demo.test"
_APPROVER2  = "demo.approver2@pm-demo.test"
_WF_NAME    = "PM-DEMO-Note-Approval"
_NOTE_TITLE = "PM Demo — Sample Note for Approval"
_CF_NAME    = "Note-pm_demo_workflow_state"


# ─── Status ──────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_demo_status():
    wf      = bool(frappe.db.exists("PM Workflow", _WF_NAME))
    users   = all(frappe.db.exists("User", u["email"]) for u in _DEMO_USERS)
    emp     = bool(frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name"))
    deleg   = bool(frappe.db.exists("PM Approver Delegation", {"original_approver": _APPROVER1}))
    note_name = frappe.db.get_value("Note", {"title": _NOTE_TITLE}, "name")
    note    = bool(note_name)
    cf      = bool(frappe.db.exists("Custom Field", _CF_NAME))

    return {
        "is_setup": wf and users and emp,
        "checks": {
            "Demo Users (3)":            users,
            "Demo Employee + Chain":     emp,
            "PM Workflow":               wf,
            "Custom Field on Note":      cf,
            "Approver Delegation":       deleg,
            "Sample Note":               note,
        },
        "links": {
            "workflow":   f"/app/pm-workflow/{_WF_NAME}"   if wf   else None,
            "submitter":  f"/app/user/{_SUBMITTER}"        if users else None,
            "approver1":  f"/app/user/{_APPROVER1}"        if users else None,
            "approver2":  f"/app/user/{_APPROVER2}"        if users else None,
            "note":       f"/app/note/{note_name}"          if note  else None,
            "delegation": "/app/pm-approver-delegation"    if deleg else None,
        },
    }


# ─── Setup ───────────────────────────────────────────────────────────────────

@frappe.whitelist()
def setup_demo():
    frappe.only_for("System Manager")
    log = []

    # Suppress background job enqueuing during setup (some hooks enqueue Redis jobs)
    _real_enqueue = frappe.enqueue
    frappe.enqueue = lambda *a, **kw: None

    try:
        # 1. Users
        for u in _DEMO_USERS:
            if not frappe.db.exists("User", u["email"]):
                frappe.get_doc({
                    "doctype": "User",
                    "email": u["email"],
                    "first_name": u["first_name"],
                    "last_name": u["last_name"],
                    "enabled": 1,
                    "send_welcome_email": 0,
                    "roles": [{"role": "Desk User"}],
                }).insert(ignore_permissions=True)
                log.append(f"Created User: {u['email']}")
            else:
                log.append(f"User already exists: {u['email']}")

        # 2. Company (required by PM Workflow)
        company = frappe.db.get_value("Company", {}, "name")
        if not company:
            return {"success": False, "log": log,
                    "error": "No Company found — please create one first."}

        # 3. Employee for the submitter
        emp_name = frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name")
        if not emp_name:
            emp_doc = frappe.get_doc({
                "doctype": "Employee",
                "first_name": "Demo Submitter",
                "company": company,
                "user_id": _SUBMITTER,
                "status": "Active",
                "gender": "Male",
                "date_of_birth": "1990-01-01",
                "date_of_joining": "2020-01-01",
            })
            emp_doc.insert(ignore_permissions=True)
            emp_name = emp_doc.name
            log.append(f"Created Employee: {emp_name}")
        else:
            log.append(f"Employee exists: {emp_name}")

        # 4. Approval Chain (Level 1 → approver1, Level 2 → approver2)
        emp_doc = frappe.get_doc("Employee", emp_name)
        emp_doc.set("pm_approval_chain", [
            {"level": 1, "approver": _APPROVER1, "applies_to": "All DocTypes"},
            {"level": 2, "approver": _APPROVER2, "applies_to": "All DocTypes"},
        ])
        emp_doc.save(ignore_permissions=True)
        log.append("Set Approval Chain: L1 → Approver L1, L2 → Approver L2")

        # 5. Workflow States
        for ws in _DEMO_STATES:
            sname = ws["workflow_state_name"]
            if not frappe.db.exists("Workflow State", sname):
                frappe.get_doc({"doctype": "Workflow State", **ws}).insert(ignore_permissions=True)
                log.append(f"Created Workflow State: {sname}")

        # 6. Workflow Actions
        for wa in _DEMO_ACTIONS:
            aname = wa["workflow_action_name"]
            if not frappe.db.exists("Workflow Action Master", aname):
                frappe.get_doc({"doctype": "Workflow Action Master", **wa}).insert(ignore_permissions=True)
                log.append(f"Created Workflow Action: {aname}")

        # 7. Note DocPerm — ensure Desk User has read+write+create on Note without if_owner restriction
        _NOTE_PERM_ROLE = "Desk User"
        # Check specifically for a row that has write=1 and if_owner=0 (unrestricted write)
        unrestricted_write = frappe.db.get_value(
            "Custom DocPerm",
            {"parent": "Note", "role": _NOTE_PERM_ROLE, "permlevel": 0, "if_owner": 0, "write": 1},
            "name",
        )
        if not unrestricted_write:
            frappe.get_doc({
                "doctype": "Custom DocPerm",
                "parent": "Note",
                "parenttype": "DocType",
                "parentfield": "permissions",
                "role": _NOTE_PERM_ROLE,
                "permlevel": 0,
                "read": 1,
                "write": 1,
                "create": 1,
                "delete": 1,
                "if_owner": 0,
            }).insert(ignore_permissions=True)
            frappe.clear_cache(doctype="Note")
            log.append(f"Granted Note write permissions to role: {_NOTE_PERM_ROLE}")
        else:
            log.append(f"Note write permissions already set for: {_NOTE_PERM_ROLE}")

        # 8. Custom Field: workflow_state on Note
        if not frappe.db.exists("Custom Field", _CF_NAME):
            frappe.get_doc({
                "doctype": "Custom Field",
                "name": _CF_NAME,
                "dt": "Note",
                "fieldname": "pm_demo_workflow_state",
                "fieldtype": "Data",
                "label": "Workflow State",
                "read_only": 1,
                "in_list_view": 1,
                "insert_after": "title",
            }).insert(ignore_permissions=True)
            frappe.clear_cache(doctype="Note")
            log.append("Created Custom Field: Note.pm_demo_workflow_state")

        # 8. PM Workflow
        if not frappe.db.exists("PM Workflow", _WF_NAME):
            frappe.get_doc({
                "doctype": "PM Workflow",
                "workflow_name": _WF_NAME,
                "document_type": "Note",
                "workflow_state_field": "pm_demo_workflow_state",
                "company": company,
                "is_active": 1,
                "send_email_alert": 0,
                "states": [
                    {"state": "PM Demo Draft",      "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "Desk User"},
                    {"state": "PM Demo Pending L1", "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    {"state": "PM Demo Pending L2", "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    {"state": "PM Demo Approved",   "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    {"state": "PM Demo Rejected",   "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                ],
                "transitions": [
                    {
                        "state": "PM Demo Draft",
                        "action": "PM Demo Submit",
                        "next_state": "PM Demo Pending L1",
                        "approver_type": "Role",
                        "allowed": "Desk User",
                        "allow_self_approval": 1,
                        "use_approver_matrix": 0,
                    },
                    {
                        "state": "PM Demo Pending L1",
                        "action": "PM Demo Approve",
                        "next_state": "PM Demo Pending L2",
                        "use_approver_matrix": 1,
                        "matrix_level": 1,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                    },
                    {
                        "state": "PM Demo Pending L1",
                        "action": "PM Demo Reject",
                        "next_state": "PM Demo Rejected",
                        "use_approver_matrix": 1,
                        "matrix_level": 1,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                        "require_comment": 1,
                    },
                    {
                        "state": "PM Demo Pending L2",
                        "action": "PM Demo Approve",
                        "next_state": "PM Demo Approved",
                        "use_approver_matrix": 1,
                        "matrix_level": 2,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                    },
                    {
                        "state": "PM Demo Pending L2",
                        "action": "PM Demo Reject",
                        "next_state": "PM Demo Rejected",
                        "use_approver_matrix": 1,
                        "matrix_level": 2,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                        "require_comment": 1,
                    },
                    # Re-submit after rejection
                    {
                        "state": "PM Demo Rejected",
                        "action": "PM Demo Submit",
                        "next_state": "PM Demo Pending L1",
                        "approver_type": "Role",
                        "allowed": "Desk User",
                        "allow_self_approval": 1,
                        "use_approver_matrix": 0,
                    },
                ],
            }).insert(ignore_permissions=True)
            log.append(f"Created PM Workflow: {_WF_NAME}")
        else:
            log.append(f"PM Workflow exists: {_WF_NAME}")

        # 9. PM Approver Delegation (approver1 OOO → approver2, active for 7 days)
        if not frappe.db.exists("PM Approver Delegation", {"original_approver": _APPROVER1}):
            frappe.get_doc({
                "doctype": "PM Approver Delegation",
                "original_approver": _APPROVER1,
                "substitute_approver": _APPROVER2,
                "from_date": today(),
                "to_date": add_days(today(), 7),
                "is_active": 1,
                "scope": "All DocTypes",
                "reason": "Demo — shows delegation/OOO cover feature",
                "delegated_by": frappe.session.user,
            }).insert(ignore_permissions=True)
            log.append(f"Created PM Approver Delegation: {_APPROVER1} → {_APPROVER2} (7 days)")

        # 10. Sample Note in Draft state
        if not frappe.db.get_value("Note", {"title": _NOTE_TITLE}, "name"):
            note_doc = frappe.get_doc({
                "doctype": "Note",
                "owner": _SUBMITTER,
                "title": _NOTE_TITLE,
                "content": (
                    "<p>This is a demo Note used to showcase PM Workflow with Employee Approver Matrix.</p>"
                    "<p><strong>What to try:</strong></p>"
                    "<ol>"
                    "<li>Log in as <em>demo.submitter@pm-demo.test</em> and click <strong>PM Demo Submit</strong>.</li>"
                    "<li>Log in as <em>demo.approver1@pm-demo.test</em> and click <strong>PM Demo Approve</strong>.</li>"
                    "<li>Log in as <em>demo.approver2@pm-demo.test</em> and click <strong>PM Demo Approve</strong>.</li>"
                    "</ol>"
                    "<p>Notice that only the mapped approver sees the action buttons — not anyone else in the role.</p>"
                ),
                "pm_demo_workflow_state": "PM Demo Draft",
                "public": 0,
            })
            note_doc.insert(ignore_permissions=True)
            frappe.db.set_value("Note", note_doc.name, "owner", _SUBMITTER)
            log.append(f"Created Sample Note: {note_doc.name} (title: {_NOTE_TITLE})")

        frappe.db.commit()
        return {"success": True, "log": log}

    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="PM Demo Setup Failed")
        return {"success": False, "log": log, "error": frappe.get_traceback()}

    finally:
        frappe.enqueue = _real_enqueue


# ─── Teardown ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def teardown_demo():
    frappe.only_for("System Manager")
    log = []

    _real_enqueue = frappe.enqueue
    frappe.enqueue = lambda *a, **kw: None

    try:
        def _del(doctype, name_or_filters, label=None):
            if isinstance(name_or_filters, dict):
                rows = frappe.get_all(doctype, filters=name_or_filters, pluck="name")
            else:
                rows = [name_or_filters] if frappe.db.exists(doctype, name_or_filters) else []
            for n in rows:
                frappe.delete_doc(doctype, n, ignore_permissions=True, force=True)
                log.append(f"Deleted {label or doctype}: {n}")

        # Workflow actions on Note first (child of the workflow)
        for r in frappe.get_all("PM Workflow Action",
                                filters={"reference_doctype": "Note"},
                                pluck="name"):
            frappe.delete_doc("PM Workflow Action", r, ignore_permissions=True, force=True)
        log.append("Deleted PM Workflow Action records for Note")

        note_name = frappe.db.get_value("Note", {"title": _NOTE_TITLE}, "name")
        if note_name:
            _del("Note", note_name)
        _del("PM Workflow",           _WF_NAME)
        _del("PM Approver Delegation", {"original_approver": _APPROVER1})

        emp = frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name")
        if emp:
            _del("Employee", emp)

        # Remove Note DocPerm added for demo
        note_perm = frappe.db.exists(
            "Custom DocPerm", {"parent": "Note", "role": "Desk User", "permlevel": 0}
        )
        if note_perm:
            frappe.delete_doc("Custom DocPerm", note_perm, ignore_permissions=True, force=True)
            frappe.clear_cache(doctype="Note")
            log.append("Removed Note permission for Desk User role")

        if frappe.db.exists("Custom Field", _CF_NAME):
            frappe.delete_doc("Custom Field", _CF_NAME, ignore_permissions=True, force=True)
            frappe.clear_cache(doctype="Note")
            log.append(f"Deleted Custom Field: {_CF_NAME}")

        for ws in _DEMO_STATES:
            _del("Workflow State", ws["workflow_state_name"])

        for wa in _DEMO_ACTIONS:
            _del("Workflow Action Master", wa["workflow_action_name"])

        for u in _DEMO_USERS:
            _del("User", u["email"])

        frappe.db.commit()
        return {"success": True, "log": log}

    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="PM Demo Teardown Failed")
        return {"success": False, "log": log, "error": frappe.get_traceback()}

    finally:
        frappe.enqueue = _real_enqueue
