# Copyright (c) 2026, siva <siva@enfono.com>
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class PMApproverDelegation(Document):

    def validate(self):
        if self.original_approver == self.substitute_approver:
            frappe.throw(_("Original and Substitute Approver cannot be the same user."))
        if self.from_date and self.to_date and self.from_date > self.to_date:
            frappe.throw(_("From Date cannot be after To Date."))
        if not self.delegated_by:
            self.delegated_by = frappe.session.user
