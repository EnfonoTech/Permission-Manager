# permission_manager/permission_manager/patches/seed_sales_return_defaults.py
"""Give the new sales-return settings their intended values on a site that already exists.

A DocField default is applied when a document is created, and PM Settings is a Single that was
created long before these fields were added -- so on every existing site the threshold read 0
and "PM Workflow Approval Mandatory" read unticked, which is not what either field ships as. A
threshold of 0 with the amount restriction on would send every return of any size for approval
the moment somebody enabled the feature.

Only ever fills a field that has never been set. The two features stay off; this settles what
they would do once switched on, not whether they are.
"""

import frappe

# field -> the value the DocType ships as its default
DEFAULTS = {
    "si_return_approval_threshold": 500,
    "si_return_requires_workflow": 1,
    "sales_return_days_from": "Original Invoice Date",
    "sales_return_days": 0,
}


def execute():
    if not frappe.db.exists("DocType", "PM Settings"):
        return

    meta = frappe.get_meta("PM Settings")
    settled = {}
    for field, value in DEFAULTS.items():
        if not meta.get_field(field):
            continue
        # A Single keeps only the values that have been written, so "no row at all" is what an
        # untouched field looks like -- and is the only case worth filling.
        if frappe.db.exists("Singles", {"doctype": "PM Settings", "field": field}):
            continue
        frappe.db.set_single_value("PM Settings", field, value, update_modified=False)
        settled[field] = value

    if not settled:
        return

    frappe.clear_cache(doctype="PM Settings")
    frappe.db.commit()
    frappe.logger().info("permission_manager: seeded sales return settings %s" % settled)
