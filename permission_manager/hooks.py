app_name = "permission_manager"
app_title = "Permission Manager"
app_publisher = "siva"
app_description = (
    "All-in-one Frappe permission and approval management: "
    "multi-level HR approvals, PM Workflow engine, and visual Permission Studio."
)
app_email = "siva@enfono.com"
app_license = "mit"

# ─── Required apps ────────────────────────────────────────────────────────────
required_apps = ["frappe", "erpnext"]

# ─── Apps screen entry ────────────────────────────────────────────────────────
add_to_apps_screen = [
    {
        "name": "permission_manager",
        "logo": "/assets/permission_manager/images/logo.svg",
        "title": "Permission Manager",
        "route": "/app/permission-studio",
    },
    {
        "name": "pm_approval_inbox",
        "logo": "/assets/permission_manager/images/logo.svg",
        "title": "My Approvals",
        "route": "/app/pm-approval-inbox",
    },
    {
        "name": "pm_demo",
        "logo": "/assets/permission_manager/images/logo.svg",
        "title": "PM Workflow Demo",
        "route": "/app/pm-demo",
    },
]

# ─── Desk-wide JS / CSS bundles ───────────────────────────────────────────────
# Which doctypes an approval workflow governs, so the form can keep core's Submit button off
# the screen from the first paint instead of one round trip later.
extend_bootinfo = "permission_manager.permission_manager.boot.boot_session"

app_include_js = [
    "permission_manager.bundle.js",
]
app_include_css = ["permission_manager.bundle.css"]

# ─── Doctype-specific JS overrides ───────────────────────────────────────────
doctype_js = {
    "Leave Application": "public/js/leave_application.js",
    "Expense Claim":     "public/js/expense_claim.js",
    "PM Workflow":       "public/js/pm_workflow_form.js",
    # ERPNext counts only submitted Stock Entries towards a Material Request, so a transfer
    # parked in a PM Workflow state leaves the request reading Pending / 0% and invites a
    # duplicate. This warns on the request itself.
    "Material Request":  "public/js/material_request_transfer_warning.js",
    # takes Return / Credit Note off the Create menu once the return window has closed, and says
    # so on the form; the refusal itself is server-side, in api/sales_return_control.py
    "Sales Invoice":     "public/js/sales_return_window.js",
    # warns as soon as a supplier is chosen that they already hold an unbilled advance;
    # the refusal itself is server-side, in api/po_advance_block.py
    "Purchase Order":    "public/js/po_advance_block.js",
}

# ─── Fixtures ─────────────────────────────────────────────────────────────────
fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                [
                    "Leave Application-custom_previous_approvers",
                    "Expense Claim-custom_previously_approved_by",
                    "Leave Application-custom_rejection_reason",
                    "Expense Claim-custom_rejection_reason",
                    "HR Settings-enable_multi_level_leave_approval",
                    "HR Settings-enable_multi_level_expense_claim_approval",
                    "Employee-custom_disable_multilevel_approval",
                    "Employee-pm_approval_section",
                    "Employee-pm_approval_chain",
                    "Employee-pm_leave_substitute",
                    "Account-custom_approval_group",
                    "Purchase Invoice-custom_approval_group",
                    "Purchase Order-custom_verbal",
                    "Purchase Order-custom_verbal_comment",
                    "Purchase Order-custom_approval_group",
                    "Payment Entry-custom_payment_category",
                ],
            ]
        ],
    },
    {
        "doctype": "Notification",
        "filters": [["name", "in", ["PDC Cheque Date Reminder"]]],
    },
]

# ─── Overridden endpoints ─────────────────────────────────────────────────────
# The return window is enforced on save and the invoice form hides the action once the window has
# closed — but a form script only helps once the browser has it, and Frappe re-paints the Create
# menu on every render. Standing in for erpnext's endpoint puts the same answer at the one point
# that cannot be stale: the request that builds the credit note.
override_whitelisted_methods = {
    "erpnext.accounts.doctype.sales_invoice.sales_invoice.make_sales_return":
        "permission_manager.permission_manager.api.sales_return_control.make_sales_return",
}

