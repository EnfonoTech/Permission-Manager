# permission_manager/permission_manager/patches/seed_dues_sources.py
"""Seed the three streams the Dues Inbox starts with.

Configuration, not code — these are ordinary PM Dues Source rows an admin can edit, disable or
delete, and adding a fourth stream needs no patch at all. Runs once, skips a source that already
exists, and skips one whose voucher DocType or fields are missing on this site.

The PDC definition is copied from the live "PDC Cheque Date Reminder" Notification so the inbox
and that alert agree on what a post-dated cheque is: a submitted Payment Entry with a reference
number, ZATCA payment means 20 (cheque) and no clearance date, dated by posting_date.
"""

import json

import frappe

SOURCES = [
    {
        "source_name": "Sales Invoice Overdue",
        "label": "Customer overdue",
        "direction": "Receivable",
        "voucher_doctype": "Sales Invoice",
        "date_field": "due_date",
        "amount_field": "outstanding_amount",
        "party_field": "customer",
        "party_type": "Customer",
        "accent": "Teal",
        "sort_order": 10,
        "roles": ["Accounts User", "Accountant", "Accounts Manager", "Finance Manager"],
        "description": "Submitted sales invoices still carrying an outstanding amount.",
    },
    {
        "source_name": "Purchase Invoice Overdue",
        "label": "Supplier overdue",
        "direction": "Payable",
        "voucher_doctype": "Purchase Invoice",
        "date_field": "due_date",
        "amount_field": "outstanding_amount",
        "party_field": "supplier",
        "party_type": "Supplier",
        "accent": "Amber",
        "sort_order": 20,
        "roles": ["Accountant", "Accounts Manager", "Finance Manager"],
        "description": "Submitted purchase invoices still carrying an outstanding amount.",
    },
    {
        "source_name": "Post Dated Cheques",
        "label": "Cheques maturing",
        "direction": "Instrument",
        "voucher_doctype": "Payment Entry",
        "date_field": "posting_date",
        "amount_field": "base_paid_amount",
        "party_field": "party",
        "party_type_field": "party_type",
        "accent": "Purple",
        "sort_order": 30,
        "roles": ["Accountant", "Accounts Manager", "Finance Manager"],
        "extra_filters": {
            "custom_zatca_payment_means_code": "20",
            "reference_no": ["is", "set"],
            "clearance_date": ["is", "not set"],
        },
        "description": "Cheques not yet cleared, matching the PDC Cheque Date Reminder alert.",
    },
]


def execute():
    if not frappe.db.exists("DocType", "PM Dues Source"):
        return

    for spec in SOURCES:
        if frappe.db.exists("PM Dues Source", spec["source_name"]):
            continue
        if not frappe.db.exists("DocType", spec["voucher_doctype"]):
            print("Dues Inbox: skipping " + spec["source_name"] + " — no " + spec["voucher_doctype"])
            continue

        meta = frappe.get_meta(spec["voucher_doctype"])
        required = [spec["date_field"], spec["amount_field"]]
        missing = [f for f in required if not meta.get_field(f)]
        if missing:
            print("Dues Inbox: skipping " + spec["source_name"] + " — missing " + ", ".join(missing))
            continue

        doc = frappe.new_doc("PM Dues Source")
        doc.update({k: v for k, v in spec.items() if k not in ("roles", "extra_filters")})
        # only claim a branch column where the site actually has one
        doc.branch_field = "branch" if meta.get_field("branch") else None
        doc.company_field = "company" if meta.get_field("company") else None
        if spec.get("extra_filters"):
            kept = {f: c for f, c in spec["extra_filters"].items() if meta.get_field(f)}
            doc.extra_filters = json.dumps(kept, indent=1) if kept else None
        for role in spec.get("roles", []):
            if frappe.db.exists("Role", role):
                doc.append("roles", {"role": role})
        doc.insert(ignore_permissions=True)
        print("Dues Inbox: added source " + doc.name)

    frappe.db.commit()
