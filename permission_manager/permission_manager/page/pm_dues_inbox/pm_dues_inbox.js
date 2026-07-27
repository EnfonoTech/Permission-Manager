// permission_manager/permission_manager/page/pm_dues_inbox/pm_dues_inbox.js
// Dues Inbox — everything falling due in one worklist, built from PM Dues Source rows.
// The API returns the whole scoped set once; every chip filters in memory so the page feels
// instant and an accountant can pivot without a round trip.
//
// Amounts are NOT all in one currency: an invoice outstanding is denominated in the party's
// account currency, so totals print per currency and are never added across them.

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

	[
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company",
		  default: frappe.defaults.get_user_default("Company") },
		{ fieldname: "branch", label: __("Branch"), fieldtype: "Link", options: "Branch" },
		{ fieldname: "due_from", label: __("Due From"), fieldtype: "Date" },
		{ fieldname: "due_to", label: __("Due To"), fieldtype: "Date" },
		{ fieldname: "as_on", label: __("As On"), fieldtype: "Date",
		  default: frappe.datetime.get_today() },
	].forEach((df) => page.add_field(Object.assign({ change: load }, df)));

	page.set_primary_action(__("Refresh"), load, "refresh");
	page.add_menu_item(__("Manage sources"), () => frappe.set_route("List", "PM Dues Source"));
	page.add_menu_item(__("Clear date range"), () => {
		page.fields_dict.due_from.set_value("");
		page.fields_dict.due_to.set_value("");
	});

	dues_styles();
	load();

	function values() {
		const v = {};
		["company", "branch", "as_on", "due_from", "due_to"].forEach((f) => {
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

	// ── money ─────────────────────────────────────────────────────────────────
	// One line per currency. A single figure would be a lie the moment a party account is foreign.

	function money(amounts, precision) {
		const keys = Object.keys(amounts || {}).filter((c) => amounts[c]);
		if (!keys.length) return format_currency(0, state.data.company_currency, 0);
		return keys
			.sort()
			.map((c) => format_currency(amounts[c], c, precision === undefined ? 0 : precision))
			.join(`<span class="dues-cur-sep">+</span>`);
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
			if (state.worklist === "due_today") {
				rows = rows.filter((r) => r.days_overdue === 0);
			} else if (state.worklist === "mine") {
				// an overlay, not a bucket: my rows whatever state they are in
				rows = rows.filter((r) => r.owner_user === frappe.session.user);
			} else {
				rows = rows.filter((r) => r.worklist === state.worklist);
			}
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

		let html = `<div class="dues-shell">`;
		html += notices(d);
		html += kpi_strip(d);
		html += chip_bars(d);
		html += rows.length ? groups_html(rows) : empty_html(d);
		html += `</div>`;
		$body.html(html);
		bind();
	}

	function notices(d) {
		let out = "";
		if (!d.company) {
			out += notice("solid-warning",
				__("Pick a company — amounts cannot be totalled across companies."));
		}
		(d.truncated || []).forEach((t) => {
			out += notice("solid-info",
				__("{0}: showing the {1} most overdue of {2}. Narrow the date range to see the rest.",
					[t.source, t.shown, t.total || "?"]));
		});
		(d.skipped_sources || []).forEach((s) => {
			out += notice("solid-warning", __("{0} could not be read: {1}", [s.source, s.reason]));
		});
		return out;
	}

	function notice(icon, text) {
		return `<div class="dues-notice">${frappe.utils.icon(icon, "sm")}<span>${text}</span></div>`;
	}

	function kpi_strip(d) {
		const k = d.kpis || {};
		const dir = k.by_direction || {};
		const card = (cls, icon, label, value, sub) =>
			`<div class="dues-kpi ${cls}"><div class="dues-kpi-top">${frappe.utils.icon(icon, "sm")}` +
			`<span>${label}</span></div><div class="dues-kpi-val">${value}</div>` +
			`<div class="dues-kpi-sub">${sub || "&nbsp;"}</div></div>`;

		const recv = dir["Receivable"] || {};
		const pay = dir["Payable"] || {};
		const inst = dir["Instrument"] || {};

		return (
			`<div class="dues-kpis">` +
			card("k-recv", "arrow-down", __("To collect"), money(recv.amounts),
				__("{0} vouchers", [recv.count || 0])) +
			card("k-pay", "arrow-up", __("To pay"), money(pay.amounts),
				__("{0} vouchers", [pay.count || 0])) +
			card("k-inst", "small-file", __("Instruments due"), money(inst.amounts),
				__("{0} items", [inst.count || 0])) +
			card("k-today", "calendar", __("Due today"), k.due_today || 0,
				__("as on {0}", [frappe.datetime.str_to_user(d.as_on)])) +
			card("k-old", "clock", __("Oldest"), (k.oldest_days || 0) + "d",
				__("{0} live rows", [k.live_rows || 0])) +
			`</div>`
		);
	}

	function chip_bars(d) {
		const live = (d.rows || []).filter((r) => !r.snoozed);
		const counts = {};
		live.forEach((r) => (counts[r.source] = (counts[r.source] || 0) + 1));

		let src_chips = chip("", __("All streams"), live.length, !state.source, "source", null, null,
			__("Every stream you have access to"));
		(d.sources || []).forEach((s) => {
			src_chips += chip(s.name, s.label, counts[s.name] || 0, state.source === s.name, "source",
				s.accent, null, __("{0} — {1}", [s.voucher_doctype, __(s.direction)]));
		});

		const b = d.buckets || {};
		const bucket_label = { not_due: __("Not due"), "0-30": "0-30", "31-60": "31-60",
			"61-90": "61-90", "90+": "90+" };
		let bucket_chips = chip("", __("Any age"), null, !state.bucket, "bucket", null, null,
			__("No ageing filter"));
		Object.keys(bucket_label).forEach((key) => {
			const entry = b[key] || {};
			if (!entry.count) return;
			bucket_chips += chip(key, bucket_label[key], entry.count, state.bucket === key, "bucket",
				null, money(entry.amounts), __("Days past due"));
		});

		const w = d.worklists || {};
		// "Untouched" earns a chip only when it differs from "Everything" — before anyone logs a
		// follow-up the two are the same number, and two chips with one meaning is just noise.
		const work = [
			["", __("Everything"), live.length, __("No follow-up filter")],
			["mine", __("Mine"), w.mine, __("Follow-ups you own")],
			["untouched", __("Untouched"), w.untouched, __("Nothing logged against these yet")],
			["due_today", __("Due today"), w.due_today, __("Falls due exactly today")],
			["promised", __("Promised"), w.promised, __("Party promised a date")],
			["touched", __("In progress"), w.touched, __("Contacted, disputed or escalated")],
			["snoozed", __("Snoozed"), w.snoozed, __("Hidden until their snooze date")],
		];
		let work_chips = "";
		work.forEach(([key, label, count, tip]) => {
			if (key && !count) return;
			if (key === "untouched" && count === live.length) return;
			work_chips += chip(key, label, count, (state.worklist || "") === key, "worklist", null,
				null, tip);
		});

		return (
			`<div class="dues-bars">` +
			`<div class="dues-bar">${src_chips}</div>` +
			`<div class="dues-bar dues-bar-sub">${work_chips}<span class="dues-bar-div"></span>${bucket_chips}` +
			`<input class="dues-search" type="text" placeholder="${__("Search party, voucher or branch")}" ` +
			`value="${frappe.utils.escape_html(state.search)}">` +
			`</div></div>`
		);
	}

	function chip(value, label, count, active, kind, accent, extra, tip) {
		const cls = "dues-chip" + (active ? " is-active" : "") +
			(accent ? " accent-" + accent.toLowerCase() : "");
		return (
			`<span class="${cls}" data-kind="${kind}" data-value="${frappe.utils.escape_html(value)}"` +
			(tip ? ` title="${frappe.utils.escape_html(tip)}"` : "") + `>` +
			frappe.utils.escape_html(label) +
			(count || count === 0 ? `<b>${count}</b>` : "") +
			(extra ? `<i>${extra}</i>` : "") +
			`</span>`
		);
	}

	function groups_html(rows) {
		const by_source = {};
		rows.forEach((r) => (by_source[r.source] = by_source[r.source] || []).push(r));

		let html = "";
		(state.data.sources || []).forEach((s) => {
			const group = by_source[s.name];
			if (!group) return;
			const totals = {};
			group.forEach((r) => {
				const c = r.currency || "";
				totals[c] = (totals[c] || 0) + (r.amount || 0);
			});
			const collapsed = !!state.collapsed[s.name];
			html +=
				`<div class="dues-group accent-${(s.accent || "amber").toLowerCase()}">` +
				`<div class="dues-group-hdr" data-source="${frappe.utils.escape_html(s.name)}">` +
				`<span class="dues-caret">${collapsed ? "▸" : "▾"}</span>` +
				`<span class="dues-group-title">${frappe.utils.escape_html(s.label)}</span>` +
				`<span class="dues-dir dir-${(s.direction || "").toLowerCase()}">${__(s.direction)}</span>` +
				`<span class="dues-group-total">${money(totals, 2)}` +
				`<em>${__("{0} rows", [group.length])}</em></span></div>`;
			if (!collapsed) html += `<div class="dues-rows">` + group.map(row_html).join("") + `</div>`;
			html += `</div>`;
		});
		return html;
	}

	function row_html(r) {
		const e = frappe.utils.escape_html;
		const overdue = r.days_overdue;
		const age =
			overdue < 0
				? `<span class="dues-age is-future">${__("in {0}d", [Math.abs(overdue)])}</span>`
				: `<span class="dues-age ${overdue > 90 ? "is-bad" : overdue > 30 ? "is-warn" : ""}">${
						overdue === 0 ? __("due today") : __("{0}d late", [overdue])
				  }</span>`;

		const pill =
			r.state && r.state !== "Open"
				? `<span class="dues-pill s-${r.state.toLowerCase()}">${__(r.state)}${
						r.promised_date ? " · " + frappe.datetime.str_to_user(r.promised_date) : ""
				  }${r.snooze_until ? " · " + frappe.datetime.str_to_user(r.snooze_until) : ""}</span>`
				: `<span class="dues-pill s-open">${__("Untouched")}</span>`;

		const collecting = r.direction === "Receivable";
		const pay_label = collecting ? __("Collect") : __("Pay");
		const pay_icon = collecting ? "arrow-down" : "arrow-up";
		const can_pay = state.data.can_make_payment_entry && r.direction !== "Instrument";

		return (
			`<div class="dues-row" data-voucher="${e(r.voucher)}" data-doctype="${e(r.voucher_doctype)}">` +
			`<div class="dues-cell dues-party">` +
			`<span class="dues-party-name">${e(r.party || r.voucher)}</span>` +
			`<span class="dues-meta"><a href="/app/${frappe.router.slug(r.voucher_doctype)}/${encodeURIComponent(
				r.voucher
			)}">${e(r.voucher)}</a>${r.branch ? ` <span class="dues-tag">${e(r.branch)}</span>` : ""}${
				r.owner_user ? " · " + e(r.owner_user.split("@")[0]) : ""
			}${
				r.last_contacted
					? " · " + __("touched {0}", [frappe.datetime.comment_when(r.last_contacted)])
					: ""
			}</span></div>` +
			`<div class="dues-cell dues-when"><span class="dues-date">${
				r.due_date ? frappe.datetime.str_to_user(r.due_date) : "—"
			}</span>${age}</div>` +
			`<div class="dues-cell dues-amt">${format_currency(r.amount, r.currency, 2)}</div>` +
			`<div class="dues-cell dues-state">${pill}${
				r.note
					? `<span class="dues-note" title="${e(r.note)}">${frappe.utils.icon("small-message", "xs")}</span>`
					: ""
			}</div>` +
			`<div class="dues-cell dues-actions">` +
			`<button class="dues-btn dues-followup" title="${__("Log a call, promise or snooze")}">` +
			`${frappe.utils.icon("edit", "xs")}<span>${__("Follow up")}</span></button>` +
			(can_pay
				? `<button class="dues-btn is-primary dues-pay" title="${__("Open a Payment Entry for this voucher")}">` +
				  `${frappe.utils.icon(pay_icon, "xs")}<span>${pay_label}</span></button>`
				: "") +
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
			`<p>${
				nothing_configured
					? __("No dues sources are configured yet.")
					: __("Nothing matches these filters.")
			}</p>` +
			(nothing_configured
				? `<button class="dues-btn is-primary dues-configure">${__("Add a source")}</button>`
				: `<button class="dues-btn dues-clear">${__("Clear filters")}</button>`) +
			`</div>`
		);
	}

	// ── interaction ───────────────────────────────────────────────────────────

	function bind() {
		$body.find(".dues-chip").on("click", function () {
			const kind = $(this).attr("data-kind");
			const value = String($(this).attr("data-value") || "");
			state[kind] = value || null;
			render();
		});

		$body.find(".dues-search").on("input", frappe.utils.debounce(function () {
			state.search = $(this).val();
			const pos = this.selectionStart;
			render();
			const $new = $body.find(".dues-search").focus();
			if ($new[0] && pos !== null) $new[0].setSelectionRange(pos, pos);
		}, 200));

		$body.find(".dues-group-hdr").on("click", function () {
			const src = $(this).attr("data-source");
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
		// .attr(), never .data(): jQuery coerces a data attribute that looks like a number, so a
		// voucher named "2002000003" came back as the NUMBER 2002000003 and never matched the
		// string on the row object. 119 of 979 rows on this site have purely numeric names, and
		// their Follow up / Pay buttons silently did nothing.
		const $row = $(el).closest(".dues-row");
		const voucher = $row.attr("data-voucher");
		const doctype = $row.attr("data-doctype");
		const row = (state.data.rows || []).find(
			(r) => String(r.voucher) === String(voucher) && r.voucher_doctype === doctype
		);
		if (!row) {
			// never fail silently again
			frappe.show_alert(
				{ message: __("Could not find {0} in the loaded rows — refresh and try again.", [voucher]),
				  indicator: "red" },
				6
			);
		}
		return row;
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
						`<span>${format_currency(row.amount, row.currency, 2)} · ${
							row.days_overdue >= 0
								? __("{0} days late", [row.days_overdue])
								: __("not yet due")
						}${
							row.last_contacted
								? " · " + __("last touched {0}", [frappe.datetime.comment_when(row.last_contacted)])
								: ""
						}</span></div>`,
				},
				{
					fieldname: "state",
					label: __("State"),
					fieldtype: "Select",
					reqd: 1,
					default: row.state || "Open",
					options: ["Open", "Contacted", "Promised", "Snoozed", "Disputed", "Escalated",
						"Settled"].join("\n"),
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
				{ fieldname: "note", label: __("Note"), fieldtype: "Small Text",
				  default: row.note || "" },
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
		for (let i = 0; i < 6; i++) bars += `<div class="dues-skel-row"></div>`;
		return `<div class="dues-skel">${bars}</div>`;
	}
};

function dues_styles() {
	if (document.getElementById("dues-inbox-styles")) return;
	const css = `
.dues-inbox { padding: 2px 0 40px; }
.dues-shell { display: flex; flex-direction: column; gap: 14px; }

.dues-notice { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 8px 12px;
  border-radius: 8px; background: var(--control-bg); color: var(--text-color);
  border-left: 3px solid #BA7517; }

.dues-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; }
.dues-kpi { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px;
  padding: 13px 15px; position: relative; overflow: hidden;
  transition: transform .12s ease, box-shadow .12s ease; }
.dues-kpi:hover { transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.dues-kpi::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; }
.dues-kpi.k-recv::before { background: #1D9E75; }
.dues-kpi.k-pay::before { background: #D85A30; }
.dues-kpi.k-inst::before { background: #7F77DD; }
.dues-kpi.k-today::before { background: #378ADD; }
.dues-kpi.k-old::before { background: #EF9F27; }
.dues-kpi-top { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700;
  letter-spacing: .6px; text-transform: uppercase; color: var(--text-muted); }
.dues-kpi-val { font-size: 21px; font-weight: 700; letter-spacing: -.4px; margin-top: 6px;
  color: var(--heading-color); line-height: 1.15; word-break: break-word; }
.dues-kpi-sub { font-size: 11px; color: var(--text-muted); margin-top: 3px; }
.dues-cur-sep { padding: 0 5px; color: var(--text-muted); font-weight: 400; }

.dues-bars { background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 10px 12px; }
.dues-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dues-bar-sub { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border-color); }
.dues-bar-div { width: 1px; height: 18px; background: var(--border-color); margin: 0 6px; }
.dues-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
  padding: 5px 11px; border-radius: 18px; border: 1px solid var(--border-color);
  background: var(--control-bg); color: var(--text-color); cursor: pointer; user-select: none;
  transition: background .12s, border-color .12s, color .12s; }
.dues-chip:hover { border-color: var(--primary); color: var(--primary); }
.dues-chip b { font-weight: 700; background: var(--bg-color); border-radius: 9px; padding: 0 6px;
  font-size: 10px; }
.dues-chip i { font-style: normal; color: var(--text-muted); font-weight: 400; font-size: 10px; }
.dues-chip.is-active { background: var(--primary); border-color: var(--primary); color: #fff; }
.dues-chip.is-active b, .dues-chip.is-active i { background: rgba(255,255,255,.2); color: #fff; }
.dues-search { margin-left: auto; font-size: 11px; padding: 5px 12px; border-radius: 18px;
  border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color);
  min-width: 200px; }
.dues-search:focus { outline: none; border-color: var(--primary); }

.dues-group { background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: 12px; overflow: hidden; }
.dues-group-hdr { display: flex; align-items: center; gap: 9px; padding: 10px 14px;
  background: var(--control-bg); cursor: pointer; border-left: 4px solid var(--border-color); }
.dues-group-hdr:hover { background: var(--bg-color); }
.dues-group.accent-amber .dues-group-hdr { border-left-color: #BA7517; }
.dues-group.accent-red .dues-group-hdr { border-left-color: #A32D2D; }
.dues-group.accent-blue .dues-group-hdr { border-left-color: #378ADD; }
.dues-group.accent-teal .dues-group-hdr { border-left-color: #1D9E75; }
.dues-group.accent-purple .dues-group-hdr { border-left-color: #7F77DD; }
.dues-caret { font-size: 10px; color: var(--text-muted); width: 10px; }
.dues-group-title { font-size: 13px; font-weight: 700; color: var(--heading-color); }
.dues-dir { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px;
  padding: 2px 7px; border-radius: 9px; background: var(--bg-color); color: var(--text-muted); }
.dues-dir.dir-receivable { color: #0F6E56; }
.dues-dir.dir-payable { color: #993C1D; }
.dues-dir.dir-instrument { color: #534AB7; }
.dues-group-total { margin-left: auto; font-size: 13px; font-weight: 700; text-align: right;
  font-variant-numeric: tabular-nums; }
.dues-group-total em { display: block; font-style: normal; font-size: 10px; font-weight: 400;
  color: var(--text-muted); }

.dues-row { display: grid; grid-template-columns: minmax(0,2.4fr) 1fr 1.1fr 1.1fr auto;
  align-items: center; gap: 12px; padding: 9px 14px; border-top: 1px solid var(--border-color); }
.dues-row:hover { background: var(--control-bg); }
.dues-cell { min-width: 0; font-size: 12px; }
.dues-party-name { display: block; font-weight: 600; color: var(--heading-color);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dues-meta { display: block; font-size: 10px; color: var(--text-muted); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.dues-tag { background: var(--bg-color); border-radius: 6px; padding: 0 5px; margin-left: 2px; }
.dues-date { display: block; }
.dues-age { font-size: 10px; font-weight: 700; }
.dues-age.is-warn { color: #BA7517; }
.dues-age.is-bad { color: #A32D2D; }
.dues-age.is-future { color: var(--text-muted); font-weight: 400; }
.dues-amt { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--heading-color); }
.dues-state { display: flex; align-items: center; gap: 5px; }
.dues-pill { font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 10px;
  background: var(--bg-color); color: var(--text-muted); white-space: nowrap; }
.dues-pill.s-promised { background: #E6F1FB; color: #185FA5; }
.dues-pill.s-contacted { background: #FAEEDA; color: #854F0B; }
.dues-pill.s-snoozed { background: var(--control-bg); color: var(--text-muted); }
.dues-pill.s-disputed, .dues-pill.s-escalated { background: #FCEBEB; color: #A32D2D; }
.dues-pill.s-settled { background: #EAF3DE; color: #3B6D11; }
.dues-note { color: var(--text-muted); cursor: help; }

.dues-actions { display: flex; gap: 6px; }
.dues-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
  padding: 5px 11px; border-radius: 8px; border: 1px solid var(--border-color);
  background: var(--card-bg); color: var(--text-color); cursor: pointer; white-space: nowrap;
  transition: background .12s, border-color .12s, color .12s, transform .1s; }
.dues-btn:hover { background: var(--control-bg); border-color: var(--primary); color: var(--primary); }
.dues-btn:active { transform: scale(.97); }
.dues-btn.is-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.dues-btn.is-primary:hover { filter: brightness(1.08); color: #fff; }

.dues-empty { text-align: center; padding: 52px 20px; color: var(--text-muted);
  background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; }
.dues-empty-icon { margin-bottom: 10px; }
.dues-empty p { font-size: 13px; margin-bottom: 12px; }
.dues-dialog-head { display: flex; flex-direction: column; gap: 3px; padding-bottom: 9px;
  margin-bottom: 5px; border-bottom: 1px solid var(--border-color); }
.dues-dialog-head span { font-size: 11px; color: var(--text-muted); }
.dues-skel-row { height: 46px; border-radius: 10px; background: var(--control-bg);
  margin-bottom: 9px; animation: dues-pulse 1.4s ease-in-out infinite; }
@keyframes dues-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }

@media (prefers-color-scheme: dark) {
  .dues-pill.s-promised { background: rgba(55,138,221,.18); color: #85B7EB; }
  .dues-pill.s-contacted { background: rgba(186,117,23,.18); color: #EF9F27; }
  .dues-pill.s-disputed, .dues-pill.s-escalated { background: rgba(226,75,74,.18); color: #F09595; }
  .dues-pill.s-settled { background: rgba(99,153,34,.18); color: #97C459; }
  .dues-dir.dir-receivable { color: #5DCAA5; }
  .dues-dir.dir-payable { color: #F0997B; }
  .dues-dir.dir-instrument { color: #AFA9EC; }
  .dues-age.is-warn { color: #EF9F27; }
  .dues-age.is-bad { color: #F09595; }
}
@media (max-width: 768px) {
  .dues-row { grid-template-columns: 1fr auto; row-gap: 6px; }
  .dues-when, .dues-state { grid-column: 1 / -1; }
  .dues-amt { text-align: left; }
  .dues-search { margin-left: 0; width: 100%; }
}`;
	$('<style id="dues-inbox-styles">').text(css).appendTo(document.head);
}
