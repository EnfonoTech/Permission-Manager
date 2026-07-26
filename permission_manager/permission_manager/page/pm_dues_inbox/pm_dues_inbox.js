// permission_manager/permission_manager/page/pm_dues_inbox/pm_dues_inbox.js
// Dues Inbox — everything falling due in one worklist, built from PM Dues Source rows.
// The API returns the whole scoped set once; every chip filters in memory so the page feels
// instant and an accountant can pivot without a round trip.

frappe.pages["pm-dues-inbox"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Dues Inbox"),
		single_column: true,
	});

	const state = {
		data: null,
		source: null,
		bucket: null,
		worklist: null,
		search: "",
		collapsed: {},
	};

	const $body = $('<div class="dues-inbox"></div>').appendTo(page.main);

	page.add_field({
		fieldname: "company",
		label: __("Company"),
		fieldtype: "Link",
		options: "Company",
		default: frappe.defaults.get_user_default("Company"),
		change: load,
	});
	page.add_field({
		fieldname: "branch",
		label: __("Branch"),
		fieldtype: "Link",
		options: "Branch",
		change: load,
	});
	page.add_field({
		fieldname: "as_on",
		label: __("As On"),
		fieldtype: "Date",
		default: frappe.datetime.get_today(),
		change: load,
	});

	page.set_primary_action(__("Refresh"), load, "refresh");
	page.add_menu_item(__("Manage sources"), () => frappe.set_route("List", "PM Dues Source"));
	page.add_menu_item(__("All follow-ups"), () => frappe.set_route("List", "PM Dues Follow Up"));

	dues_styles();
	load();

	function values() {
		const v = {};
		["company", "branch", "as_on"].forEach((f) => {
			const val = page.fields_dict[f].get_value();
			if (val) v[f] = val;
		});
		return v;
	}

	function load() {
		$body.html(dues_skeleton());
		frappe.call({
			method: "permission_manager.permission_manager.api.dues_inbox.get_dues_inbox",
			args: values(),
			callback(r) {
				state.data = r.message;
				render();
			},
			error() {
				$body.html(
					`<div class="dues-empty"><div class="dues-empty-icon">${frappe.utils.icon(
						"solid-warning",
						"lg"
					)}</div><p>${__("Could not load the inbox. Check the Error Log.")}</p></div>`
				);
			},
		});
	}

	// ── filtering ─────────────────────────────────────────────────────────────

	function visible_rows() {
		const d = state.data;
		if (!d) return [];
		let rows = d.rows || [];
		// snoozed rows are out of the way unless the snoozed chip is picked
		rows = state.worklist === "snoozed" ? rows.filter((r) => r.snoozed) : rows.filter((r) => !r.snoozed);
		if (state.source) rows = rows.filter((r) => r.source === state.source);
		if (state.bucket) rows = rows.filter((r) => r.bucket === state.bucket);
		if (state.worklist && state.worklist !== "snoozed") {
			rows =
				state.worklist === "due_today"
					? rows.filter((r) => r.days_overdue === 0)
					: rows.filter((r) => r.worklist === state.worklist);
		}
		if (state.search) {
			const q = state.search.toLowerCase();
			rows = rows.filter(
				(r) =>
					(r.party || "").toLowerCase().includes(q) ||
					(r.voucher || "").toLowerCase().includes(q) ||
					(r.branch || "").toLowerCase().includes(q)
			);
		}
		return rows;
	}

	// ── render ────────────────────────────────────────────────────────────────

	function render() {
		const d = state.data;
		if (!d) return;
		const rows = visible_rows();
		const cur = d.currency;

		let html = "";
		html += kpi_strip(d, cur);
		html += chip_bars(d, rows);
		html += rows.length ? groups_html(rows, cur) : empty_html(d);
		if ((d.skipped_sources || []).length) {
			html +=
				`<div class="dues-skipped">${frappe.utils.icon("solid-warning", "sm")} ` +
				__("These sources could not be read and were skipped: {0}", [
					d.skipped_sources.join(", "),
				]) +
				`</div>`;
		}
		$body.html(html);
		bind();
	}

	function kpi_strip(d, cur) {
		const k = d.kpis || {};
		const dir = k.by_direction || {};
		const money = (v) => format_currency(v || 0, cur, 0);
		const card = (cls, icon, label, value, sub) =>
			`<div class="dues-kpi ${cls}"><div class="dues-kpi-top">${frappe.utils.icon(
				icon,
				"sm"
			)}<span>${label}</span></div><div class="dues-kpi-val">${value}</div>` +
			`<div class="dues-kpi-sub">${sub || "&nbsp;"}</div></div>`;

		const recv = dir["Receivable"] || {};
		const pay = dir["Payable"] || {};
		const inst = dir["Instrument"] || {};

		return (
			`<div class="dues-kpis">` +
			card("k-recv", "arrow-down", __("To collect"), money(recv.overdue), __("{0} vouchers", [recv.count || 0])) +
			card("k-pay", "arrow-up", __("To pay"), money(pay.overdue), __("{0} vouchers", [pay.count || 0])) +
			card("k-inst", "small-file", __("Instruments due"), money(inst.overdue), __("{0} items", [inst.count || 0])) +
			card("k-today", "calendar", __("Due today"), k.due_today || 0, __("as on {0}", [frappe.datetime.str_to_user(d.as_on)])) +
			card("k-old", "clock", __("Oldest"), (k.oldest_days || 0) + "d", __("{0} live rows", [k.live_rows || 0])) +
			`</div>` +
			(d.company
				? ""
				: `<div class="dues-skipped">${frappe.utils.icon("solid-warning", "sm")} ` +
				  __("Pick a company — this site has more than one, and amounts cannot be totalled across currencies.") +
				  `</div>`)
		);
	}

	function chip_bars(d, rows) {
		const cur = d.currency;
		const counts = {};
		(d.rows || []).filter((r) => !r.snoozed).forEach((r) => {
			counts[r.source] = (counts[r.source] || 0) + 1;
		});

		let src_chips = chip("", __("All streams"), (d.rows || []).filter((r) => !r.snoozed).length, !state.source, "source");
		(d.sources || []).forEach((s) => {
			src_chips += chip(s.name, s.label, counts[s.name] || 0, state.source === s.name, "source", s.accent);
		});

		const b = d.buckets || {};
		const bucket_label = { not_due: __("Not due"), "0-30": "0-30", "31-60": "31-60", "61-90": "61-90", "90+": "90+" };
		let bucket_chips = chip("", __("Any age"), null, !state.bucket, "bucket");
		Object.keys(bucket_label).forEach((key) => {
			const entry = b[key] || {};
			if (!entry.count) return;
			bucket_chips += chip(
				key,
				bucket_label[key],
				entry.count,
				state.bucket === key,
				"bucket",
				null,
				format_currency(entry.amount || 0, cur, 0)
			);
		});

		const w = d.worklists || {};
		const work = [
			["", __("Everything"), null],
			["untouched", __("Untouched"), w.untouched],
			["due_today", __("Due today"), w.due_today],
			["promised", __("Promised"), w.promised],
			["snoozed", __("Snoozed"), w.snoozed],
		];
		let work_chips = "";
		work.forEach(([key, label, count]) => {
			if (key && !count) return;
			work_chips += chip(key, label, count, (state.worklist || "") === key, "worklist");
		});

		return (
			`<div class="dues-bars">` +
			`<div class="dues-bar">${src_chips}</div>` +
			`<div class="dues-bar dues-bar-sub">${work_chips}<span class="dues-bar-gap"></span>${bucket_chips}` +
			`<input class="dues-search" type="text" placeholder="${__("Search party or voucher")}" value="${frappe.utils.escape_html(
				state.search
			)}">` +
			`</div></div>`
		);
	}

	function chip(value, label, count, active, kind, accent, extra) {
		const cls = "dues-chip" + (active ? " is-active" : "") + (accent ? " accent-" + accent.toLowerCase() : "");
		return (
			`<span class="${cls}" data-kind="${kind}" data-value="${frappe.utils.escape_html(value)}">` +
			frappe.utils.escape_html(label) +
			(count || count === 0 ? `<b>${count}</b>` : "") +
			(extra ? `<i>${extra}</i>` : "") +
			`</span>`
		);
	}

	function groups_html(rows, cur) {
		const by_source = {};
		rows.forEach((r) => (by_source[r.source] = by_source[r.source] || []).push(r));

		let html = "";
		(state.data.sources || []).forEach((s) => {
			const group = by_source[s.name];
			if (!group) return;
			const total = group.reduce((sum, r) => sum + (r.amount || 0), 0);
			const collapsed = !!state.collapsed[s.name];
			html +=
				`<div class="dues-group accent-${(s.accent || "amber").toLowerCase()}">` +
				`<div class="dues-group-hdr" data-source="${frappe.utils.escape_html(s.name)}">` +
				`<span class="dues-caret">${collapsed ? "▸" : "▾"}</span>` +
				`<span class="dues-group-title">${frappe.utils.escape_html(s.label)}</span>` +
				`<span class="dues-dir">${__(s.direction)}</span>` +
				`<span class="dues-group-total">${format_currency(total, cur, 0)}` +
				`<em>${__("{0} rows", [group.length])}</em></span></div>`;
			if (!collapsed) html += group.map((r) => row_html(r, cur)).join("");
			html += `</div>`;
		});
		return html;
	}

	function row_html(r, cur) {
		const e = frappe.utils.escape_html;
		const overdue = r.days_overdue;
		const age =
			overdue < 0
				? `<span class="dues-age is-future">${__("in {0}d", [Math.abs(overdue)])}</span>`
				: `<span class="dues-age ${overdue > 90 ? "is-bad" : overdue > 30 ? "is-warn" : ""}">${
						overdue === 0 ? __("today") : __("{0}d late", [overdue])
				  }</span>`;

		const state_pill =
			r.state && r.state !== "Open"
				? `<span class="dues-pill s-${r.state.toLowerCase()}">${__(r.state)}${
						r.promised_date ? " · " + frappe.datetime.str_to_user(r.promised_date) : ""
				  }</span>`
				: `<span class="dues-pill s-open">${__("Untouched")}</span>`;

		const pay_label = r.direction === "Receivable" ? __("Collect") : __("Pay");
		const can_pay = state.data.can_make_payment_entry && r.direction !== "Instrument";

		return (
			`<div class="dues-row" data-voucher="${e(r.voucher)}" data-doctype="${e(r.voucher_doctype)}">` +
			`<div class="dues-cell dues-party">` +
			`<span class="dues-party-name">${e(r.party || r.voucher)}</span>` +
			`<span class="dues-meta"><a href="/app/${frappe.router.slug(r.voucher_doctype)}/${encodeURIComponent(
				r.voucher
			)}">${e(r.voucher)}</a>${r.branch ? " · " + e(r.branch) : ""}${
				r.owner_user ? " · " + e(r.owner_user.split("@")[0]) : ""
			}</span></div>` +
			`<div class="dues-cell dues-when"><span>${
				r.due_date ? frappe.datetime.str_to_user(r.due_date) : "—"
			}</span>${age}</div>` +
			`<div class="dues-cell dues-amt">${format_currency(r.amount, cur, 2)}</div>` +
			`<div class="dues-cell dues-state">${state_pill}${
				r.note ? `<span class="dues-note" title="${e(r.note)}">${frappe.utils.icon("small-message", "xs")}</span>` : ""
			}</div>` +
			`<div class="dues-cell dues-actions">` +
			`<button class="btn btn-xs dues-followup">${__("Follow up")}</button>` +
			(can_pay ? `<button class="btn btn-xs dues-pay">${pay_label}</button>` : "") +
			`</div></div>`
		);
	}

	function empty_html(d) {
		const nothing_configured = !(d.sources || []).length;
		return (
			`<div class="dues-empty"><div class="dues-empty-icon">${frappe.utils.icon(
				nothing_configured ? "setting-gear" : "solid-success",
				"lg"
			)}</div>` +
			`<p>${nothing_configured ? __("No dues sources are configured yet.") : __("Nothing matches these filters.")}</p>` +
			(nothing_configured
				? `<button class="btn btn-sm btn-primary dues-configure">${__("Add a source")}</button>`
				: `<button class="btn btn-sm dues-clear">${__("Clear filters")}</button>`) +
			`</div>`
		);
	}

	// ── interaction ───────────────────────────────────────────────────────────

	function bind() {
		$body.find(".dues-chip").on("click", function () {
			const kind = $(this).data("kind");
			const value = String($(this).data("value") || "");
			state[kind] = value || null;
			render();
		});

		$body.find(".dues-search").on("input", frappe.utils.debounce(function () {
			state.search = $(this).val();
			const $input = $body.find(".dues-search");
			const pos = $input[0] ? $input[0].selectionStart : null;
			render();
			const $new = $body.find(".dues-search").focus();
			if (pos !== null && $new[0]) $new[0].setSelectionRange(pos, pos);
		}, 200));

		$body.find(".dues-group-hdr").on("click", function () {
			const src = $(this).data("source");
			state.collapsed[src] = !state.collapsed[src];
			render();
		});

		$body.find(".dues-clear").on("click", () => {
			state.source = state.bucket = state.worklist = null;
			state.search = "";
			render();
		});
		$body.find(".dues-configure").on("click", () => frappe.set_route("List", "PM Dues Source"));

		$body.find(".dues-followup").on("click", function (ev) {
			ev.stopPropagation();
			follow_up_dialog(row_of(this));
		});
		$body.find(".dues-pay").on("click", function (ev) {
			ev.stopPropagation();
			make_payment(row_of(this));
		});
	}

	function row_of(el) {
		const $row = $(el).closest(".dues-row");
		const voucher = $row.data("voucher");
		const doctype = $row.data("doctype");
		return (state.data.rows || []).find((r) => r.voucher === voucher && r.voucher_doctype === doctype);
	}

	function follow_up_dialog(row) {
		if (!row) return;
		const d = new frappe.ui.Dialog({
			title: __("Follow up on {0}", [row.voucher]),
			fields: [
				{
					fieldtype: "HTML",
					options:
						`<div class="dues-dialog-head"><b>${frappe.utils.escape_html(row.party || "")}</b>` +
						`<span>${format_currency(row.amount, state.data.currency, 2)} · ${
							row.days_overdue >= 0 ? __("{0} days late", [row.days_overdue]) : __("not yet due")
						}</span></div>`,
				},
				{
					fieldname: "state",
					label: __("State"),
					fieldtype: "Select",
					reqd: 1,
					default: row.state || "Open",
					options: ["Open", "Contacted", "Promised", "Snoozed", "Disputed", "Escalated", "Settled"].join("\n"),
				},
				{
					fieldname: "promised_date",
					label: __("Promised Date"),
					fieldtype: "Date",
					default: row.promised_date || null,
					depends_on: "eval:doc.state=='Promised'",
					mandatory_depends_on: "eval:doc.state=='Promised'",
				},
				{
					fieldname: "snooze_until",
					label: __("Snooze Until"),
					fieldtype: "Date",
					default: row.snooze_until || null,
					depends_on: "eval:doc.state=='Snoozed'",
					mandatory_depends_on: "eval:doc.state=='Snoozed'",
					description: __("Hidden from the worklist until this date"),
				},
				{
					fieldname: "owner_user",
					label: __("Owned By"),
					fieldtype: "Link",
					options: "User",
					default: row.owner_user || frappe.session.user,
				},
				{ fieldname: "note", label: __("Note"), fieldtype: "Small Text", default: row.note || "" },
			],
			primary_action_label: __("Save"),
			primary_action(v) {
				frappe.call({
					method: "permission_manager.permission_manager.api.dues_inbox.save_follow_up",
					args: {
						voucher_doctype: row.voucher_doctype,
						voucher: row.voucher,
						source: row.source,
						party: row.party,
						party_type: row.party_type,
						company: row.company,
						state: v.state,
						promised_date: v.promised_date,
						snooze_until: v.snooze_until,
						note: v.note,
						owner_user: v.owner_user,
					},
					freeze: true,
					callback() {
						d.hide();
						frappe.show_alert({ message: __("Follow-up saved"), indicator: "green" }, 4);
						load();
					},
				});
			},
		});
		d.show();
	}

	function make_payment(row) {
		if (!row) return;
		frappe.call({
			method: "permission_manager.permission_manager.api.dues_inbox.make_payment_entry",
			args: { voucher_doctype: row.voucher_doctype, voucher: row.voucher },
			freeze: true,
			freeze_message: __("Preparing payment…"),
			callback(r) {
				if (!r.message) return;
				const doc = frappe.model.sync(r.message)[0];
				frappe.set_route("Form", doc.doctype, doc.name);
			},
		});
	}

	function dues_skeleton() {
		let bars = "";
		for (let i = 0; i < 5; i++) bars += `<div class="dues-skel-row"></div>`;
		return `<div class="dues-skel">${bars}</div>`;
	}
};

