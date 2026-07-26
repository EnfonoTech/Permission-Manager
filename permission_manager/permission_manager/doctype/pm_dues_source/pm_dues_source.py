# permission_manager/permission_manager/doctype/pm_dues_source/pm_dues_source.py
"""A voucher type the Dues Inbox should watch.

One row per stream — customer overdue, supplier overdue, cheques maturing — so a new stream is
configuration, not code. The field names entered here are used to build queries, so they are
validated against the target DocType on save: an admin typo becomes an error on this form
instead of a broken inbox for everyone.
"""

import json

import frappe
from frappe import _
from frappe.model.document import Document

# Fields whose value we read but never trust blindly — every one is checked against the meta
FIELD_SETTINGS = (
    ("date_field", True),
    ("amount_field", True),
    ("party_field", False),
    ("party_type_field", False),
    ("company_field", False),
    ("branch_field", False),
)

NUMERIC_FIELDTYPES = {"Currency", "Float", "Int", "Percent"}
DATE_FIELDTYPES = {"Date", "Datetime"}


class PMDuesSource(Document):
    def validate(self):
        self.validate_voucher_doctype()
        self.validate_fields_exist()
        self.validate_party_configuration()
        self.validate_extra_filters()
        if not self.label:
            self.label = self.source_name

    def on_update(self):
        clear_dues_source_cache()

    def on_trash(self):
        clear_dues_source_cache()

    # ── validation ────────────────────────────────────────────────────────────

    def validate_voucher_doctype(self):
        if not frappe.db.exists("DocType", self.voucher_doctype):
            frappe.throw(_("DocType %s does not exist.") % frappe.bold(self.voucher_doctype))
        if frappe.get_meta(self.voucher_doctype).istable:
            frappe.throw(
                _("%s is a child table. Point this source at the parent voucher instead.")
                % frappe.bold(self.voucher_doctype)
            )

    def validate_fields_exist(self):
        meta = frappe.get_meta(self.voucher_doctype)
        for fieldname, mandatory in FIELD_SETTINGS:
            value = (self.get(fieldname) or "").strip()
            if not value:
                if mandatory:
                    frappe.throw(_("%s is required.") % _(self.meta.get_label(fieldname)))
                continue
            self.set(fieldname, value)
            df = meta.get_field(value)
            if not df and value not in frappe.model.default_fields:
                frappe.throw(
                    _("%(doctype)s has no field %(field)s. Check the spelling on the target DocType.")
                    % {"doctype": frappe.bold(self.voucher_doctype), "field": frappe.bold(value)}
                )
            # A due date that is not a date, or an amount that is not numeric, produces rows that
            # look plausible and sort wrongly — cheaper to refuse here.
            if df and fieldname == "date_field" and df.fieldtype not in DATE_FIELDTYPES:
                frappe.throw(
                    _("%(field)s is a %(type)s, not a date. Pick the field holding the due date.")
                    % {"field": frappe.bold(value), "type": df.fieldtype}
                )
            if df and fieldname == "amount_field" and df.fieldtype not in NUMERIC_FIELDTYPES:
                frappe.throw(
                    _("%(field)s is a %(type)s, not an amount.")
                    % {"field": frappe.bold(value), "type": df.fieldtype}
                )

    def validate_party_configuration(self):
        if self.party_type and self.party_type_field:
            frappe.throw(_("Set either a fixed Party Type or a Party Type Field, not both."))
        if self.party_type and not frappe.db.exists("DocType", self.party_type):
            frappe.throw(_("Party Type %s is not a DocType.") % frappe.bold(self.party_type))
        if (self.party_type or self.party_type_field) and not self.party_field:
            frappe.throw(_("A party type without a Party Field cannot be resolved."))

    def validate_extra_filters(self):
        raw = (self.extra_filters or "").strip()
        if not raw:
            return
        try:
            parsed = json.loads(raw)
        except ValueError as e:
            frappe.throw(_("Extra Filters is not valid JSON: %s") % e)
        if not isinstance(parsed, dict):
            frappe.throw(_("Extra Filters must be a JSON object of fieldname to condition."))
        meta = frappe.get_meta(self.voucher_doctype)
        for fieldname in parsed:
            if not meta.get_field(fieldname) and fieldname not in frappe.model.default_fields:
                frappe.throw(
                    _("Extra Filters names %(field)s, which %(doctype)s does not have.")
                    % {"field": frappe.bold(fieldname), "doctype": frappe.bold(self.voucher_doctype)}
                )


def clear_dues_source_cache():
    frappe.cache().delete_value("pm_dues_sources")
