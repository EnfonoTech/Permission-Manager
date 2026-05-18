"""
Permission Manager — Purchase Invoice Demo Setup & Teardown
Author: siva <siva@enfono.com>

Creates a complete 2-level Purchase Invoice approval demo using the
Employee Approver Matrix.  All demo records use the PM-PI-DEMO prefix.
"""

import frappe
from frappe.utils import add_days, today

# ── Constants ────────────────────────────────────────────────────────────────

_SUBMITTER  = "pi.submitter@pm-demo.test"
_APPROVER1  = "pi.approver1@pm-demo.test"
_APPROVER2  = "pi.approver2@pm-demo.test"

_DEMO_USERS = [
    {"email": _SUBMITTER, "first_name": "PI",  "last_name": "Submitter"},
    {"email": _APPROVER1, "first_name": "PI",  "last_name": "Approver L1"},
    {"email": _APPROVER2, "first_name": "PI",  "last_name": "Approver L2"},
]

_DEMO_STATES = [
    {"workflow_state_name": "PI Draft",         "style": "Warning"},
    {"workflow_state_name": "PI Pending L1",    "style": "Warning"},
    {"workflow_state_name": "PI Pending L2",    "style": "Warning"},
    {"workflow_state_name": "PI Approved",      "style": "Success"},
    {"workflow_state_name": "PI Rejected",      "style": "Danger"},
]

_DEMO_ACTIONS = [
    {"workflow_action_name": "PI Submit for Approval"},
    {"workflow_action_name": "PI Approve"},
    {"workflow_action_name": "PI Reject"},
]

_WF_NAME       = "PM-PI-DEMO-Approval"
_CF_NAME       = "Purchase Invoice-pm_pi_workflow_state"
_SUPPLIER_NAME = "PM-PI-Demo-Supplier"
_PI_TITLE      = "PM-PI-DEMO"           # used as a title prefix to find demo PIs


