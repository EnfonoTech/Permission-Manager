# permission_manager/permission_manager/doctype/pm_dues_follow_up/pm_dues_follow_up.py
"""Who is chasing an overdue voucher, and what was agreed.

The Dues Inbox reads the vouchers themselves; this holds the part no voucher records — that
someone rang the customer on Tuesday, was promised Friday, and does not want to see the row again
until then. One row per voucher, so the inbox can join it cheaply.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime, today

NEEDS_PROMISE = ("Promised",)
NEEDS_SNOOZE = ("Snoozed",)


class PMDuesFollowUp(Document):
    def autoname(self):
        """DUES-SI-2001000060, rather than a hash nobody can read.

        One row per voucher, so the voucher belongs in the name. The short code keeps two
        doctypes that happen to share a voucher number apart — Steel Force has invoices named
        like 2001000060, and a Payment Entry could carry the same digits.
        """
        code = doctype_code(self.voucher_doctype)
        self.name = "DUES-%s-%s" % (code, self.voucher)

    def validate(self):
        self.validate_one_per_voucher()
        self.validate_state_dates()
        self.stamp_contact()
        if not self.owner_user:
            self.owner_user = frappe.session.user

    def validate_one_per_voucher(self):
        existing = frappe.db.get_value(
            "PM Dues Follow Up",
            {"voucher_doctype": self.voucher_doctype, "voucher": self.voucher,
             "name": ["!=", self.name or ""]},
            "name",
        )
        if existing:
            frappe.throw(
                _("%(voucher)s already has a follow-up (%(existing)s). Update that one instead.")
                % {"voucher": frappe.bold(self.voucher), "existing": existing}
            )

    def validate_state_dates(self):
        if self.state in NEEDS_PROMISE and not self.promised_date:
            frappe.throw(_("A promised state needs the date that was promised."))
        if self.state in NEEDS_SNOOZE:
            if not self.snooze_until:
                frappe.throw(_("Snoozing needs a date to come back on."))
            if getdate(self.snooze_until) <= getdate(today()):
                frappe.throw(_("Snooze Until has to be a future date, otherwise nothing is snoozed."))
        if self.state not in NEEDS_SNOOZE:
            self.snooze_until = None

    def on_update(self):
        self.sync_assignment()

    def on_trash(self):
        from frappe.desk.form.assign_to import close_all_assignments

        close_all_assignments(self.doctype, self.name, ignore_permissions=True)

    def sync_assignment(self):
        """Hand the chase over properly instead of just writing a name in a column.

        Frappe's own assignment gives the owner a ToDo, shares the document with them and posts
        the bell notification (notify_assignment skips self-assignment and disabled users, so
        picking yourself is quiet). Without this, "Owned By" told nobody anything.
        """
        from frappe.desk.form.assign_to import add as assign_add
        from frappe.desk.form.assign_to import remove as assign_remove

        if not self.has_value_changed("owner_user"):
            return

        previous = (self.get_doc_before_save() or {}).get("owner_user") if not self.is_new() else None
        if previous and previous != self.owner_user:
            try:
                assign_remove(self.doctype, self.name, previous)
            except Exception:
                frappe.clear_last_message()  # already closed or never existed

        if not self.owner_user or not frappe.db.get_value("User", self.owner_user, "enabled"):
            return
        try:
            assign_add({
                "assign_to": [self.owner_user],
                "doctype": self.doctype,
                "name": self.name,
                "description": _("Chase %(party)s on %(voucher)s (%(state)s)")
                % {"party": self.party or "", "voucher": self.voucher, "state": _(self.state)},
                "priority": "High" if self.state in ("Escalated", "Disputed") else "Medium",
                "date": self.promised_date or self.snooze_until or None,
            })
        except Exception:
            # a failed hand-off must not block recording what was agreed
            frappe.clear_last_message()
            frappe.log_error(title="Dues follow-up: could not assign", message=frappe.get_traceback())

    def stamp_contact(self):
        # any state that implies a conversation records when it happened
        talked = self.state in ("Contacted", "Promised", "Disputed", "Escalated")
        if talked and (self.is_new() or self.has_value_changed("state") or self.has_value_changed("note")):
            self.last_contacted = now_datetime()


def doctype_code(doctype):
    """Sales Invoice -> SI, Payment Entry -> PE. Initials, so a new voucher type needs no table."""
    words = [w for w in (doctype or "").replace("-", " ").split() if w]
    if not words:
        return "DOC"
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(w[0] for w in words).upper()[:4]
