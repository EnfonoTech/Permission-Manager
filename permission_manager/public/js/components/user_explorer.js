// Permission Manager — User Explorer Component (Restrictions & Shares)
// Author: siva <siva@enfono.com>
// Shows User Permission restrictions and DocShare records with add/remove capability.

import { esc } from "../utils/helpers";

export class UserExplorer {
	constructor(opts) {
		this.user = opts.user;
		this.load();
	}

	load() {
		Promise.all([
			new Promise((resolve) => {
				frappe.call({
					method: "permission_manager.permission_manager.api.restrictions.get_user_restrictions",
					args: { user: this.user },
					callback: (r) => resolve(r.message),
				});
			}),
			new Promise((resolve) => {
				frappe.call({
					method: "permission_manager.permission_manager.api.restrictions.get_user_shares",
					args: { user: this.user },
					callback: (r) => resolve(r.message),
				});
			}),
		])
			.then(([restrictions, shares]) => this.render(restrictions, shares))
			.catch(() => {
				frappe.msgprint({
					title: __("Error"),
					indicator: "red",
					message: __("Failed to load restrictions and shares. Please try again."),
				});
			});
	}

	render(restrictions_data, shares_data) {
		this.dialog = new frappe.ui.Dialog({
			title: __("Restrictions & Shares: {0}", [this.user]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "content_html" }],
		});

