"""
Permission Manager — Multi-level Expense Claim Approval
Author: siva <siva@enfono.com>

Handles forward / reject actions and document hooks for Expense Claim
multi-level approval workflows.
"""

import frappe
from frappe import _
from permission_manager.permission_manager.ladder_approve import utils


@frappe.whitelist()
def forward_expense_claim(docname: str, designation: str = None) -> str:
    """
    Approve and forward an Expense Claim to the next hierarchy level.

    HR Managers / Administrators perform final approval (submit immediately).
    Mid-level approvers forward to the next manager in the reporting chain.
    """
    if designation == "hr" or frappe.session.user == "Administrator":
        doc = frappe.get_doc("Expense Claim", docname)
        doc.approval_status = "Approved"
        doc.save(ignore_permissions=True)
        doc.submit()
        return "Expense claim approved."

    doc = utils.validate_doc(docname, "Expense Claim", "expense_approver")
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

    existing = (
        doc.custom_previously_approved_by.split("\n")
        if doc.custom_previously_approved_by
        else []
    )
    if doc.expense_approver and doc.expense_approver not in existing:
        existing.append(doc.expense_approver)
    doc.custom_previously_approved_by = "\n".join(existing)

    doc.expense_approver = next_mgr["user_id"]
    doc.expense_approver_name = next_mgr["employee"]
    doc.approval_status = "Pending Next Approval"
    doc.save(ignore_permissions=True)

    return f"Expense claim forwarded to {next_mgr['employee']}."


@frappe.whitelist()
def reject_expense_claim(docname: str, reason: str) -> str:
    """Reject an Expense Claim with a mandatory reason."""
    doc = utils.validate_doc(docname, "Expense Claim", "expense_approver")
    doc.custom_rejection_reason = reason
    doc.rejection_reason = reason
    doc.approval_status = "Rejected"
    doc.save(ignore_permissions=True)
    doc.submit()
    return f"Expense claim rejected. Reason: {reason}"


# ─── Document event hooks ─────────────────────────────────────────────────────

def before_save(doc, method):
    """Auto-assign the direct manager as expense approver on new documents."""
    if not utils.is_feature_enabled(None, "expense_claim"):
        return
    if utils.is_employee_disable_multilevel_approval(doc.employee):
        return
    if doc.is_new():
        emp = frappe.get_doc("Employee", doc.employee)
        if emp.reports_to:
            manager = frappe.get_doc("Employee", emp.reports_to)
            doc.expense_approver = manager.user_id
            doc.expense_approver_name = manager.employee_name


def before_submit(doc, method):
    """Block submission if the document is still pending an intermediate approval."""
    if not utils.is_feature_enabled(None, "expense_claim"):
        return
    if utils.is_employee_disable_multilevel_approval(doc.employee):
        return
    if doc.approval_status == "Pending Next Approval":
        frappe.throw(_("Cannot submit: approval is still pending from the next approver."))


def expense_claim_permission_query(user: str) -> str:
    """Filter Expense Claim list to show only relevant records per user role."""
    if not utils.is_feature_enabled(flag=None, doc_type="expense_claim"):
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
        f"`tabExpense Claim`.owner = '{user}'"
        f" OR `tabExpense Claim`.expense_approver = '{user}'"
        f" OR `tabExpense Claim`.custom_previously_approved_by LIKE '%{user}%'"
    )