# ─── Permission query conditions ──────────────────────────────────────────────
permission_query_conditions = {
    "Leave Application": "permission_manager.permission_manager.ladder_approve.leave_application.api.leave_application_permission_query",
    "Expense Claim":     "permission_manager.permission_manager.ladder_approve.expense_claim.api.expense_claim_permission_query",
    "PM Workflow Action": "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.get_permission_query_conditions",
}

has_permission = {
    "PM Workflow Action": "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.has_permission",
}

# ─── Document event hooks ─────────────────────────────────────────────────────
doc_events = {
    # ── Warehouse dashboard real-time notifications ────────────────────────────
    "Material Request": {
        "on_submit": "permission_manager.permission_manager.api.warehouse_notifications.on_material_request_submit",
    },
    "PM Workflow Action": {
        "after_insert": "permission_manager.permission_manager.api.warehouse_notifications.on_pm_workflow_action_insert",
    },
    # Multi-level Leave Approval
    "Leave Application": {
        "before_save":   "permission_manager.permission_manager.ladder_approve.leave_application.api.before_save",
        "before_submit": "permission_manager.permission_manager.ladder_approve.leave_application.api.before_submit",
        "on_update":     "permission_manager.permission_manager.ladder_approve.utils.after_save",
    },
    # Multi-level Expense Claim Approval
    "Expense Claim": {
        "before_save":   "permission_manager.permission_manager.ladder_approve.expense_claim.api.before_save",
        "before_submit": "permission_manager.permission_manager.ladder_approve.expense_claim.api.before_submit",
    },
    # A sales return may only be raised inside the window PM Settings allows. validate, not
    # before_submit: the requirement is that a late return cannot be SAVED, so it cannot be
    # parked in drafts either. Off unless PM Settings enables it.
    "Sales Invoice": {
        "validate": "permission_manager.permission_manager.api.sales_return_control.validate_return_window",
    },
    # Account-driven approval routing: stamp custom_approval_group from the line's
    # expense account (tag accounts, not numbers). Read by PM Workflow conditions.
    "Purchase Invoice": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_purchase_invoice",
    },
    # Tag fixed-asset POs with the Asset group so they route Dept Head → GM → Accountant.
    "Purchase Order": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_purchase_order",
        # validate, not before_submit: the requirement is that the order cannot be SAVED
        # for a supplier already holding an unbilled advance, so a draft cannot be parked
        # either. Off unless PM Settings enables it.
        "validate":      "permission_manager.permission_manager.api.po_advance_block.validate_purchase_order",
    },
    # Categorise supplier payments (advance / PI payment / due) for the Payment Entry workflow.
    "Payment Entry": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_payment_entry",
    },
    # Clearing the cached list of doctypes the backdate rules name
    "PM Settings": {
        "on_update": "permission_manager.permission_manager.api.backdate_control.clear_backdate_cache",
    },
    # PM Workflow engine — fires on every doctype
    "*": {
        # how far back a document may be dated, by role or by user. Costs one cached set
        # lookup on a doctype nobody has written a rule for.
        "validate": [
            "permission_manager.permission_manager.api.backdate_control.validate_posting_date",
        ],
        # a document under an approval workflow may only be submitted from a state that
        # carries doc_status 1; otherwise ERPNext's Submit button walks past the chain
        "before_submit": [
            "permission_manager.permission_manager.workflow.validate_submit_state",
        ],
        "on_update": [
            "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.process_workflow_actions",
        ],
        "on_cancel": [
            "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.process_workflow_actions",
        ],
        "on_trash": [
            "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.process_workflow_actions",
        ],
        "on_update_after_submit": [
            "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.process_workflow_actions",
        ],
    },
}

# ─── Accounting dimensions ────────────────────────────────────────────────────
accounting_dimension_doctypes = ["PM Workflow"]

# ─── Scheduled jobs ───────────────────────────────────────────────────────────
scheduler_events = {
    "daily": [
        "permission_manager.permission_manager.api.approvals.send_approval_reminders",
    ],
}

# ─── After install — create custom fields + sync pages ────────────────────────
after_install = "permission_manager.permission_manager.install.after_install"

# ─── After migrate — sync pages that bench migrate skips ─────────────────────
after_migrate = [
    "permission_manager.permission_manager.install.after_migrate",
]
