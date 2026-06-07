// Permission Manager — Role Profile Explorer Component
// Author: siva <siva@enfono.com>
// Displays the combined permission matrix for all roles inside a Role Profile.

import { MATRIX_RIGHTS, RIGHT_LABELS, RIGHT_FULL_LABELS, esc } from "../utils/helpers";

export class RoleProfileExplorer {
	constructor(opts) {
		this.wrapper   = opts.wrapper;
		this.data      = opts.data;      // from get_role_profile_matrix
		this.on_export = opts.on_export;
		this.render();
	}

	render() {
		this.wrapper.empty();
		const d = this.data;

		// ── Header ──────────────────────────────────────────────────────────────
		const role_chips = d.roles
			.map((r) => `<span class="ps-badge">${esc(r)}</span>`)
			.join(" ");

		const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-role-info">
					<h3>${esc(d.profile)}</h3>
					<div class="ps-roles-list ps-profile-roles">${role_chips || `<em>${__("No roles in this profile.")}</em>`}</div>
					<div class="ps-stats">
						${__("{0} roles", [d.roles.length])}
						&nbsp;|&nbsp;
						${__("{0} DocTypes", [d.total_doctypes])}
						&nbsp;|&nbsp;
						${__("{0} users assigned", [d.user_count])}
					</div>
				</div>
				<div class="ps-header-actions">
					<a class="btn btn-xs btn-default ps-open-profile-btn"
						href="/app/role-profile/${encodeURIComponent(d.profile)}" target="_blank">
						${frappe.utils.icon("edit", "xs")} ${__("Edit Profile")}
					</a>
					<button class="btn btn-xs btn-default ps-export-profile-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>
		`);

		$header.find(".ps-export-profile-btn").on("click", () => {
			if (this.on_export) this.on_export(d.profile);
		});

		this.wrapper.append($header);

		if (!d.modules || !d.modules.length) {
			this.wrapper.append(
				$(`<div class="ps-empty-state">${__("This profile has no permissions (no roles or roles have no permissions).")}</div>`)
			);
			return;
		}

		this.wrapper.append($(`
			<div class="ps-table-hint">
				${frappe.utils.icon("info", "xs")}
				${__("Showing the combined (unioned) permissions for all roles in this profile. ✓ means at least one role grants this right.")}
			</div>
		`));

		// ── Module groups ────────────────────────────────────────────────────────
		d.modules.forEach((mod) => {
			const $group = $(`
				<div class="ps-module-group">
					<div class="ps-module-header">
						<strong>${esc(mod.module)}</strong>
						<span class="ps-module-count">(${mod.doctypes.length})</span>
					</div>
				</div>
			`);

			let html = `<table class="ps-matrix-table ps-matrix-compact">
				<thead><tr><th class="ps-col-doctype">${__("DocType")}</th>`;

			MATRIX_RIGHTS.forEach((r) => {
				html += `<th class="ps-col-perm" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
			});
			html += `</tr></thead><tbody>`;

			mod.doctypes.forEach((row) => {
				html += `<tr class="ps-matrix-row" data-doctype="${esc(row.doctype)}">`;
				html += `<td class="ps-col-doctype">
					<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
					${row.source === "custom" ? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>' : ""}
				</td>`;

				MATRIX_RIGHTS.forEach((r) => {
					const val = row.permissions[r];
					if (val === "na") {
						html += `<td class="ps-cell ps-cell-na">—</td>`;
					} else {
						html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "✓" : "✗"}</td>`;
					}
				});

				html += `</tr>`;
			});

			html += `</tbody></table>`;
			$group.append($(html));
			this.wrapper.append($group);
		});
	}
}
