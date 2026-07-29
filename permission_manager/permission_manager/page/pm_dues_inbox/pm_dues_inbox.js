// permission_manager/permission_manager/page/pm_dues_inbox/pm_dues_inbox.js
// Dues Inbox — everything falling due in one list, built from PM Dues Source rows.
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

	// The decimals belong to the currency, never to this page. BHD carries three; the KPI cards were
	// hardcoded to none and the group totals to two, so 43,981.36 printed as 43,981 in one place and
	// 48,431.36 in another. Leaving the precision out lets format_currency read it from the currency
	// (System Settings currency_precision 3, number format #,###.### for BHD).
	function money(amounts, precision) {
		const keys = Object.keys(amounts || {}).filter((c) => amounts[c]);
		if (!keys.length) return format_currency(0, state.data.company_currency);
		return keys
			.sort()
			.map((c) => format_currency(amounts[c], c, precision))
			.join(`<span class="dues-cur-sep">+</span>`);
	}

	// ── filtering ─────────────────────────────────────────────────────────────

	function visible_rows() {
		const d = state.data;
		if (!d) return [];
		let rows = d.rows || [];
		// the stream chip. This filter was lost when the snooze line directly above it was stripped
		// out with the follow-up feature, which left every chip highlighting but filtering nothing.
		if (state.source) rows = rows.filter((r) => r.source === state.source);
		if (state.bucket) rows = rows.filter((r) => r.bucket === state.bucket);
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
		const live = d.rows || [];
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

		return (
			`<div class="dues-bars">` +
			`<div class="dues-bar">${src_chips}</div>` +
			`<div class="dues-bar dues-bar-sub">${bucket_chips}` +
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
				`<span class="dues-group-total">${money(totals)}` +
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

		// The slot that used to carry follow-up state now says whether an advice already exists.
		// Knowing that at a glance is the point: it stops a second advice being raised for a voucher
		// somebody is already dealing with.
		const advices = r.advices || [];
		const pill = advices.length
			? advices
					.map(
						(a) =>
							`<a class="dues-pill s-advice" href="/app/payment-advice/${encodeURIComponent(
								a.advice
							)}" title="${__("Payment Advice already raised — {0}", [a.status])}">` +
							`${frappe.utils.icon("small-file", "xs")} ${e(a.advice)} · ${e(a.status)}</a>`
					)
					.join(" ")
			: `<span class="dues-pill s-open">${__("No advice")}</span>`;

		// Collect / Pay opened a Payment Entry straight off a due row, which skips the advice and its
		// approval. Raising the Payment Advice is the action instead, and it is offered only where
		// there is not already one against the voucher.
		const advice_doctypes = ["Sales Invoice", "Purchase Invoice", "Purchase Order", "Sales Order"];
		const can_advise =
			state.data.can_make_payment_advice &&
			advice_doctypes.includes(r.voucher_doctype) &&
			!advices.length;

		return (
			`<div class="dues-row" data-voucher="${e(r.voucher)}" data-doctype="${e(r.voucher_doctype)}">` +
			`<div class="dues-cell dues-party">` +
			`<span class="dues-party-name">${e(r.party || r.voucher)}</span>` +
			`<span class="dues-meta"><a href="/app/${frappe.router.slug(r.voucher_doctype)}/${encodeURIComponent(
				r.voucher
			)}">${e(r.voucher)}</a>${r.branch ? ` <span class="dues-tag">${e(r.branch)}</span>` : ""}</span></div>` +
			`<div class="dues-cell dues-when"><span class="dues-date">${
				r.due_date ? frappe.datetime.str_to_user(r.due_date) : "—"
			}</span>${age}</div>` +
			`<div class="dues-cell dues-amt">${format_currency(r.amount, r.currency)}</div>` +
			`<div class="dues-cell dues-state">${pill}</div>` +
			`<div class="dues-cell dues-actions">` +
			(can_advise
				? `<button class="dues-btn is-primary dues-advice" title="${__(
						"Raise a draft Payment Advice for this voucher"
				  )}">` +
				  `${frappe.utils.icon("small-file", "xs")}<span>${__("Payment Advice")}</span></button>`
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
			state.source = state.bucket = null;
			state.search = "";
			render();
		});
		$body.find(".dues-configure").on("click", () => frappe.set_route("List", "PM Dues Source"));

		$body.find(".dues-advice").on("click", function (ev) {
			ev.stopPropagation();
			make_advice(row_of(this));
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

	function make_advice(row) {
		if (!row) return;
		frappe.confirm(
			__("Raise a draft Payment Advice for {0} — {1}?", [
				frappe.utils.escape_html(row.party || row.voucher),
				format_currency(row.amount, row.currency),
			]),
			() => {
				frappe.call({
					method: "permission_manager.permission_manager.api.dues_inbox.make_payment_advice",
					args: { voucher_doctype: row.voucher_doctype, voucher: row.voucher },
					freeze: true,
					freeze_message: __("Raising Payment Advice…"),
					callback(r) {
						const res = r.message;
						if (!res || !res.advice) return;
						frappe.show_alert(
							{ message: __("Payment Advice {0} created", [res.advice]), indicator: "green" },
							5
						);
						// the row's outstanding has not changed, but the advice now exists and a second
						// attempt would be refused, so reload to keep the page honest
						load();
						frappe.set_route("Form", "Payment Advice", res.advice);
					},
				});
			}
		);
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
.dues-note { color: var(--text-muted); cursor: help; }

.dues-actions { display: flex; gap: 6px; }
.dues-pill.s-advice { text-decoration: none; display: inline-flex; align-items: center; gap: 4px;
    background: rgba(29,158,117,.12); color: #0F6B4F; border: 1px solid rgba(29,158,117,.35); }
.dues-pill.s-advice:hover { background: rgba(29,158,117,.2); }
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
