// Do not offer a return the save is going to refuse.
//
// The refusal itself is server-side (api/sales_return_control.py) and fires on save. On its own
// that means somebody opens Create → Return / Credit Note on a five-week-old invoice, fills in a
// credit note, and only then finds out the window closed — and, worse, an Administrator is
// allowed to override and so sees nothing happen at all, which reads as a control that is not
// working.
//
// So the invoice asks the question up front. Past the window and not allowed to override: the
// action is taken off the Create menu and the reason is shown on the form. Past the window but
// allowed to override: the action stays, with an orange note saying it is an override — the
// server says the same thing again when the return is saved.

frappe.ui.form.on("Sales Invoice", {
	refresh(frm) {
		if (frm.doc.docstatus !== 1 || frm.doc.is_return) return;

		const ticket = frm.doc.name;
		// Frappe re-adds the Create menu on every render, so the answer is remembered and
		// re-applied rather than looked up again on each refresh.
		if (frm.__pm_return_window && frm.__pm_return_window.name === ticket) {
			pm_apply_return_window(frm, frm.__pm_return_window.state);
			return;
		}

		frappe.call({
			method:
				"permission_manager.permission_manager.api.sales_return_control.check_source_return_window",
			args: { doctype: frm.doctype, docname: frm.doc.name },
			callback(r) {
				const state = r && r.message;
				if (!state || frm.doc.name !== ticket) return;
				frm.__pm_return_window = { name: ticket, state };
				pm_apply_return_window(frm, state);
			},
		});
	},
});

function pm_apply_return_window(frm, state) {
	if (!state.enabled || !state.past_window) return;

	const basis =
		state.basis === "Return Posting Date"
			? __("the return's own posting date")
			: __("this invoice's date");

	if (state.blocked) {
		// Frappe re-paints the Create menu on every render, and this answer arrives after a round
		// trip — so the removal is repeated across the next few frames rather than once. Even if a
		// re-paint outruns all of them, the endpoint behind the action refuses anyway
		// (api/sales_return_control.make_sales_return), so the worst case is a button that
		// explains itself instead of a button that is not there.
		const strip = () => frm.remove_custom_button(__("Return / Credit Note"), __("Create"));
		strip();
		[0, 100, 400, 1000].forEach((delay) => setTimeout(strip, delay));

		frm.dashboard.add_indicator(
			__("Return window closed — {0} days old, limit {1}", [state.age, state.days]),
			"red"
		);
		// The same banner the override case gets, so the reason is on the form either way rather
		// than only in the refusal that arrives after a click. Permanent: it is a standing fact
		// about this invoice, not a passing notice.
		frm.dashboard.add_comment(
			__("A return against this invoice would be {0} day(s) past the {1} day window, counted from {2}. Ask someone authorised to override the sales return window.", [
				state.age - state.days,
				state.days,
				basis,
			]),
			"red",
			true
		);
		return;
	}

	frm.dashboard.add_indicator(
		__("Return window passed ({0} days) — you may override", [state.age]),
		"orange"
	);
	frm.dashboard.add_comment(
		__("A return against this invoice is {0} day(s) past the {1} day window, counted from {2}. You are allowed to raise one anyway.", [
			state.age - state.days,
			state.days,
			basis,
		]),
		"yellow",
		true
	);
}
