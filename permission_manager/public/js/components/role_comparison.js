// Permission Manager — Role Comparison Component
// Author: siva <siva@enfono.com>

import { MATRIX_RIGHTS, RIGHT_LABELS, RIGHT_FULL_LABELS, esc } from "../utils/helpers";
import { _download_csv } from "./reverse_lookup";

const DIFF_STYLES = {
	both:    { cls: "ps-diff-both",    icon: "✓", title: "Both roles" },
	only_1:  { cls: "ps-diff-only1",   icon: "①", title: "Role 1 only" },
	only_2:  { cls: "ps-diff-only2",   icon: "②", title: "Role 2 only" },
	neither: { cls: "ps-diff-neither", icon: "✗", title: "Neither role" },
	na:      { cls: "ps-cell-na",      icon: "—", title: "Not applicable" },
};

export class RoleComparison {
	constructor(opts) {
		this.wrapper = opts.wrapper;
		this._role1 = null;
		this._role2 = null;
		this._show_diff_only = false;
		this._data = null;
		this.render();
	}

	render() {
		this.wrapper.empty();

		// ── Controls ──────────────────────────────────────────────────────────
		const $ctrl = $(`
			<div class="ps-compare-controls">
				<div class="ps-search-row ps-compare-row">
					<div class="ps-search-field" id="ps-role1-select"></div>
					<div class="ps-compare-vs">${__("vs")}</div>
					<div class="ps-search-field" id="ps-role2-select"></div>
					<button class="btn btn-sm btn-primary ps-compare-btn" disabled>
						${frappe.utils.icon("compare", "sm")} ${__("Compare")}
					</button>
				</div>
			</div>
		`);

		this.wrapper.append($ctrl);

		const make_role_ctrl = (id, field_name, cb) => {
			return frappe.ui.form.make_control({
				df: {
					fieldtype: "Link", options: "Role", fieldname: field_name,
					placeholder: __("Select Role…"), label: __("Role"),
					change: () => { cb(this[field_name]?.get_value()); this._update_compare_btn(); },
				},
				parent: $ctrl.find(`#${id}`),
				render_input: true,
			});
		};

		this._r1_ctrl = make_role_ctrl("ps-role1-select", "_r1_ctrl", (v) => { this._role1 = v; });
		this._r2_ctrl = make_role_ctrl("ps-role2-select", "_r2_ctrl", (v) => { this._role2 = v; });

		// Re-bind after creation (closures don't work perfectly above — bind directly)
		this._r1_ctrl.df.change = () => { this._role1 = this._r1_ctrl.get_value(); this._update_compare_btn(); };
		this._r2_ctrl.df.change = () => { this._role2 = this._r2_ctrl.get_value(); this._update_compare_btn(); };

		$ctrl.find(".ps-compare-btn").on("click", () => this._run_compare());

		this.$results = $(`<div class="ps-compare-results"></div>`);
		this.wrapper.append(this.$results);

		this.$results.html(this._welcome_html());
	}

	_update_compare_btn() {
		this.wrapper.find(".ps-compare-btn").prop("disabled", !(this._role1 && this._role2));
	}

