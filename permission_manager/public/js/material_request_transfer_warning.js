// permission_manager/public/js/material_request_transfer_warning.js
// Warns on a submitted Material Transfer request that transfers already exist against it.
//
// ERPNext counts only SUBMITTED Stock Entry rows towards ordered_qty, so a transfer held in
// Draft or Pending Acceptance leaves the request looking untouched — status Pending, 0% ordered
// — and the next person raises it again. See api/material_request_transfers.py.
//
// The banner deliberately does NOT use frm.dashboard.set_headline / add_comment. There is one
// headline per form and sf_trading's own material_request.js clears it on every refresh, so a
// headline set here is wiped a moment later. This owns its own block instead.

frappe.ui.form.on("Material Request", {
	refresh(frm) {
		frm.$wrapper.find(".pm-transfer-warning").remove();
		if (frm.doc.docstatus !== 1) return;
		if (frm.doc.material_request_type !== "Material Transfer") return;

		frappe.call({
			method: "permission_manager.permission_manager.api.material_request_transfers.get_transfer_summary",
			args: { material_request: frm.doc.name },
			callback(r) {
				const d = r.message;
				if (!d || d.verdict === "none") return;
				// the form may have moved on while the call was in flight
				if (frm.doc.name !== d.material_request) return;
				frm.$wrapper.find(".pm-transfer-warning").remove();
				$(pm_transfer_warning_html(d)).prependTo(frm.$wrapper.find(".form-layout").first());
			},
		});
	},
});

function pm_transfer_warning_html(d) {
	const e = frappe.utils.escape_html;
	const fmt = (n) => format_number(n, null, 2).replace(/\.00$/, "");
	const t = d.totals || {};
	const moved = (t.submitted || 0) + (t.pending || 0);
	const partial = d.verdict === "partial";

	// Amber for a partial (a further transfer is legitimate), red once it is covered or exceeded.
	const accent = partial ? "#BA7517" : "#A32D2D";
	const tint = partial ? "#FAEEDA" : "#FCEBEB";

	let lead;
	if (partial) {
		lead = __("{0} of {1} already transferred — transfer only the remaining {2}", [
			`<b>${fmt(moved)}</b>`,
			fmt(t.requested),
			`<b>${fmt(t.remaining)}</b>`,
		]);
	} else if (d.verdict === "covered") {
		lead = __("Already fully transferred ({0} of {1}) — do not raise another transfer", [
			`<b>${fmt(moved)}</b>`,
			fmt(t.requested),
		]);
	} else {
		lead = __("More has been transferred than requested — {0} against a request for {1}", [
			`<b>${fmt(moved)}</b>`,
			fmt(t.requested),
		]);
	}

	// Without this the banner reads as though it is the one lying: the status field says Pending
	// because ERPNext ignores everything that is not submitted.
	let caveat = "";
	if (t.pending > 0) {
		caveat =
			`<div style="font-size:11px;color:var(--text-muted);margin-top:3px">` +
			__("{0} of that is still awaiting approval, which ERPNext does not count — so this request still reads {1}.", [
				fmt(t.pending),
				`<b>${e(__(d.status || ""))}</b>`,
			]) +
			`</div>`;
	}

	const rows = (d.stock_entries || [])
		.map((se) => {
			const state = se.docstatus === 1 ? __("Submitted") : se.workflow_state || __("Draft");
			const where =
				se.from_warehouse && se.to_warehouse
					? ` &nbsp;·&nbsp; ${e(se.from_warehouse)} → ${e(se.to_warehouse)}`
					: "";
			return (
				`<div style="display:flex;gap:10px;align-items:center;font-size:11px;padding:3px 0;border-top:1px solid var(--border-color)">` +
				`<a href="/app/stock-entry/${encodeURIComponent(se.name)}" style="min-width:150px">${e(se.name)}</a>` +
				`<span style="color:var(--text-muted)">${e(state)}${where}</span>` +
				`<span style="margin-left:auto">${fmt(se.qty)}</span>` +
				`</div>`
			);
		})
		.join("");

	return (
		`<div class="pm-transfer-warning" style="border:1px solid var(--border-color);border-left:3px solid ${accent};background:${tint};padding:10px 12px;margin-bottom:12px">` +
		`<div style="font-size:13px;font-weight:600;color:${accent}">${lead}</div>` +
		caveat +
		(rows
			? `<div style="margin-top:8px;background:var(--card-bg);border-radius:6px;padding:6px 10px">` +
			  `<div style="font-size:11px;font-weight:600;margin-bottom:2px">${__("Existing transfers")}</div>${rows}</div>`
			: "") +
		`</div>`
	);
}
