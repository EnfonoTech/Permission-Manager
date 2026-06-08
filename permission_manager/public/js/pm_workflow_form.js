frappe.ui.form.on("PM Workflow", {
    refresh(frm) {
        frm.add_custom_button(__("View Diagram"), () => {
            if (!frm.doc.name || frm.doc.__islocal) {
                frappe.msgprint(__("Save the workflow before viewing the diagram."));
                return;
            }
            const diag = new window.permission_manager_studio.WorkflowDiagram({
                wrapper: $("<div>"),
                workflow_name: frm.doc.name,
            });
            diag.show_dialog();
        }, __("Actions"));
    },
});
