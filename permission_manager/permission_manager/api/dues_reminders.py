# permission_manager/permission_manager/api/dues_reminders.py
"""Daily nudges for the Dues Inbox.

Two things a follow-up promises to do and could not do on its own:

* a snooze has to end. While `snooze_until` is in the future the row is out of the live list and
  every tally; when the date passes it used to come back still marked Snoozed, which put it in
  "In progress" rather than "Untouched" where anyone looks for work. It is reopened here.

* a promise has to be checked. Someone said they would pay on Friday; on Friday the person who
  took that promise should hear about it.

Both notify through the bell and the realtime chime, the same pair `pm_workflow_action` uses.
Email is deliberately not attempted: this site has no outgoing Email Account and every send would
land in the Error Log.
"""

import frappe
from frappe import _
from frappe.utils import getdate, today

EVENT = "pm_dues_reminder"


def send_dues_reminders():
    """Daily scheduler entry."""
    reopened = reopen_expired_snoozes()
    promised = remind_promised()
    return {"reopened": reopened, "promised": promised}


def reopen_expired_snoozes():
    """A snooze whose date has passed goes back to Open, and its owner is told."""
    expired = frappe.get_all(
        "PM Dues Follow Up",
        filters={"state": "Snoozed", "snooze_until": ["<=", today()]},
        fields=["name", "voucher_doctype", "voucher", "party", "owner_user", "snooze_until"],
    )
    for row in expired:
        doc = frappe.get_doc("PM Dues Follow Up", row.name)
        doc.state = "Open"
        doc.snooze_until = None
        doc.save(ignore_permissions=True)
        _notify(
            row.owner_user,
            _("Snooze ended: %(party)s, %(voucher)s is back on your list")
            % {"party": row.party or "", "voucher": row.voucher},
            row.voucher_doctype,
            row.voucher,
        )
    frappe.db.commit()
    return len(expired)


def remind_promised():
    """A promise that has come due is worth one message to whoever took it."""
    due = frappe.get_all(
        "PM Dues Follow Up",
        filters={"state": "Promised", "promised_date": ["<=", today()]},
        fields=["name", "voucher_doctype", "voucher", "party", "owner_user", "promised_date"],
    )
    for row in due:
        overdue_by = (getdate(today()) - getdate(row.promised_date)).days
        when = (
            _("today") if overdue_by == 0
            else _("%s days ago") % overdue_by
        )
        _notify(
            row.owner_user,
            _("Promise due %(when)s: %(party)s on %(voucher)s")
            % {"when": when, "party": row.party or "", "voucher": row.voucher},
            row.voucher_doctype,
            row.voucher,
        )
    return len(due)


def _notify(user, subject, doctype, docname):
    if not user or user == "Administrator":
        return
    if not frappe.db.get_value("User", user, "enabled"):
        return
    try:
        frappe.get_doc({
            "doctype": "Notification Log",
            "subject": subject,
            "for_user": user,
            "type": "Alert",
            "document_type": doctype,
            "document_name": docname,
            "email_content": _(
                "Open the <a href='/app/pm-dues-inbox'>Dues Inbox</a> to act on it."
            ),
        }).insert(ignore_permissions=True)
    except Exception:
        frappe.clear_last_message()
    try:
        frappe.publish_realtime(
            event=EVENT,
            message={"subject": subject, "doctype": doctype, "docname": docname},
            user=user,
            after_commit=True,
        )
    except Exception:
        frappe.clear_last_message()


@frappe.whitelist()
def run_now():
    """Manual trigger, for checking the job does what it says without waiting a day."""
    frappe.only_for(("System Manager", "Accounts Manager"))
    return send_dues_reminders()
