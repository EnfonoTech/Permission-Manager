"""
Permission Manager — Multi-level Approval Utilities
Author: siva <siva@enfono.com>

Shared helper functions for multi-level Leave and Expense Claim approvals.
"""

import frappe
from frappe import _
from typing import Optional, List, Dict


def is_feature_enabled(flag: str, doc_type: Optional[str] = None) -> bool:
    """Return True if the multi-level approval feature is enabled in HR Settings."""
    try:
        settings = frappe.get_cached_doc("HR Settings")
        if doc_type:
            flag = f"enable_multi_level_{doc_type.lower()}_approval"
        return getattr(settings, flag, False)
    except frappe.DoesNotExistError:
        return False


def is_employee_disable_multilevel_approval(employee: str) -> bool:
    """Return True if the employee has opted out of multi-level approvals."""
    try:
        emp = frappe.get_doc("Employee", employee)
        return bool(getattr(emp, "custom_disable_multilevel_approval", False))
    except frappe.DoesNotExistError:
        return False


def validate_doc(docname: str, doctype: str, approver_field: str):
    """
    Validate that the calling user is the current approver of a draft document.
    Raises frappe exceptions on failure; returns the Document on success.
    """
    if not docname:
        frappe.throw(_("Missing required parameter: docname"))

    doc = frappe.get_doc(doctype, docname)

    if doc.docstatus != 0:
        frappe.throw(_("Only draft documents can be approved."))

    if getattr(doc, approver_field, None) != frappe.session.user:
        frappe.throw(_("You are not the assigned approver for this document."))

    return doc


def get_manager_chain(employee: str) -> List[Dict]:
    """
    Walk the reporting hierarchy from the given employee upwards and return
    a list of managers in order: [{employee, user_id}, ...].
    """
    chain = []
    visited: set = set()
    current = frappe.get_doc("Employee", employee)

    while current.reports_to and current.name not in visited:
        visited.add(current.name)
        manager = frappe.get_doc("Employee", current.reports_to)
        chain.append({"employee": manager.employee_name, "user_id": manager.user_id})
        current = manager

    return chain


def after_save(doc, method):
    """
    on_update hook for Leave Application.
    Ensures the current approver has read/write/share access via DocShare,
    and grants read-only access to previous approvers from other companies.
    """
    if doc.doctype != "Leave Application":
        return
    if not getattr(doc, "leave_approver", None):
        return

    _update_approver_share(doc.doctype, doc.name, doc.leave_approver)
    _share_with_previous_approvers(doc)


def _update_approver_share(doctype: str, docname: str, approver: str) -> bool:
    """Grant read+write+share+notify to the current approver via DocShare."""
    if not approver or approver == "Administrator":
        return False

    try:
        share = frappe.db.get_value(
            "DocShare",
            {"user": approver, "share_doctype": doctype, "share_name": docname},
            ["name"],
            as_dict=True,
        )

        if share:
            frappe.db.sql(
                """UPDATE `tabDocShare`
                   SET `read`=1, `write`=1, `share`=1, `notify_by_email`=1
                   WHERE name=%s""",
                share.name,
            )
        else:
            frappe.get_doc(
                {
                    "doctype": "DocShare",
                    "user": approver,
                    "share_doctype": doctype,
                    "share_name": docname,
                    "read": 1,
                    "write": 1,
                    "share": 1,
                    "everyone": 0,
                    "notify_by_email": 1,
                }
            ).insert(ignore_permissions=True)

        frappe.db.commit()
        return True

    except Exception as exc:
        frappe.log_error(
            title="Permission Manager: Failed to Update Share",
            message=f"Error sharing {doctype} {docname} with {approver}: {exc}",
        )
        return False


def _share_with_previous_approvers(doc) -> None:
    """Grant read-only DocShare access to previous approvers from other companies."""
    if not doc.custom_previous_approvers:
        return

    doc_company = doc.company
    users = [u.strip() for u in doc.custom_previous_approvers.split("\n") if u.strip()]

    for user in users:
        if user in ("Administrator", doc.leave_approver):
            continue

        user_company = frappe.db.get_value("Employee", {"user_id": user}, "company")
        if not user_company or user_company == doc_company:
            continue

        if frappe.db.exists(
            "DocShare",
            {"user": user, "share_doctype": doc.doctype, "share_name": doc.name},
        ):
            continue

        frappe.db.sql(
            """INSERT INTO `tabDocShare`
               (`name`,`user`,`share_doctype`,`share_name`,
                `read`,`write`,`submit`,`share`,`notify_by_email`,
                `creation`,`modified`,`owner`)
               VALUES (%s,%s,%s,%s,1,0,0,0,0,NOW(),NOW(),%s)""",
            (
                frappe.generate_hash(),
                user,
                doc.doctype,
                doc.name,
                frappe.session.user,
            ),
        )
        frappe.db.commit()
