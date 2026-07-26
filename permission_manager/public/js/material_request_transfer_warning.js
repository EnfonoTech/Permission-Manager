// permission_manager/public/js/material_request_transfer_warning.js
// Warns on a submitted Material Transfer request that transfers already exist against it.
//
// ERPNext counts only SUBMITTED Stock Entry rows towards ordered_qty, so a transfer held in
// Draft or Pending Acceptance leaves the request looking untouched — status Pending, 0% ordered
// — and the next person raises it again. See api/material_request_transfers.py.

frappe.ui.form.on("Material Request", {
	refresh(frm) {
		frm.dashboard.clear_comment();
		if (frm.doc.docstatus !== 1) return;
		if (frm.doc.material_request_type !== "Material Transfer") return;

		frappe.call({
			method: "permission_manager.permission_manager.api.material_request_transfers.get_transfer_summary",
			args: { material_request: frm.doc.name },
			callback(r) {
				const d = r.message;
				if (!d || d.verdict === "none") return;
				frm.dashboard.add_comment(
					pm_transfer_banner(d),
					d.verdict === "partial" ? "orange" : "red",
					true
				);
			},
		});
	},
});

function pm_transfer_banner(d) {
	const fmt = (n) => format_number(n, null, 2).replace(/\.00$/, "");
	const t = d.totals || {};

	// The line that decides whether someone raises another transfer, so it leads.
	let lead = "";
	if (d.verdict === "partial") {
		lead =
			`<b>${__("Transfers already exist for this request")}</b> — ` +
			__("{0} of {1} transferred, {2} still outstanding. Transfer only the remainder.", [
				fmt(t.submitted + t.pending),
				fmt(t.requested),
				fmt(t.remaining),
			]);
	} else if (d.verdict === "covered") {
		lead =
			`<b>${__("This request is already fully transferred")}</b> — ` +
			__("{0} of {1} is covered. Do not raise another transfer.", [
				fmt(t.submitted + t.pending),
				fmt(t.requested),
			]);
	} else {
		lead =
			`<b>${__("More has been transferred than requested")}</b> — ` +
			__("{0} against a request for {1}. Cancel the duplicates.", [
				fmt(t.submitted + t.pending),
				fmt(t.requested),
			]);
	}

	// Why the status field disagrees — otherwise the banner looks like it is the one lying.
	let caveat = "";
	if (t.pending > 0) {
		caveat =
			`<div style="margin-top:4px">` +
			__("{0} of that is awaiting approval, which ERPNext does not count — so this request still reads {1}.", [
				fmt(t.pending),
				`<b>${__(d.status)}</b>`,
			]) +
			`</div>`;
	}

	const rows = (d.stock_entries || [])
		.map((se) => {
			const state = se.docstatus === 1 ? __("Submitted") : se.workflow_state || __("Draft");
			const route = `/app/stock-entry/${encodeURIComponent(se.name)}`;
			const where =
				se.from_warehouse && se.to_warehouse
					? ` &nbsp;·&nbsp; ${frappe.utils.escape_html(se.from_warehouse)} → ${frappe.utils.escape_html(se.to_warehouse)}`
					: "";
			return (
				`<div style="padding:3px 0">` +
				`<a href="${route}">${frappe.utils.escape_html(se.name)}</a>` +
				` &nbsp;·&nbsp; ${frappe.utils.escape_html(state)}` +
				` &nbsp;·&nbsp; ${fmt(se.qty)}` +
				`${where}` +
				`</div>`
			);
		})
		.join("");

	const list = rows
		? `<div style="margin-top:8px">` +
		  `<div style="font-weight:600;margin-bottom:2px">${__("Existing transfers")}</div>${rows}</div>`
		: "";

	return `<div>${lead}${caveat}${list}</div>`;
}
