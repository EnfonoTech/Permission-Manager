"""
Chime Tester — fires a fake pm_new_approval_action realtime event to the
current user so the notification sound and banner can be verified without
creating a real document.
"""

import frappe


@frappe.whitelist()
def fire_test_notification() -> dict:
    user = frappe.session.user
    frappe.publish_realtime(
        event="pm_new_approval_action",
        message={
            "doctype": "Stock Entry",
            "docname": "TEST-CHIME",
            "subject": "Test notification — chime tester",
        },
        user=user,
        after_commit=False,   # fire immediately, no DB transaction needed
    )
    return {"ok": True}
