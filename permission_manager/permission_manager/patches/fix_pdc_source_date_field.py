# permission_manager/permission_manager/patches/fix_pdc_source_date_field.py
"""Date the Post Dated Cheques stream by reference_date, not posting_date.

seed_dues_sources created the source with date_field = posting_date, which is the day the entry was
keyed. A post-dated cheque matures on its reference_date - on this client the two are months apart, so
a cheque maturing in November was reported as a few days overdue, and the ageing buckets for the whole
stream were meaningless. sf_trading's own PDC report has always filtered on reference_date.

Only touches a source still pointing at posting_date, so a site that has been corrected by hand keeps
its own setting.
"""

import frappe


def execute():
    name = frappe.db.exists("PM Dues Source", {"voucher_doctype": "Payment Entry",
                                               "date_field": "posting_date"})
    if not name:
        return
    if not frappe.get_meta("Payment Entry").get_field("reference_date"):
        return
    frappe.db.set_value("PM Dues Source", name, "date_field", "reference_date",
                        update_modified=False)
    frappe.clear_cache(doctype="PM Dues Source")
    frappe.cache().delete_value("pm_dues_sources")
    frappe.db.commit()
    frappe.logger().info("permission_manager: %s now dates by reference_date" % name)