# ── Status ───────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_pi_demo_status():
    wf     = bool(frappe.db.exists("PM Workflow", _WF_NAME))
    users  = all(frappe.db.exists("User", u["email"]) for u in _DEMO_USERS)
    emp    = bool(frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name"))
    cf     = bool(frappe.db.exists("Custom Field", _CF_NAME))
    sup    = bool(frappe.db.exists("Supplier", _SUPPLIER_NAME))
    pi_name = frappe.db.get_value(
        "Purchase Invoice", {"supplier": _SUPPLIER_NAME, "docstatus": 0}, "name"
    )

    return {
        "is_setup": wf and users and emp and cf,
        "checks": {
            "Demo Users (3)":             users,
            "Demo Employee + Chain":      emp,
            "Demo Supplier":              sup,
            "Custom Field on Purchase Invoice": cf,
            "PM Workflow":                wf,
            "Sample Purchase Invoice":    bool(pi_name),
        },
        "links": {
            "workflow":  f"/app/pm-workflow/{_WF_NAME}"                  if wf      else None,
            "submitter": f"/app/user/{_SUBMITTER}"                       if users   else None,
            "approver1": f"/app/user/{_APPROVER1}"                       if users   else None,
            "approver2": f"/app/user/{_APPROVER2}"                       if users   else None,
            "pi":        f"/app/purchase-invoice/{pi_name}"              if pi_name else None,
            "supplier":  f"/app/supplier/{_SUPPLIER_NAME}"               if sup     else None,
        },
    }


# ── Setup ────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def setup_pi_demo():
    frappe.only_for("System Manager")
    log = []

    _real_enqueue = frappe.enqueue
    frappe.enqueue = lambda *a, **kw: None

    try:
        # 1. Users (Accounts User role so they can access Purchase Invoice)
        for u in _DEMO_USERS:
            if not frappe.db.exists("User", u["email"]):
                frappe.get_doc({
                    "doctype": "User",
                    "email": u["email"],
                    "first_name": u["first_name"],
                    "last_name": u["last_name"],
                    "enabled": 1,
                    "send_welcome_email": 0,
                    "roles": [
                        {"role": "Desk User"},
                        {"role": "Accounts User"},
                    ],
                }).insert(ignore_permissions=True)
                log.append(f"Created User: {u['email']}")
            else:
                log.append(f"User exists: {u['email']}")

        # 2. Company + currency
        company = frappe.db.get_value("Company", {}, "name")
        if not company:
            return {"success": False, "log": log, "error": "No Company found."}
        currency = frappe.db.get_value("Company", company, "default_currency") or "SAR"

        # 3. Employee for submitter
        emp_name = frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name")
        if not emp_name:
            emp_doc = frappe.get_doc({
                "doctype": "Employee",
                "first_name": "PI Submitter",
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

        # 4. Approval Chain
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

        # 7. Purchase Invoice DocPerm — ensure Accounts User can read+write+create
        pi_write_perm = frappe.db.get_value(
            "Custom DocPerm",
            {"parent": "Purchase Invoice", "role": "Accounts User", "if_owner": 0, "write": 1},
            "name",
        )
        if not pi_write_perm:
            frappe.get_doc({
                "doctype": "Custom DocPerm",
                "parent": "Purchase Invoice",
                "parenttype": "DocType",
                "parentfield": "permissions",
                "role": "Accounts User",
                "permlevel": 0,
                "read": 1,
                "write": 1,
                "create": 1,
                "delete": 0,
                "if_owner": 0,
            }).insert(ignore_permissions=True)
            frappe.clear_cache(doctype="Purchase Invoice")
            log.append("Granted Purchase Invoice read+write to Accounts User")
        else:
            log.append("Purchase Invoice permissions OK for Accounts User")

        # 8. Custom Field: pm_pi_workflow_state on Purchase Invoice
        if not frappe.db.exists("Custom Field", _CF_NAME):
            frappe.get_doc({
                "doctype": "Custom Field",
                "name": _CF_NAME,
                "dt": "Purchase Invoice",
                "fieldname": "pm_pi_workflow_state",
                "fieldtype": "Data",
                "label": "Approval State",
                "read_only": 1,
                "in_list_view": 1,
                "insert_after": "status",
            }).insert(ignore_permissions=True)
            frappe.clear_cache(doctype="Purchase Invoice")
            log.append("Created Custom Field: Purchase Invoice.pm_pi_workflow_state")

        # 9. Demo Supplier
        if not frappe.db.exists("Supplier", _SUPPLIER_NAME):
            frappe.get_doc({
                "doctype": "Supplier",
                "supplier_name": _SUPPLIER_NAME,
                "supplier_group": frappe.db.get_value("Supplier Group", {}, "name") or "All Supplier Groups",
                "supplier_type": "Company",
            }).insert(ignore_permissions=True)
            log.append(f"Created Supplier: {_SUPPLIER_NAME}")
        else:
            log.append(f"Supplier exists: {_SUPPLIER_NAME}")

        # 10. PM Workflow for Purchase Invoice
        if not frappe.db.exists("PM Workflow", _WF_NAME):
            frappe.get_doc({
                "doctype": "PM Workflow",
                "workflow_name": _WF_NAME,
                "document_type": "Purchase Invoice",
                "workflow_state_field": "pm_pi_workflow_state",
                "company": company,
                "is_active": 1,
                "send_email_alert": 0,
                "states": [
                    # doc_status 0 = Draft, 1 = Submitted, 2 = Cancelled
                    {"state": "PI Draft",      "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "Accounts User"},
                    {"state": "PI Pending L1", "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    {"state": "PI Pending L2", "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    # Final approve → submit the document (doc_status=1)
                    {"state": "PI Approved",   "doc_status": "1", "edit_permission_type": "Role", "allow_edit": "System Manager"},
                    # Rejected returns to draft (doc_status=0) so the submitter can correct and re-submit
                    {"state": "PI Rejected",   "doc_status": "0", "edit_permission_type": "Role", "allow_edit": "Accounts User"},
                ],
                "transitions": [
                    {
                        "state": "PI Draft",
                        "action": "PI Submit for Approval",
                        "next_state": "PI Pending L1",
                        "approver_type": "Role",
                        "allowed": "Accounts User",
                        "allow_self_approval": 1,
                        "use_approver_matrix": 0,
                    },
                    {
                        "state": "PI Pending L1",
                        "action": "PI Approve",
                        "next_state": "PI Pending L2",
                        "use_approver_matrix": 1,
                        "matrix_level": 1,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                    },
                    {
                        "state": "PI Pending L1",
                        "action": "PI Reject",
                        "next_state": "PI Rejected",
                        "use_approver_matrix": 1,
                        "matrix_level": 1,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                        "require_comment": 1,
                    },
                    {
                        "state": "PI Pending L2",
                        "action": "PI Approve",
                        "next_state": "PI Approved",
                        "use_approver_matrix": 1,
                        "matrix_level": 2,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                    },
                    {
                        "state": "PI Pending L2",
                        "action": "PI Reject",
                        "next_state": "PI Rejected",
                        "use_approver_matrix": 1,
                        "matrix_level": 2,
                        "matrix_fallback_role": "System Manager",
                        "allow_self_approval": 0,
                        "require_comment": 1,
                    },
                    # Re-submit after rejection — submitter corrects and resubmits
                    {
                        "state": "PI Rejected",
                        "action": "PI Submit for Approval",
                        "next_state": "PI Pending L1",
                        "approver_type": "Role",
                        "allowed": "Accounts User",
                        "allow_self_approval": 1,
                        "use_approver_matrix": 0,
                    },
                ],
            }).insert(ignore_permissions=True)
            log.append(f"Created PM Workflow: {_WF_NAME}")
        else:
            log.append(f"PM Workflow exists: {_WF_NAME}")

        # 11. Sample Purchase Invoice
        pi_exists = frappe.db.get_value(
            "Purchase Invoice", {"supplier": _SUPPLIER_NAME, "docstatus": 0}, "name"
        )
        if not pi_exists:
            # Find any purchase item on the system
            item = frappe.db.get_value("Item", {"is_purchase_item": 1, "disabled": 0}, "name")
            if not item:
                item = frappe.db.get_value("Item", {"disabled": 0}, "name")
            uom = frappe.db.get_value("Item", item, "purchase_uom") or \
                  frappe.db.get_value("Item", item, "stock_uom") or "Nos"

            pi_doc = frappe.get_doc({
                "doctype": "Purchase Invoice",
                "owner": _SUBMITTER,
                "company": company,
                "supplier": _SUPPLIER_NAME,
                "posting_date": today(),
                "due_date": add_days(today(), 30),
                "currency": currency,
                "pm_pi_workflow_state": "PI Draft",
                "items": [{
                    "item_code": item,
                    "qty": 2,
                    "rate": 500,
                    "uom": uom,
                }],
            })
            pi_doc.flags.ignore_mandatory = True
            pi_doc.flags.ignore_validate = True
            pi_doc.insert(ignore_permissions=True)
            # Force correct owner regardless of who ran this setup script
            frappe.db.set_value("Purchase Invoice", pi_doc.name, "owner", _SUBMITTER)
            log.append(f"Created Sample Purchase Invoice: {pi_doc.name}")
        else:
            log.append(f"Sample PI exists: {pi_exists}")

        frappe.db.commit()
        return {"success": True, "log": log}

    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="PM PI Demo Setup Failed")
        return {"success": False, "log": log, "error": frappe.get_traceback()}

    finally:
        frappe.enqueue = _real_enqueue


# ── Teardown ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def teardown_pi_demo():
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

        # PM Workflow Actions on PI
        for r in frappe.get_all("PM Workflow Action",
                                filters={"reference_doctype": "Purchase Invoice"},
                                pluck="name"):
            frappe.delete_doc("PM Workflow Action", r, ignore_permissions=True, force=True)
        log.append("Deleted PM Workflow Actions for Purchase Invoice")

        # Sample PIs — cancel submitted ones first, then delete
        for pi in frappe.get_all("Purchase Invoice",
                                 filters={"supplier": _SUPPLIER_NAME},
                                 fields=["name", "docstatus"]):
            try:
                if pi.docstatus == 1:
                    doc = frappe.get_doc("Purchase Invoice", pi.name)
                    doc.flags.ignore_permissions = True
                    doc.cancel()
                frappe.delete_doc("Purchase Invoice", pi.name, ignore_permissions=True, force=True)
                log.append(f"Deleted Purchase Invoice: {pi.name}")
            except Exception as e:
                log.append(f"Could not delete PI {pi.name}: {e}")

        _del("PM Workflow", _WF_NAME)
        _del("Supplier", _SUPPLIER_NAME)

        # Remove PI Custom DocPerm added for demo
        pi_perm = frappe.db.get_value(
            "Custom DocPerm",
            {"parent": "Purchase Invoice", "role": "Accounts User", "if_owner": 0, "write": 1},
            "name",
        )
        if pi_perm:
            frappe.delete_doc("Custom DocPerm", pi_perm, ignore_permissions=True, force=True)
            frappe.clear_cache(doctype="Purchase Invoice")
            log.append("Removed Purchase Invoice write permission for Accounts User")

        if frappe.db.exists("Custom Field", _CF_NAME):
            frappe.delete_doc("Custom Field", _CF_NAME, ignore_permissions=True, force=True)
            frappe.clear_cache(doctype="Purchase Invoice")
            log.append(f"Deleted Custom Field: {_CF_NAME}")

        for ws in _DEMO_STATES:
            _del("Workflow State", ws["workflow_state_name"])

        for wa in _DEMO_ACTIONS:
            _del("Workflow Action Master", wa["workflow_action_name"])

        emp = frappe.db.get_value("Employee", {"user_id": _SUBMITTER}, "name")
        if emp:
            _del("Employee", emp)

        for u in _DEMO_USERS:
            _del("User", u["email"])

        frappe.db.commit()
        return {"success": True, "log": log}

    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="PM PI Demo Teardown Failed")
        return {"success": False, "log": log, "error": frappe.get_traceback()}

    finally:
        frappe.enqueue = _real_enqueue
