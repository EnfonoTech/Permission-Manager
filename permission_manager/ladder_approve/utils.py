"""
Permission Manager — Ladder Approve shared utilities.
Handles post-save notifications for ladder-approval documents.
"""

import frappe


def after_save(doc, method=None):
    """
    Fires on on_update for Leave Application (and any other ladder-approved doc).
    Sends an email alert to the current leave_approver when the document is
    saved in Draft status and an approver is assigned.
    """
    approver_field = "leave_approver"
    if not hasattr(doc, approver_field):
        return

    approver = doc.get(approver_field)
    if not approver or doc.docstatus != 0:
        return

    # Only notify on the first save (status Open) — avoid spamming on every edit
    if doc.get("status") not in ("Open", None, ""):
        return

    try:
        approver_full_name = frappe.db.get_value("User", approver, "full_name") or approver
        employee_name = doc.get("employee_name") or doc.get("employee") or ""
        from_date = frappe.utils.formatdate(doc.get("from_date"))
        to_date = frappe.utils.formatdate(doc.get("to_date"))
        leave_type = doc.get("leave_type") or ""
        doc_url = f"{frappe.utils.get_url()}/app/leave-application/{doc.name}"

        frappe.sendmail(
            recipients=[approver],
            subject=f"Leave Approval Required — {employee_name} ({leave_type})",
            message=f"""
<p>Dear {approver_full_name},</p>
<p>A leave application requires your approval.</p>
<table style="border-collapse:collapse;width:100%;max-width:480px">
  <tr><td style="padding:5px;font-weight:bold">Employee</td><td style="padding:5px">{employee_name}</td></tr>
  <tr><td style="padding:5px;font-weight:bold">Leave Type</td><td style="padding:5px">{leave_type}</td></tr>
  <tr><td style="padding:5px;font-weight:bold">From</td><td style="padding:5px">{from_date}</td></tr>
  <tr><td style="padding:5px;font-weight:bold">To</td><td style="padding:5px">{to_date}</td></tr>
</table>
<p style="margin-top:16px">
  <a href="{doc_url}"
     style="background:#006C45;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">
    Review Leave Application
  </a>
</p>
""",
            reference_doctype="Leave Application",
            reference_name=doc.name,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"PM Ladder Approve: notification failed for {doc.name}")