		this._restrictions_data = restrictions_data;
		this._shares_data = shares_data;
		this._render_content();
		this.dialog.show();
	}

	_render_content() {
		const $container = this.dialog.fields_dict.content_html.$wrapper;
		const r = this._restrictions_data;
		const s = this._shares_data;

		let html = `<div class="ps-explorer">`;

		// ── Section: User Permission Restrictions ─────────────────────────────
		html += `
			<div class="ps-section-header">
				<h4 class="ps-section-title" style="margin:0">${__("User Permission Restrictions")}</h4>
				<button class="btn btn-xs btn-primary ps-add-restriction-btn">
					${frappe.utils.icon("add", "xs")} ${__("Add Restriction")}
				</button>
			</div>`;

		if (!r.restrictions.length) {
			html += `<div class="ps-empty-state">${__("No restrictions — full role-based access.")}</div>`;
		} else {
			// Summary badges
			html += `<div class="ps-restriction-summary">`;
			for (const [dt, values] of Object.entries(r.restriction_summary)) {
				html += `<div class="ps-restriction-badge">
					<strong>${esc(dt)}:</strong>
					${values.map((v) => `<span class="ps-badge">${esc(v)}</span>`).join(" ")}
				</div>`;
			}
			html += `</div>`;

			// Cards with Remove button
			html += `<div class="ps-restriction-cards">`;
			r.restrictions.forEach((item) => {
				html += `
					<div class="ps-card" data-perm-name="${esc(item.name)}">
						<div class="ps-card-header">
							<strong>${esc(item.allow)}</strong> =
							<span class="ps-badge">${esc(item.for_value)}</span>
							${item.is_default ? `<span class="ps-badge ps-badge-default">${__("Default")}</span>` : ""}
							<button class="btn btn-xs btn-danger ps-remove-restriction-btn"
								data-name="${esc(item.name)}"
								style="margin-left:auto"
								title="${__("Remove this restriction")}">
								${frappe.utils.icon("delete", "xs")} ${__("Remove")}
							</button>
						</div>
						<div class="ps-card-body">
							<div class="ps-card-detail">
								<strong>${__("Applied to")}:</strong>
								${item.apply_to_all
									? __("All DocTypes with link to {0}", [item.allow])
									: esc(item.applicable_for || __("All"))}
							</div>
							<div class="ps-card-detail">
								<strong>${__("Affected DocTypes")} (${item.affected_doctypes.length}):</strong>
								<div class="ps-affected-list">
									${item.affected_doctypes
										.slice(0, 15)
										.map((dt) => `<span class="ps-mini-badge">${esc(dt)}</span>`)
										.join(" ")}
									${item.affected_doctypes.length > 15
										? `<span class="ps-mini-badge">+${item.affected_doctypes.length - 15} ${__("more")}</span>`
										: ""}
								</div>
							</div>
						</div>
					</div>`;
			});
			html += `</div>`;
		}

		// ── Section: Shared Documents ─────────────────────────────────────────
		html += `<h4 class="ps-section-title">${__("Shared Documents")}</h4>`;

		if (!s.shares.length) {
			html += `<div class="ps-empty-state">${__("No documents shared with this user.")}</div>`;
		} else {
			html += `<table class="ps-shares-table">
				<thead><tr>
					<th>${__("DocType")}</th><th>${__("Document")}</th>
					<th>${__("Read")}</th><th>${__("Write")}</th>
					<th>${__("Share")}</th><th>${__("Shared By")}</th>
				</tr></thead><tbody>`;

			s.shares.forEach((item) => {
				html += `<tr>
					<td>${esc(item.doctype)}</td>
					<td><a href="/app/${frappe.router.slug(item.doctype)}/${item.docname}">${esc(item.docname)}</a></td>
					<td>${item.read ? "✓" : "✗"}</td>
					<td>${item.write ? "✓" : "✗"}</td>
					<td>${item.share ? "✓" : "✗"}</td>
					<td>${esc(item.owner)}</td>
				</tr>`;
			});

			html += `</tbody></table>`;
		}

		html += `</div>`;
		$container.html(html);

		// ── Bind event handlers ───────────────────────────────────────────────
		$container.find(".ps-add-restriction-btn").on("click", () => this._show_add_dialog());

		$container.find(".ps-remove-restriction-btn").on("click", (e) => {
			const name = $(e.currentTarget).data("name");
			this._remove_restriction(name, $container);
		});
	}

	_show_add_dialog() {
		const dlg = new frappe.ui.Dialog({
			title: __("Add User Permission Restriction — {0}", [this.user]),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "allow",
					label: __("Restrict By (DocType)"),
					options: "DocType",
					reqd: 1,
					description: __("e.g. Company, Cost Center, Warehouse"),
				},
				{
					fieldtype: "Dynamic Link",
					fieldname: "for_value",
					label: __("Allowed Value"),
					options: "allow",
					reqd: 1,
					description: __("Pick the specific record this user is restricted to."),
				},
				{
					fieldtype: "Check",
					fieldname: "apply_to_all_doctypes",
					label: __("Apply to All DocTypes"),
					default: 1,
					description: __("If unchecked, you can specify a single DocType below."),
				},
				{
					fieldtype: "Link",
					fieldname: "applicable_for",
					label: __("Applicable For (DocType)"),
					options: "DocType",
					depends_on: "eval: !doc.apply_to_all_doctypes",
				},
				{
					fieldtype: "HTML",
					fieldname: "impact_preview",
					label: __("Impact Preview"),
				},
			],
			primary_action_label: __("Add"),
			primary_action: (vals) => {
				dlg.hide();
				frappe.call({
					method: "permission_manager.permission_manager.api.restrictions.add_user_permission",
					args: {
						user: this.user,
						allow: vals.allow,
						for_value: vals.for_value,
						applicable_for: vals.applicable_for || "",
						apply_to_all_doctypes: vals.apply_to_all_doctypes ? 1 : 0,
					},
					callback: (r) => {
						if (r.message) {
							this._restrictions_data = r.message;
							this._render_content();
							frappe.show_alert({ message: __("Restriction added."), indicator: "green" });
						}
					},
				});
			},
		});

		// Live impact preview — debounced on allow + for_value change
		let _preview_timer = null;
		const _run_preview = () => {
			const allow = dlg.get_value("allow");
			const for_value = dlg.get_value("for_value");
			const $preview = dlg.fields_dict.impact_preview.$wrapper;

			if (!allow || !for_value) {
				$preview.empty();
				return;
			}

			$preview.html(`<div class="ps-impact-loading">${frappe.utils.icon("refresh", "xs")} ${__("Previewing impact…")}</div>`);

			frappe.call({
				method: "permission_manager.permission_manager.api.restrictions.preview_restriction_impact",
				args: { allow, for_value },
				callback: (r) => {
					if (!r.message) return;
					const d = r.message;
					if (!d.impact.length) {
						$preview.html(`<div class="ps-impact-empty">${__("No DocTypes link to {0}.", [allow])}</div>`);
						return;
					}
					let html = `<div class="ps-impact-header">
						<strong>${__("Impact Preview")}</strong> — ${d.affected_doctypes_count} ${__("DocTypes affected")}
					</div>
					<table class="ps-impact-table">
						<thead><tr>
							<th>${__("DocType")}</th>
							<th>${__("Total Records")}</th>
							<th>${__("Will See")}</th>
							<th>${__("Restricted Out")}</th>
						</tr></thead><tbody>`;

					d.impact.forEach((row) => {
						const pct = row.total_records ? Math.round((row.accessible_after / row.total_records) * 100) : 0;
						const warn = pct < 20 && row.total_records > 0;
						html += `<tr class="${warn ? "ps-impact-warn-row" : ""}">
							<td>${esc(row.doctype)}</td>
							<td>${row.total_records}</td>
							<td><strong style="color:var(--ps-green)">${row.accessible_after}</strong> (${pct}%)</td>
							<td style="color:var(--ps-red)">${row.restricted_out}</td>
						</tr>`;
					});

					html += `</tbody></table>`;
					$preview.html(html);
				},
			});
		};

		const _debounced_preview = () => {
			clearTimeout(_preview_timer);
			_preview_timer = setTimeout(_run_preview, 600);
		};

		dlg.fields_dict.allow.df.change = () => {
			// Clear for_value when the DocType changes so stale values don't carry over
			dlg.set_value("for_value", "");
			_debounced_preview();
		};
		dlg.fields_dict.for_value.df.change = _debounced_preview;

		dlg.show();
	}

	_remove_restriction(name, $container) {
		frappe.confirm(__("Remove this restriction?"), () => {
			frappe.call({
				method: "permission_manager.permission_manager.api.restrictions.remove_user_permission",
				args: { name },
				callback: (r) => {
					if (r.message) {
						this._restrictions_data = r.message;
						this._render_content();
						frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
					}
				},
			});
		});
	}
}
