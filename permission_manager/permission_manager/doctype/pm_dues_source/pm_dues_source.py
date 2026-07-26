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
PARTY_FIELDTYPES = {"Link", "Dynamic Link", "Data", "Select", "Read Only"}
# the only default fields that make sense as a due date
DATE_DEFAULT_FIELDS = {"creation", "modified"}


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
        """Every configured name must be a real, queryable column of the right kind.

        `meta.get_field()` alone is not enough: Table, Section Break and virtual fields have no
        column, and `doctype` lives in default_fields but is stripped before the query. Accepting
        any of those saves cleanly here and then throws 1054 at read time, where the whole stream
        vanishes behind one warning line.
        """
        from permission_manager.permission_manager.api.dues_inbox import field_is_usable

        meta = frappe.get_meta(self.voucher_doctype)
        for fieldname, mandatory in FIELD_SETTINGS:
            value = (self.get(fieldname) or "").strip()
            if not value:
                if mandatory:
                    frappe.throw(_("%s is required.") % _(self.meta.get_label(fieldname)))
                continue
            self.set(fieldname, value)

            df, usable = field_is_usable(meta, value)
            if not usable:
                frappe.throw(
                    _("%(doctype)s has no queryable field %(field)s. Check the spelling, and note "
                      "that table, section and virtual fields cannot be used here.")
                    % {"doctype": frappe.bold(self.voucher_doctype), "field": frappe.bold(value)}
                )

            # unconditional per-slot checks: a default field must not slip past the type guard
            if fieldname == "date_field":
                ok = (df and df.fieldtype in DATE_FIELDTYPES) or value in DATE_DEFAULT_FIELDS
                if not ok:
                    frappe.throw(
                        _("%(field)s is not a date. Pick the field holding the due date%(hint)s.")
                        % {"field": frappe.bold(value),
                           "hint": (" (a %s)" % df.fieldtype) if df else ""}
                    )
            elif fieldname == "amount_field":
                if not df or df.fieldtype not in NUMERIC_FIELDTYPES:
                    frappe.throw(
                        _("%(field)s is not an amount%(hint)s.")
                        % {"field": frappe.bold(value),
                           "hint": (", it is a %s" % df.fieldtype) if df else ""}
                    )
            elif df and df.fieldtype not in PARTY_FIELDTYPES:
                frappe.throw(
                    _("%(field)s is a %(type)s, which cannot identify a party, company or branch.")
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
        from permission_manager.permission_manager.api.dues_inbox import field_is_usable

        meta = frappe.get_meta(self.voucher_doctype)
        for fieldname in parsed:
            _df, usable = field_is_usable(meta, fieldname)
            if not usable:
                frappe.throw(
                    _("Extra Filters names %(field)s, which is not a queryable field on %(doctype)s.")
                    % {"field": frappe.bold(fieldname), "doctype": frappe.bold(self.voucher_doctype)}
                )


def clear_dues_source_cache():
    frappe.cache().delete_value("pm_dues_sources")
