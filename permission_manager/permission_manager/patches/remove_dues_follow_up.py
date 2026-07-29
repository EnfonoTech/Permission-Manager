# permission_manager/permission_manager/patches/remove_dues_follow_up.py
"""Drop PM Dues Follow Up. The Dues Inbox no longer tracks follow-ups.

The row action raises a Payment Advice instead, and the row shows any advice already raised, so the
follow-up states, the worklist chips and the daily reminder job have all gone with the feature. The
DocType is removed here rather than left orphaned in tabDocType with a table nobody writes to.

Idempotent: nothing to do on a site that never had it, and nothing to do on a second run.
"""

import frappe


def execute():
    if not frappe.db.exists("DocType", "PM Dues Follow Up"):
        return

    rows = 0
    if frappe.db.table_exists("PM Dues Follow Up"):
        rows = frappe.db.count("PM Dues Follow Up")

    # assignments were the only thing the follow-up reached outside its own table
    for todo in frappe.get_all(
        "ToDo", filters={"reference_type": "PM Dues Follow Up"}, pluck="name"
    ):
        frappe.delete_doc("ToDo", todo, force=True, ignore_permissions=True, delete_permanently=True)

    frappe.delete_doc("DocType", "PM Dues Follow Up", force=True, ignore_permissions=True)
    frappe.db.commit()

    if rows:
        # say it once in the log: a site with real follow-up history should know it went
        frappe.logger().info("permission_manager: removed PM Dues Follow Up (%d row(s))" % rows)
