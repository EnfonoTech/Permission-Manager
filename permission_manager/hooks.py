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
    # Account-driven approval routing: stamp custom_approval_group from the line's
    # expense account (tag accounts, not numbers). Read by PM Workflow conditions.
    "Purchase Invoice": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_purchase_invoice",
    },
    # Tag fixed-asset POs with the Asset group so they route Dept Head → GM → Accountant.
    "Purchase Order": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_purchase_order",
    },
    # Categorise supplier payments (advance / PI payment / due) for the Payment Entry workflow.
    "Payment Entry": {
        "before_save":   "permission_manager.permission_manager.api.approval_group.stamp_payment_entry",
    },
    # PM Workflow engine — fires on every doctype
    "*": {
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
        # ends snoozes whose date has passed and chases promises that have come due
        "permission_manager.permission_manager.api.dues_reminders.send_dues_reminders",
    ],
}

# ─── After install — create custom fields + sync pages ────────────────────────
after_install = "permission_manager.permission_manager.install.after_install"

# ─── After migrate — sync pages that bench migrate skips ─────────────────────
after_migrate = [
    "permission_manager.permission_manager.install.after_migrate",
]
