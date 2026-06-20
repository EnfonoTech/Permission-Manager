"""
Permission Manager — Multi-level Leave Application Approval
Author: siva <siva@enfono.com>

Provides:
  leave_application_permission_query  — permission_query_conditions hook
  before_save                         — auto-assign level-1 approver
  before_submit                       — gate submit on Approved status
  forward_leave                       — approve/forward action from form
  reject_leave                        — reject action from form
"""

import frappe
from frappe import _


# ─── Helpers ──────────────────────────────────────────────────────────────────

_HR_ROLES = {"HR Manager", "HR User", "System Manager"}


def _user_is_hr(user=None):
    roles = set(frappe.get_roles(user or frappe.session.user))
    return bool(roles & _HR_ROLES)


def _get_chain_approver(employee: str, level: int, doctype: str = "Leave Application"):
    """
    Return the approver User at `level` from the employee's PM Approval Chain.
    Respects scope (All DocTypes / Specific Module / Specific DocType).
    Returns None if no chain entry found.
    """
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
    """Return False if the employee has disabled multi-level approval."""
    if not frappe.db.has_column("Employee", "custom_disable_multilevel_approval"):
        return True
    disabled = frappe.db.get_value("Employee", employee, "custom_disable_multilevel_approval")
    return not disabled


# ─── Permission query condition ───────────────────────────────────────────────

def leave_application_permission_query(user: str, doctype: str = "Leave Application") -> str:
    """
    permission_query_conditions hook for Leave Application.

    HR roles and System Manager see everything (return empty string).
    Other users see only:
      - Applications they submitted (owner)
      - Applications where they are the current leave_approver
    """
    if not user:
        user = frappe.session.user

    if user == "Administrator" or _user_is_hr(user):
        return ""

    escaped = frappe.db.escape(user)
    return (
        f"(`tabLeave Application`.`owner` = {escaped} "
        f"OR `tabLeave Application`.`leave_approver` = {escaped})"
    )


# ─── Document event hooks ─────────────────────────────────────────────────────

def before_save(doc, method=None):
    """
    Auto-assign level-1 approver when a Leave Application is first created
    and has no leave_approver set yet.
    """
    if doc.get("leave_approver"):
        return

    employee = _get_employee_for_user(doc.owner)
    if not employee or not _multi_level_enabled(employee):
        return

    approver = _get_chain_approver(employee, level=1)
    if approver:
        doc.leave_approver = approver


def before_submit(doc, method=None):
    """
    Block submit unless the leave is Approved (or the submitter is HR).
    This prevents employees from self-submitting unapproved leaves.
    """
    if _user_is_hr():
        return

    if doc.get("status") != "Approved":
        frappe.throw(
            _("Leave Application must be Approved before it can be submitted."),
            title=_("Approval Required"),
        )


# ─── Whitelisted actions ──────────────────────────────────────────────────────

@frappe.whitelist()
def forward_leave(docname: str, designation: str = None) -> str:
    """
    Forward or final-approve a Leave Application.

    - designation == "hr"  → final approval: set status = Approved
    - designation is None  → line-manager forward: find level-2 approver and hand off
    """
    doc = frappe.get_doc("Leave Application", docname)

    if doc.leave_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this leave application."))
    if doc.docstatus != 0:
        frappe.throw(_("This leave application has already been submitted or cancelled."))

    if designation == "hr":
        doc.status = "Approved"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return _("Leave application approved.")

    # Line-manager forward — find the next approver in the chain
    employee = _get_employee_for_user(doc.owner)
    next_approver = None

    if employee and _multi_level_enabled(employee):
        next_approver = _get_chain_approver(employee, level=2)

    if not next_approver:
        # Fallback: hand to any HR Manager
        hr_users = frappe.get_all(
            "Has Role",
            filters={"role": "HR Manager", "parenttype": "User"},
            pluck="parent",
            limit=1,
        )
        next_approver = hr_users[0] if hr_users else None

    if not next_approver:
        frappe.throw(_("No level-2 approver or HR Manager found. Please set an approval chain on the Employee record."))

    doc.leave_approver = next_approver
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    approver_name = frappe.db.get_value("User", next_approver, "full_name") or next_approver
    return _("Forwarded to {0} for final approval.").format(approver_name)


@frappe.whitelist()
def reject_leave(docname: str, reason: str = "") -> str:
    """
    Reject a Leave Application and record the rejection reason.
    """
    doc = frappe.get_doc("Leave Application", docname)

    if doc.leave_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this leave application."))
    if doc.docstatus != 0:
        frappe.throw(_("This leave application has already been submitted or cancelled."))

    doc.status = "Rejected"

    description = doc.get("description") or ""
    if reason:
        rejection_note = _("Rejected by {0}: {1}").format(frappe.session.user, reason)
        doc.description = f"{description}\n\n{rejection_note}".strip() if description else rejection_note

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    # Notify the applicant
    try:
        applicant_email = frappe.db.get_value("User", doc.owner, "email")
        if applicant_email:
            frappe.sendmail(
                recipients=[applicant_email],
                subject=f"Leave Application Rejected — {doc.leave_type}",
                message=f"""
<p>Your leave application <strong>{docname}</strong> ({doc.leave_type}, {doc.from_date} – {doc.to_date}) has been <strong>rejected</strong>.</p>
{"<p><strong>Reason:</strong> " + frappe.utils.escape_html(reason) + "</p>" if reason else ""}
<p><a href="{frappe.utils.get_url()}/app/leave-application/{docname}">View Application</a></p>
""",
                reference_doctype="Leave Application",
                reference_name=docname,
            )
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"PM Ladder Approve: rejection email failed for {docname}")

    return _("Leave application rejected.")
