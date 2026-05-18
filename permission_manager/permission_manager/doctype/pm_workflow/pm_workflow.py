# Copyright (c) 2026, siva <siva@enfono.com>
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class PMWorkflow(Document):
    # ── Validation ─────────────────────────────────────────────────────────────

    def validate(self):
        self.validate_docstatus()
        self.validate_unique_active_combination()

    def on_update(self):
        from ...workflow import clear_workflow_doctype_cache
        clear_workflow_doctype_cache()
        self.create_custom_field_for_workflow_state()
        self.update_default_workflow_status()

    def on_trash(self):
        from ...workflow import clear_workflow_doctype_cache
        clear_workflow_doctype_cache()

    # ── Helpers ────────────────────────────────────────────────────────────────

    def create_custom_field_for_workflow_state(self):
        """Create a hidden Custom Field for the workflow state if it does not exist."""
        frappe.clear_cache(doctype=self.document_type)
        meta = frappe.get_meta(self.document_type)

        if not meta.get_field(self.workflow_state_field):
            frappe.get_doc(
                {
                    "doctype": "Custom Field",
                    "dt": self.document_type,
                    "fieldname": self.workflow_state_field,
                    "label": self.workflow_state_field.replace("_", " ").title(),
                    "hidden": 1,
                    "allow_on_submit": 1,
                    "no_copy": 1,
                    "fieldtype": "Link",
                    "options": "Workflow State",
                    "owner": "Administrator",
                }
            ).insert(ignore_permissions=True)

            frappe.msgprint(
                _("Created Custom Field {0} in {1}").format(
                    self.workflow_state_field, self.document_type
                )
            )

    def update_default_workflow_status(self):
        """Back-fill the workflow state field for existing documents that have none."""
        for d in self.get("states") or []:
            docs_to_update = frappe.get_all(
                self.document_type,
                filters={self.workflow_state_field: ["in", ["", None]], "docstatus": d.doc_status},
                pluck="name",
            )
            for name in docs_to_update:
                frappe.db.set_value(self.document_type, name, self.workflow_state_field, d.state)

    def validate_docstatus(self):
        """Prevent illegal docstatus transitions in the transition table."""

        def get_state(state_name):
            for s in self.states:
                if s.state == state_name:
                    return s
            frappe.throw(_("{0} is not a valid State").format(state_name))

        for t in self.transitions:
            state = get_state(t.state)
            next_state = get_state(t.next_state)

            if state.doc_status == "2":
                frappe.throw(
                    _("Cannot change state of a Cancelled Document (Transition row {0})").format(t.idx)
                )
            if state.doc_status == "1" and next_state.doc_status == "0":
                frappe.throw(
                    _("Submitted Document cannot revert to Draft (Transition row {0})").format(t.idx)
                )
            if state.doc_status == "0" and next_state.doc_status == "2":
                frappe.throw(
                    _("Cannot cancel before submitting (Transition row {0})").format(t.idx)
                )

    def validate_unique_active_combination(self):
        """
        Ensure only one active PM Workflow exists per unique combination of
        document_type, company, user, project, cost_center, and accounting dimensions.
        """
        if not self.document_type:
            frappe.throw(_("Document Type is required."))

        if not self.is_active:
            return

        existing_standard = frappe.db.exists(
            "Workflow", {"document_type": self.document_type, "is_active": 1}
        )
        if existing_standard:
            frappe.throw(
                _(
                    "An active standard workflow already exists for {0}. "
                    "Please deactivate it before activating this PM Workflow.<br><br>"
                    "<a href='/app/workflow/{1}' target='_blank'><strong>View Existing Workflow</strong></a>"
                ).format(self.document_type, existing_standard)
            )

        accounting_dimensions = (
            frappe.get_all("Accounting Dimension", filters={"disabled": 0}, pluck="fieldname") or []
        )

        filters = {
            "document_type": self.document_type,
            "is_active": 1,
            "name": ["!=", self.name],
            "company": self.company or ["in", [None, ""]],
            "user": self.user or ["in", [None, ""]],
            "project": self.project or ["in", [None, ""]],
            "cost_center": self.cost_center or ["in", [None, ""]],
        }

        active_dims = []
        for dim in accounting_dimensions:
            if hasattr(self, dim):
                active_dims.append(dim)
                if getattr(self, dim):
                    filters[dim] = getattr(self, dim)

        existing_workflows = frappe.get_all(
            "PM Workflow",
            filters=filters,
            fields=["name", "document_type", *active_dims],
        )

        if existing_workflows:
            existing = existing_workflows[0]
            matching = [_("Document Type: <strong>{0}</strong>").format(self.document_type)]
            for dim in accounting_dimensions:
                cur_val = getattr(self, dim, None)
                ex_val = existing.get(dim)
                if cur_val and ex_val and cur_val == ex_val:
                    lbl = frappe.get_meta("PM Workflow").get_field(dim).label
                    matching.append(_("{0}: <strong>{1}</strong>").format(lbl, cur_val))

            items_html = "".join(f"<li>{item}</li>" for item in matching)
            frappe.throw(
                _(
                    "<h4 style='color:#e74c3c;'>🚫 Duplicate Active Workflow Detected</h4>"
                    "<div style='background:#f8f9fa;padding:15px;border-radius:5px;margin-bottom:15px;'>"
                    "<p><strong>Matching Criteria:</strong></p>"
                    f"<ul>{items_html}</ul></div>"
                    "<p>The workflow <a href='/app/nl-workflow/{name}' target='_blank'>"
                    "<strong>{name}</strong></a> is already active with the same combination.</p>"
                    "<div style='background:#fff3cd;padding:12px;border-radius:5px;border-left:4px solid #ffc107;'>"
                    "<strong>💡 Resolution:</strong> Deactivate the existing workflow or make this one unique."
                    "</div>"
                ).format(name=existing.name),
                title=_("Duplicate Workflow Configuration"),
            )


@frappe.whitelist()
def get_workflow_state_count(doctype: str, workflow_state_field: str, states):
    frappe.has_permission(doctype=doctype, ptype="read", throw=True)
    states = frappe.parse_json(states)

    meta = frappe.get_meta(doctype)
    if workflow_state_field not in meta.get_valid_columns():
        return []

    return frappe.get_all(
        doctype,
        fields=[workflow_state_field, {"COUNT": "*", "as": "count"}],
        filters={workflow_state_field: ["not in", states]},
        group_by=workflow_state_field,
    )