	_run_compare() {
		if (!this._role1 || !this._role2) return;
		if (this._role1 === this._role2) {
			frappe.show_alert({ message: __("Please select two different roles."), indicator: "orange" });
			return;
		}

		this.$results.html(`<div class="ps-loading">${this._skeleton(6)}</div>`);

		frappe.call({
			method: "permission_manager.permission_manager.api.lookup.compare_roles",
			args: { role1: this._role1, role2: this._role2 },
			callback: (r) => {
				if (r.message) {
					this._data = r.message;
					this._render_comparison(r.message);
				}
			},
			error: () => {
				this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Comparison failed.")}</div>
				</div>`);
			},
		});
	}

	_render_comparison(data) {
		let html = `
			<div class="ps-compare-header">
				<div class="ps-compare-stats">
					<span class="ps-stat-badge ps-stat-total">${data.total} ${__("DocTypes")}</span>
					<span class="ps-stat-badge ps-stat-diff">${data.diff_count} ${__("differ")}</span>
					<span class="ps-stat-badge ps-stat-only1">${data.only_in_role1} ${__("only in")} ${esc(data.role1)}</span>
					<span class="ps-stat-badge ps-stat-only2">${data.only_in_role2} ${__("only in")} ${esc(data.role2)}</span>
				</div>
				<div class="ps-compare-actions">
					<label class="ps-diff-toggle-label">
						<input type="checkbox" class="ps-diff-only-cb" ${this._show_diff_only ? "checked" : ""}>
						${__("Show differences only")}
					</label>
					<button class="btn btn-xs btn-default ps-compare-export-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>

			<!-- Legend -->
			<div class="ps-compare-legend">
				<span class="ps-diff-both">✓ ${__("Both")}</span>
				<span class="ps-diff-only1">① ${esc(data.role1)} only</span>
				<span class="ps-diff-only2">② ${esc(data.role2)} only</span>
				<span class="ps-diff-neither">✗ ${__("Neither")}</span>
			</div>

			<div class="ps-matrix-scroll">
				<table class="ps-matrix-table ps-compare-table">
					<thead>
						<tr>
							<th class="ps-col-module">${__("MODULE")}</th>
							<th class="ps-col-doctype">${__("DOCTYPE")}</th>`;

		// Two header rows for the two roles
		MATRIX_RIGHTS.forEach((r) => {
			html += `<th class="ps-col-perm ps-compare-th" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
		});

		html += `</tr>
					<tr class="ps-compare-role-names">
						<th colspan="2"></th>`;

		// Show role names spanning the columns (visual only)
		const half = Math.ceil(MATRIX_RIGHTS.length / 2);
		html += `<th colspan="${MATRIX_RIGHTS.length}" class="ps-compare-role-span">
			<span class="ps-compare-role1-label">① ${esc(data.role1)}</span>
			&nbsp;/&nbsp;
			<span class="ps-compare-role2-label">② ${esc(data.role2)}</span>
		</th>`;

		html += `</tr></thead><tbody>`;

		let last_module = "";
		let displayed = 0;

		data.rows.forEach((row) => {
			if (this._show_diff_only && !row.has_diff) return;
			displayed++;

			const show_module = row.module !== last_module;
			last_module = row.module;

			const row_cls = row.has_diff ? "ps-row-has-diff" : "";
			html += `<tr class="ps-matrix-row ${row_cls}" data-doctype="${esc(row.doctype)}">`;
			html += `<td class="ps-col-module">${show_module ? esc(row.module) : ""}</td>`;
			html += `<td class="ps-col-doctype">
				<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
				${row.has_diff ? '<span class="ps-diff-dot"></span>' : ""}
			</td>`;

			MATRIX_RIGHTS.forEach((r) => {
				const d = DIFF_STYLES[row.diff[r]] || DIFF_STYLES.neither;
				html += `<td class="ps-cell ps-compare-cell ${d.cls}"
					title="${__("{0}: {1}", [RIGHT_FULL_LABELS[r], d.title])}">${d.icon}</td>`;
			});

			html += `</tr>`;
		});

		if (!displayed) {
			html += `<tr><td colspan="${MATRIX_RIGHTS.length + 2}" class="ps-empty-state" style="padding:24px;text-align:center">
				${__("No differences found between these roles.")}
			</td></tr>`;
		}

		html += `</tbody></table></div>`;
		this.$results.html(html);

		this.$results.find(".ps-diff-only-cb").on("change", (e) => {
			this._show_diff_only = e.target.checked;
			this._render_comparison(this._data);
		});

		this.$results.find(".ps-compare-export-btn").on("click", () => this._export_csv(data));
	}

	_export_csv(data) {
		const header = ["DocType", "Module", "Has Diff?"];
		MATRIX_RIGHTS.forEach((r) => {
			header.push(`${r} (${data.role1})`);
			header.push(`${r} (${data.role2})`);
		});

		const rows = [header];
		data.rows.forEach((row) => {
			const r = [row.doctype, row.module, row.has_diff ? "Yes" : "No"];
			MATRIX_RIGHTS.forEach((p) => {
				r.push(row.role1_perms[p] === "na" ? "na" : (row.role1_perms[p] ? "✓" : "✗"));
				r.push(row.role2_perms[p] === "na" ? "na" : (row.role2_perms[p] ? "✓" : "✗"));
			});
			rows.push(r);
		});

		_download_csv(rows, `compare_${data.role1}_vs_${data.role2}`);
	}

	_welcome_html() {
		return `<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${frappe.utils.icon("compare", "lg")}</div>
			<div class="ps-welcome-title">${__("Compare Two Roles")}</div>
			<div class="ps-welcome-desc">${__("Select two roles above to see a side-by-side permission comparison highlighting every difference.")}</div>
		</div>`;
	}

	_skeleton(n) {
		return Array(n).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("");
	}
}