function dues_styles() {
	if (document.getElementById("dues-inbox-styles")) return;
	const css = `
.dues-inbox { padding: 4px 0 32px; }
.dues-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.dues-kpi { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 11px 13px; position: relative; overflow: hidden; }
.dues-kpi::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; }
.dues-kpi.k-recv::before { background: #1D9E75; }
.dues-kpi.k-pay::before { background: #D85A30; }
.dues-kpi.k-inst::before { background: #7F77DD; }
.dues-kpi.k-today::before { background: #378ADD; }
.dues-kpi.k-old::before { background: #BA7517; }
.dues-kpi-top { display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-muted); }
.dues-kpi-val { font-size: 22px; font-weight: 700; letter-spacing: -.5px; margin-top: 5px; color: var(--heading-color); }
.dues-kpi-sub { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.dues-bars { margin-bottom: 12px; }
.dues-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dues-bar-sub { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
.dues-bar-gap { flex: 0 0 14px; }
.dues-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color); cursor: pointer; user-select: none; }
.dues-chip:hover { border-color: var(--primary); color: var(--primary); }
.dues-chip b { font-weight: 700; background: var(--bg-color); border-radius: 10px; padding: 0 6px; font-size: 10px; }
.dues-chip i { font-style: normal; color: var(--text-muted); font-weight: 400; font-size: 10px; }
.dues-chip.is-active { background: var(--primary); border-color: var(--primary); color: #fff; }
.dues-chip.is-active b, .dues-chip.is-active i { background: rgba(255,255,255,.22); color: #fff; }
.dues-search { margin-left: auto; font-size: 11px; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color); min-width: 190px; }
.dues-group { border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
.dues-group-hdr { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--control-bg); cursor: pointer; border-left: 3px solid var(--border-color); }
.dues-group.accent-amber .dues-group-hdr { border-left-color: #BA7517; }
.dues-group.accent-red .dues-group-hdr { border-left-color: #A32D2D; }
.dues-group.accent-blue .dues-group-hdr { border-left-color: #378ADD; }
.dues-group.accent-teal .dues-group-hdr { border-left-color: #1D9E75; }
.dues-group.accent-purple .dues-group-hdr { border-left-color: #7F77DD; }
.dues-caret { font-size: 10px; color: var(--text-muted); }
.dues-group-title { font-size: 12px; font-weight: 700; color: var(--heading-color); }
.dues-dir { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
.dues-group-total { margin-left: auto; font-size: 12px; font-weight: 700; text-align: right; }
.dues-group-total em { display: block; font-style: normal; font-size: 10px; font-weight: 400; color: var(--text-muted); }
.dues-row { display: grid; grid-template-columns: minmax(0,2.3fr) 1fr 1fr 1.1fr auto; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border-color); background: var(--card-bg); }
.dues-row:hover { background: var(--control-bg); }
.dues-cell { min-width: 0; font-size: 12px; }
.dues-party-name { display: block; font-weight: 600; color: var(--heading-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dues-meta { display: block; font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dues-when span { display: block; }
.dues-age { font-size: 10px; font-weight: 700; }
.dues-age.is-warn { color: #BA7517; }
.dues-age.is-bad { color: #A32D2D; }
.dues-age.is-future { color: var(--text-muted); font-weight: 400; }
.dues-amt { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.dues-state { display: flex; align-items: center; gap: 4px; }
.dues-pill { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--bg-color); color: var(--text-muted); white-space: nowrap; }
.dues-pill.s-promised { background: #E6F1FB; color: #185FA5; }
.dues-pill.s-contacted { background: #FAEEDA; color: #854F0B; }
.dues-pill.s-snoozed { background: var(--control-bg); color: var(--text-muted); }
.dues-pill.s-disputed, .dues-pill.s-escalated { background: #FCEBEB; color: #A32D2D; }
.dues-pill.s-settled { background: #EAF3DE; color: #3B6D11; }
.dues-note { color: var(--text-muted); }
.dues-actions { display: flex; gap: 5px; }
.dues-empty { text-align: center; padding: 48px 20px; color: var(--text-muted); }
.dues-empty-icon { margin-bottom: 8px; }
.dues-empty p { font-size: 13px; margin-bottom: 10px; }
.dues-skipped { margin-top: 10px; font-size: 11px; color: #854F0B; display: flex; align-items: center; gap: 6px; }
.dues-dialog-head { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; margin-bottom: 4px; border-bottom: 1px solid var(--border-color); }
.dues-dialog-head span { font-size: 11px; color: var(--text-muted); }
.dues-skel-row { height: 44px; border-radius: 8px; background: var(--control-bg); margin-bottom: 8px; animation: dues-pulse 1.4s ease-in-out infinite; }
@keyframes dues-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
@media (max-width: 768px) {
  .dues-row { grid-template-columns: 1fr auto; row-gap: 4px; }
  .dues-when, .dues-state { grid-column: 1 / -1; }
  .dues-search { margin-left: 0; width: 100%; }
}`;
	$('<style id="dues-inbox-styles">').text(css).appendTo(document.head);
}
