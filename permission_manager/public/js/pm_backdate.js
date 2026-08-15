// Permission Manager — backdated entry control, form side
//
// The server refuses a document dated further back than its author may reach
// (api/backdate_control.py). Refusing on save is a poor way to tell someone: they have filled
// the whole form by then. So where a user has no backdating allowance at all, the date is set
// to today and made read-only, and the question never arises.
//
// This is a courtesy, not the control. Everything here can be sidestepped from the console or
// the API; the server-side check is what actually holds. Nothing below ever decides that
// something is *allowed* — it only removes a choice the server would refuse anyway.

function _pm_backdate_rule(frm) {
	const map = (window.frappe && frappe.boot && frappe.boot.pm_backdate) || null;
	if (!map || !frm || !frm.doctype) return null;
	return map[frm.doctype] || null;
}

$(document).on("form-refresh", function (event, frm) {
	const rule = _pm_backdate_rule(frm);
	if (!rule) return;

	const fieldname = rule.date_field;
	if (!fieldname || !frm.fields_dict || !frm.fields_dict[fieldname]) return;

	// An allowance of a day or more leaves a real choice to make, and the server draws the line.
	// Only a user who may not reach back at all has nothing to choose.
	if (rule.days !== 0) return;

	// Never rewrite a document that already exists — its date is a fact, not a proposal, and
	// silently moving it to today on open would be its own kind of damage. An amendment carries
	// the date of the document it amends for the same reason.
	if (!frm.is_new() || frm.doc.amended_from) return;

	if (frm.doc.docstatus !== 0) return;

	const today = frappe.datetime.get_today();
	if (frm.doc[fieldname] !== today) {
		frm.set_value(fieldname, today);
	}
	frm.set_df_property(fieldname, "read_only", 1);
	frm.set_df_property(
		fieldname,
		"description",
		__("Backdating is not enabled for you. Ask an administrator to grant it in PM Settings.")
	);
});
