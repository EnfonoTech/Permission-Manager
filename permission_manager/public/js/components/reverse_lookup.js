// Permission Manager — Reverse Lookup Component ("Who can do X?")
// Author: siva <siva@enfono.com>

import { MATRIX_RIGHTS, RIGHT_FULL_LABELS, esc } from "../utils/helpers";

export class ReverseLookup {
	constructor(opts) {
		this.wrapper = opts.wrapper;
		this._doctype = null;
		this._ptype = "read";
		this._data = null;
		this.render();
	}

	render() {
		this.wrapper.empty();

		// ── Search controls ───────────────────────────────────────────────────
		const $search = $(`
			<div class="ps-lookup-controls">
				<div class="ps-search-row">
					<div class="ps-search-field" id="ps-lookup-dt"></div>
					<div class="ps-search-field" id="ps-lookup-ptype"></div>
					<button class="btn btn-sm btn-primary ps-lookup-search-btn" disabled>
						${frappe.utils.icon("search", "sm")} ${__("Find Users")}
					</button>
				</div>
			</div>
		`);

		this.wrapper.append($search);

		// DocType field
		this._dt_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "DocType", fieldname: "lookup_doctype",
				placeholder: __("Select DocType…"), label: __("DocType"),
				change: () => {
					this._doctype = this._dt_ctrl.get_value();
					this._update_search_btn();
				},
			},
			parent: $search.find("#ps-lookup-dt"),
			render_input: true,
		});

		// Permission type select
		this._ptype_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "lookup_ptype",
				label: __("Permission Type"),
				options: MATRIX_RIGHTS.map((r) => ({ value: r, label: RIGHT_FULL_LABELS[r] || r })),
				default: "read",
				change: () => {
					this._ptype = this._ptype_ctrl.get_value() || "read";
				},
			},
			parent: $search.find("#ps-lookup-ptype"),
			render_input: true,
		});
		this._ptype_ctrl.set_value("read");

		$search.find(".ps-lookup-search-btn").on("click", () => this._run_lookup());

		// ── Results area ──────────────────────────────────────────────────────
		this.$results = $(`<div class="ps-lookup-results"></div>`);
		this.wrapper.append(this.$results);

		this.$results.html(this._empty_state(
			frappe.utils.icon("search", "lg"),
			__("Who can do what?"),
			__("Select a DocType and permission type above, then click Find Users.")
		));
	}

	_update_search_btn() {
		const $btn = this.wrapper.find(".ps-lookup-search-btn");
		$btn.prop("disabled", !this._doctype);
	}

	_run_lookup() {
		if (!this._doctype) return;

		this.$results.html(`<div class="ps-loading">${this._skeleton(4)}</div>`);

		frappe.call({
			method: "permission_manager.permission_manager.api.lookup.get_users_with_permission",
			args: { doctype: this._doctype, ptype: this._ptype },
			callback: (r) => {
				if (r.message) {
					this._data = r.message;
					this._render_results(r.message);
				}
			},
			error: () => {
				this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to run lookup.")}</div>
				</div>`);
			},
		});
	}

	_render_results(data) {
		const ptype_label = RIGHT_FULL_LABELS[data.ptype] || data.ptype;
		const source_badge = data.source === "custom"
			? `<span class="ps-badge ps-badge-custom">${__("Custom Perms")}</span>`
			: `<span class="ps-badge">${__("Standard Perms")}</span>`;

		let html = `
			<div class="ps-lookup-summary">
				<div class="ps-lookup-title">
					<strong>${__("{0} users</strong> can <strong>{1}</strong> on <strong>{2}", [data.total_users, ptype_label, data.doctype])}</strong>
					&nbsp;${source_badge}
				</div>
				<div class="ps-lookup-roles">`;

		if (data.granting_roles.length) {
			html += `<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("Granting roles")}:</span>
				${data.granting_roles.map((r) => `<span class="ps-badge ps-badge-green">${esc(r)}</span>`).join(" ")}
			</div>`;
		}
		if (data.conditional_roles.length) {
			html += `<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("If-owner only")}:</span>
				${data.conditional_roles.map((r) => `<span class="ps-badge ps-badge-amber">${esc(r)}</span>`).join(" ")}
			</div>`;
		}
		html += `</div>`;

		// Export button
		html += `<button class="btn btn-xs btn-default ps-export-lookup-btn">
			${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
		</button>`;
		html += `</div>`;

		if (!data.users.length) {
			html += `<div class="ps-empty-state">${__("No active users have this permission.")}</div>`;
		} else {
			html += `<div class="ps-lookup-user-grid">`;

			data.users.forEach((u) => {
				const is_direct = u.access_type === "direct";
				const roles_html = [
					...u.direct_roles.map((r) => `<span class="ps-badge ps-badge-green ps-xs-badge">${esc(r)}</span>`),
					...u.cond_roles.map((r) => `<span class="ps-badge ps-badge-amber ps-xs-badge">${esc(r)}</span>`),
				].join(" ");

				html += `<div class="ps-user-card ${is_direct ? "" : "ps-user-card-cond"}">
					<div class="ps-user-card-avatar">
						${u.user_image
							? `<img src="${esc(u.user_image)}" class="ps-avatar-img">`
							: `<div class="ps-avatar-placeholder">${(u.full_name || u.user)[0].toUpperCase()}</div>`}
					</div>
					<div class="ps-user-card-info">
						<div class="ps-user-card-name">${esc(u.full_name || u.user)}</div>
						<div class="ps-user-card-email">${esc(u.email || u.user)}</div>
						<div class="ps-user-card-roles">${roles_html}</div>
					</div>
					<div class="ps-user-card-badge">
						${is_direct
							? `<span class="ps-access-direct">${__("Direct")}</span>`
							: `<span class="ps-access-cond">${__("If Owner")}</span>`}
					</div>
				</div>`;
			});

			html += `</div>`;
		}

		this.$results.html(html);

		this.$results.find(".ps-export-lookup-btn").on("click", () => this._export_csv(data));
	}

	_export_csv(data) {
		const rows = [
			["DocType", data.doctype, "Permission", RIGHT_FULL_LABELS[data.ptype] || data.ptype],
			[],
			["User", "Email", "Access Type", "Granting Roles"],
			...data.users.map((u) => [
				u.full_name || u.user,
				u.email || u.user,
				u.access_type,
				[...u.direct_roles, ...u.cond_roles].join(", "),
			]),
		];
		_download_csv(rows, `lookup_${data.doctype}_${data.ptype}`);
	}

	_skeleton(n) {
		return Array(n).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("");
	}

	_empty_state(icon, title, desc) {
		return `<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${icon}</div>
			<div class="ps-welcome-title">${title}</div>
			<div class="ps-welcome-desc">${desc}</div>
		</div>`;
	}
}


// ─── Shared CSV download helper ───────────────────────────────────────────────

export function _download_csv(rows, filename_prefix) {
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const filename = `${filename_prefix}_${ts}.csv`;

	const csv_content = rows
		.map((row) =>
			row.map((cell) => {
				const s = String(cell == null ? "" : cell);
				return s.includes(",") || s.includes('"') || s.includes("\n")
					? `"${s.replace(/"/g, '""')}"`
					: s;
			}).join(",")
		)
		.join("\n");

	const blob = new Blob([csv_content], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
