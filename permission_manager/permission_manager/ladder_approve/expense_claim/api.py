"""
Permission Manager — Multi-level Expense Claim Approval
Author: siva <siva@enfono.com>

Provides:
  expense_claim_permission_query  — permission_query_conditions hook
  before_save                     — auto-assign level-1 approver
  before_submit                   — gate submit on Approved status
  forward_expense_claim           — approve/forward action from form
  reject_expense_claim            — reject action from form
"""

import frappe
from frappe import _


# ─── Helpers ──────────────────────────────────────────────────────────────────

_HR_ROLES = {"HR Manager", "HR User", "System Manager"}


def _user_is_hr(user=None):
    roles = set(frappe.get_roles(user or frappe.session.user))
    return bool(roles & _HR_ROLES)


def _get_chain_approver(employee: str, level: int, doctype: str = "Expense Claim"):
    if not frappe.db.table_exists("PM Employee Approval Chain"):
        return None

    rows = frappe.get_all(
        "PM Employee Approval Chain",
        filters={"parent": employee, "parenttype": "Employee", "level": level},
        fields=["approver", "applies_to", "module", "document_type_name"],
        order_by="idx asc",
    )
    if not rows:
        return None

    dt_module = frappe.db.get_value("DocType", doctype, "module") or ""

    best_approver = None
    best_score = 0
    for row in rows:
        scope = row.applies_to
        if scope == "Specific DocType":
            if row.document_type_name == doctype:
                score = 3
            else:
                continue
        elif scope == "Specific Module":
            if dt_module and row.module == dt_module:
                score = 2
            else:
                continue
        else:
            score = 1

        if score > best_score:
            best_score = score
            best_approver = row.approver

    return best_approver


def _get_employee_for_user(user: str):
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name")


def _multi_level_enabled(employee: str) -> bool:
    if not frappe.db.has_column("Employee", "custom_disable_multilevel_approval"):
        return True
    disabled = frappe.db.get_value("Employee", employee, "custom_disable_multilevel_approval")
    return not disabled


# ─── Permission query condition ───────────────────────────────────────────────

def expense_claim_permission_query(user: str, doctype: str = "Expense Claim") -> str:
    """
    permission_query_conditions hook for Expense Claim.

    HR roles and System Manager see everything.
    Other users see only their own claims or claims they are approving.
    """
    if not user:
        user = frappe.session.user

    if user == "Administrator" or _user_is_hr(user):
        return ""

    escaped = frappe.db.escape(user)
    return (
        f"(`tabExpense Claim`.`owner` = {escaped} "
        f"OR `tabExpense Claim`.`expense_approver` = {escaped})"
    )


# ─── Document event hooks ─────────────────────────────────────────────────────

def before_save(doc, method=None):
    """
    Auto-assign level-1 approver when an Expense Claim is first created
    and has no expense_approver set yet.
    """
    if doc.get("expense_approver"):
        return

    employee = _get_employee_for_user(doc.owner)
    if not employee or not _multi_level_enabled(employee):
        return

    approver = _get_chain_approver(employee, level=1)
    if approver:
        doc.expense_approver = approver


def before_submit(doc, method=None):
    """
    Block submit unless the expense claim is Approved (or submitter is HR).
    """
    if _user_is_hr():
        return

    if doc.get("approval_status") != "Approved":
        frappe.throw(
            _("Expense Claim must be Approved before it can be submitted."),
            title=_("Approval Required"),
        )


# ─── Whitelisted actions ──────────────────────────────────────────────────────

@frappe.whitelist()
def forward_expense_claim(docname: str, designation: str = None) -> str:
    """
    Forward or final-approve an Expense Claim.

    - designation == "hr"  → final approval: set approval_status = Approved
    - designation is None  → forward: assign level-2 approver
    """
    doc = frappe.get_doc("Expense Claim", docname)

    if doc.expense_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this expense claim."))
    if doc.docstatus != 0:
        frappe.throw(_("This expense claim has already been submitted or cancelled."))

    if designation == "hr":
        doc.approval_status = "Approved"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return _("Expense claim approved.")

    employee = _get_employee_for_user(doc.owner)
    next_approver = None

    if employee and _multi_level_enabled(employee):
        next_approver = _get_chain_approver(employee, level=2)

    if not next_approver:
        hr_users = frappe.get_all(
            "Has Role",
            filters={"role": "HR Manager", "parenttype": "User"},
            pluck="parent",
            limit=1,
        )
        next_approver = hr_users[0] if hr_users else None

    if not next_approver:
        frappe.throw(_("No level-2 approver or HR Manager found. Please configure the employee's approval chain."))

    doc.expense_approver = next_approver
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    approver_name = frappe.db.get_value("User", next_approver, "full_name") or next_approver
    return _("Forwarded to {0} for final approval.").format(approver_name)


@frappe.whitelist()
def reject_expense_claim(docname: str, reason: str = "") -> str:
    """
    Reject an Expense Claim and notify the submitter.
    """
    doc = frappe.get_doc("Expense Claim", docname)

    if doc.expense_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this expense claim."))
    if doc.docstatus != 0:
        frappe.throw(_("This expense claim has already been submitted or cancelled."))

    doc.approval_status = "Rejected"

    remark = doc.get("remark") or ""
    if reason:
        rejection_note = _("Rejected by {0}: {1}").format(frappe.session.user, reason)
        doc.remark = f"{remark}\n\n{rejection_note}".strip() if remark else rejection_note

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    try:
        applicant_email = frappe.db.get_value("User", doc.owner, "email")
        if applicant_email:
            frappe.sendmail(
                recipients=[applicant_email],
                subject=f"Expense Claim Rejected — {docname}",
                message=f"""
<p>Your expense claim <strong>{docname}</strong> has been <strong>rejected</strong>.</p>
{"<p><strong>Reason:</strong> " + frappe.utils.escape_html(reason) + "</p>" if reason else ""}
<p><a href="{frappe.utils.get_url()}/app/expense-claim/{docname}">View Claim</a></p>
""",
                reference_doctype="Expense Claim",
                reference_name=docname,
            )
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"PM Ladder Approve: rejection email failed for {docname}")

    return _("Expense claim rejected.")
