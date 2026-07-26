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

    def stamp_contact(self):
        # any state that implies a conversation records when it happened
        talked = self.state in ("Contacted", "Promised", "Disputed", "Escalated")
        if talked and (self.is_new() or self.has_value_changed("state") or self.has_value_changed("note")):
            self.last_contacted = now_datetime()
