// permission_manager/public/js/po_advance_block.js
// Warns the buyer, as soon as a supplier is chosen on a new Purchase Order, that the supplier
// is already holding an advance paid against an earlier order nobody has invoiced yet.
//
// This is the courtesy half of the control. The half that actually holds is
// api/po_advance_block.validate_purchase_order, which throws on save — a warning nobody has to
// acknowledge is not a control, and a browser is not a place to enforce anything. Both read the
// same server-side check, so the message here and the refusal there can never disagree.
//
// Gated by PM Settings > Purchase Advance Control. The server answers "enabled: false" when the
// feature is off, so the form stays silent without needing to know the setting.

frappe.ui.form.on("Purchase Order", {
	supplier(frm) {
		pm_check_supplier_advance(frm);
	},

	company(frm) {
		// the block is per company, so changing it changes the answer
		pm_check_supplier_advance(frm);
	},
});

function pm_check_supplier_advance(frm) {
	if (!frm.is_new()) return;
	if (!frm.doc.supplier || !frm.doc.company) return;

	const asked_for = `${frm.doc.supplier}::${frm.doc.company}`;

	frappe.call({
		method: "permission_manager.permission_manager.api.po_advance_block.check_supplier_advance",
		args: {
			supplier: frm.doc.supplier,
			company: frm.doc.company,
			purchase_order: frm.doc.name,
		},
		callback(r) {
			const d = r.message;
			if (!d || !d.enabled || !d.orders || !d.orders.length) return;

			// the buyer may have changed supplier while the call was in flight
			if (`${frm.doc.supplier}::${frm.doc.company}` !== asked_for) return;

			if (d.can_override) {
				// allowed through, but should still know what they are adding to
				frappe.msgprint({
					title: __("Supplier Holds an Unbilled Advance"),
					indicator: "orange",
					message:
						__("{0} is already holding an advance against {1} order(s) with no purchase invoice raised yet:", [
							frm.doc.supplier.bold(),
							d.orders.length,
						]) +
						"<br><br>" +
						d.message +
						"<br><br>" +
						__("You are authorised to raise this order anyway."),
				});
				return;
			}

			frappe.msgprint({
				title: __("Supplier Holds an Unbilled Advance"),
				indicator: "red",
				message:
					__("{0} is already holding an advance against {1} order(s) with no purchase invoice raised yet:", [
						frm.doc.supplier.bold(),
						d.orders.length,
					]) +
					"<br><br>" +
					d.message +
					"<br><br>" +
					__("This order cannot be saved. Raise the purchase invoice against the earlier order, or ask someone authorised to override it."),
			});
		},
	});
}
