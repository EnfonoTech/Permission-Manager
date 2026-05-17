"""
Permission Manager — Multi-level Leave Application Approval
Author: siva <siva@enfono.com>

Handles forward / reject actions and document hooks for Leave Application
multi-level approval workflows.
"""

import frappe
from frappe import _
from permission_manager.permission_manager.ladder_approve import utils


@frappe.whitelist()
def forward_leave(docname: str, designation: str = None) -> str:
    """
    Approve and forward a Leave Application to the next level in the hierarchy.

    HR Managers and Administrators perform final approval (submit immediately).
    Mid-level approvers forward to the next manager in the reporting chain.
    """
    if designation == "hr" or frappe.session.user == "Administrator":
        doc = frappe.get_doc("Leave Application", docname)
        doc.status = "Approved"
        doc.save(ignore_permissions=True)
        doc.submit()
        return "Leave application approved."

    doc = utils.validate_doc(docname, "Leave Application", "leave_approver")
    chain = utils.get_manager_chain(doc.employee)
    index = next(
        (i for i, mgr in enumerate(chain) if mgr["user_id"] == frappe.session.user),
        -1,
    )

    if index == -1 or index + 1 >= len(chain):
        frappe.throw(
            _(
                "No further approvers available. "
                "Please ensure the employee's 'Reports To' hierarchy is configured correctly."
            )
        )

    next_mgr = chain[index + 1]

    existing = doc.custom_previous_approvers.split("\n") if doc.custom_previous_approvers else []
    if doc.leave_approver and doc.leave_approver not in existing:
        existing.append(doc.leave_approver)
    doc.custom_previous_approvers = "\n".join(existing)

    doc.leave_approver = next_mgr["user_id"]
    doc.leave_approver_name = next_mgr["employee"]
    doc.status = "Pending Next Approval"
    doc.save(ignore_permissions=True)

    return f"Leave forwarded to {next_mgr['employee']}."


@frappe.whitelist()
def reject_leave(docname: str, reason: str) -> str:
    """Reject a Leave Application with a mandatory reason."""
    doc = utils.validate_doc(docname, "Leave Application", "leave_approver")
    doc.custom_rejection_reason = reason
    doc.rejection_reason = reason
    doc.status = "Rejected"
    doc.save(ignore_permissions=True)
    doc.submit()
    return f"Leave application rejected. Reason: {reason}"


# ─── Document event hooks ─────────────────────────────────────────────────────

def before_save(doc, method):
    """Auto-assign the direct manager as leave approver on new documents."""
    if not utils.is_feature_enabled(None, "leave"):
        return
    if utils.is_employee_disable_multilevel_approval(doc.employee):
        return
    if doc.is_new():
        emp = frappe.get_doc("Employee", doc.employee)
        if emp.reports_to:
            manager = frappe.get_doc("Employee", emp.reports_to)
            doc.leave_approver = manager.user_id
            doc.leave_approver_name = manager.employee_name


def before_submit(doc, method):
    """Block submission if the document is still pending an intermediate approval."""
    if not utils.is_feature_enabled(None, "leave"):
        return
    if utils.is_employee_disable_multilevel_approval(doc.employee):
        return
    if doc.status == "Pending Next Approval":
        frappe.throw(_("Cannot submit: approval is still pending from the next approver."))


def leave_application_permission_query(user: str) -> str:
    """Filter Leave Application list to show only relevant records per user role."""
    if not utils.is_feature_enabled(flag=None, doc_type="leave"):
        return ""

    if user == "Administrator":
        return ""

    has_hr_role = frappe.db.exists(
        "Has Role",
        {"parent": user, "role": ["in", ["System Manager", "HR Manager", "HR User"]]},
    )
    if has_hr_role:
        return ""

    return (
        f"`tabLeave Application`.owner = '{user}'"
        f" OR `tabLeave Application`.leave_approver = '{user}'"
        f" OR `tabLeave Application`.custom_previous_approvers LIKE '%{user}%'"
    )
