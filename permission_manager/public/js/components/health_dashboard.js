// Permission Manager — Health Dashboard + Test-as-User Component
// Author: siva <siva@enfono.com>

import { esc } from "../utils/helpers";

// ─── Health Dashboard ─────────────────────────────────────────────────────────

export class HealthDashboard {
	constructor(opts) {
		this.wrapper = opts.wrapper;
		this.load();
	}

	load() {
		this.wrapper.empty();
		this.wrapper.html(`<div class="ps-loading">${this._skeleton(4)}</div>`);

		frappe.call({
			method: "permission_manager.permission_manager.api.lookup.get_permission_health",
			callback: (r) => {
				if (r.message) this._render(r.message);
			},
			error: () => {
				this.wrapper.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to load health data.")}</div>
					<button class="btn btn-sm btn-default ps-health-retry">
						${frappe.utils.icon("refresh", "xs")} ${__("Retry")}
					</button>
				</div>`);
				this.wrapper.find(".ps-health-retry").on("click", () => this.load());
			},
		});
	}

	_render(d) {
		const score = this._compute_score(d);

		let html = `
		<div class="ps-health-wrapper">

			<!-- Score card -->
			<div class="ps-health-score-row">
				<div class="ps-health-score-card ps-score-${score.grade}">
					<div class="ps-score-circle">${score.grade}</div>
					<div class="ps-score-info">
						<div class="ps-score-label">${__("Permission Health Score")}</div>
						<div class="ps-score-sub">${score.points}/100 &nbsp;—&nbsp; ${score.label}</div>
					</div>
				</div>
				<button class="btn btn-xs btn-default ps-health-refresh-btn" style="align-self:flex-start">
					${frappe.utils.icon("refresh", "xs")} ${__("Refresh")}
				</button>
			</div>

			<!-- Stat tiles -->
			<div class="ps-health-tiles">
				${this._tile("tool", d.custom_perm_count, __("Custom Perm Rows"), d.custom_perm_count > 100 ? "warn" : "ok", __("{0} DocTypes overridden", [d.custom_perm_doctypes]))}
				${this._tile("users", d.system_manager_count, __("System Managers"), d.system_manager_count > 5 ? "warn" : "ok", __("Users with full access"))}
				${this._tile("warning", d.users_no_roles_count, __("Users with No Roles"), d.users_no_roles_count > 0 ? "alert" : "ok", __("Cannot access Frappe desk"))}
				${this._tile("delete", d.roles_no_users_count, __("Empty Roles"), d.roles_no_users_count > 0 ? "warn" : "ok", __("Roles with no users assigned"))}
				${this._tile("lock", d.orphan_role_perms.length, __("Orphan Perm Rows"), d.orphan_role_perms.length > 0 ? "alert" : "ok", __("Custom perms for deleted roles"))}
				${this._tile("shield", d.sensitive_with_custom.length, __("Sensitive Overrides"), d.sensitive_with_custom.length > 0 ? "warn" : "ok", __("Sensitive DocTypes with custom perms"))}
			</div>`;

		// System Managers list
		if (d.system_manager_users.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning", "sm")} ${__("System Manager Users")} (${d.system_manager_users.length})</h4>
				<div class="ps-health-pills">
					${d.system_manager_users.map((u) => `
						<a href="/app/user/${u}" target="_blank" class="ps-health-pill ps-pill-warn">${esc(u)}</a>
					`).join("")}
				</div>
			</div>`;
		}

		// Users with no roles
		if (d.users_no_roles.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("error", "sm")} ${__("Users with No Roles")} (${d.users_no_roles_count})</h4>
				<div class="ps-health-pills">
					${d.users_no_roles.map((u) => `
						<a href="/app/user/${u}" target="_blank" class="ps-health-pill ps-pill-alert">${esc(u)}</a>
					`).join("")}
					${d.users_no_roles_count > 20 ? `<span class="ps-health-pill">+${d.users_no_roles_count - 20} more</span>` : ""}
				</div>
			</div>`;
		}

		// Empty roles
		if (d.roles_no_users.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("info", "sm")} ${__("Empty Roles (No Users)")} (${d.roles_no_users_count})</h4>
				<div class="ps-health-pills">
					${d.roles_no_users.map((r) => `<span class="ps-health-pill">${esc(r)}</span>`).join("")}
					${d.roles_no_users_count > 30 ? `<span class="ps-health-pill">+${d.roles_no_users_count - 30} more</span>` : ""}
				</div>
			</div>`;
		}

		// Sensitive DocTypes with custom overrides
		if (d.sensitive_with_custom.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("shield", "sm")} ${__("Sensitive DocTypes with Custom Permissions")}</h4>
				<div class="ps-health-pills">
					${d.sensitive_with_custom.map((dt) => `
						<a class="ps-health-pill ps-pill-warn" href="/app/permission-studio#doctype=${encodeURIComponent(dt)}">${esc(dt)}</a>
					`).join("")}
				</div>
				<p class="ps-health-note">${__("These DocTypes have custom permission overrides. Review them to ensure they are intentional.")}</p>
			</div>`;
		}

		// Orphan perm rows
		if (d.orphan_role_perms.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("delete", "sm")} ${__("Orphan Permission Rows (Role No Longer Exists)")}</h4>
				<div class="ps-health-pills">
					${d.orphan_role_perms.map((r) => `<span class="ps-health-pill ps-pill-alert">${esc(r)}</span>`).join("")}
				</div>
				<p class="ps-health-note">${__("These Custom DocPerm rows reference roles that no longer exist. They are harmless but waste space. Delete them via bench console: frappe.db.delete('Custom DocPerm', {'role': 'ROLE_NAME'})")}</p>
			</div>`;
		}

		// Over-privileged users
		if (d.over_privileged_users.length) {
			html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning", "sm")} ${__("Users with Many Roles (>10)")}</h4>
				<table class="ps-health-table">
					<thead><tr><th>${__("User")}</th><th>${__("Role Count")}</th></tr></thead>
					<tbody>
						${d.over_privileged_users.map((u) => `
							<tr>
								<td><a href="/app/user/${u.user}" target="_blank">${esc(u.user)}</a></td>
								<td><strong>${u.role_count}</strong></td>
							</tr>
						`).join("")}
					</tbody>
				</table>
			</div>`;
		}

		html += `</div>`;
		this.wrapper.html(html);
		this.wrapper.find(".ps-health-refresh-btn").on("click", () => this.load());
	}

	_tile(icon, value, label, status, sub) {
		const color = { ok: "green", warn: "amber", alert: "red" }[status] || "gray";
		return `<div class="ps-health-tile ps-tile-${color}">
			<div class="ps-tile-icon">${frappe.utils.icon(icon, "md")}</div>
			<div class="ps-tile-value">${value}</div>
			<div class="ps-tile-label">${label}</div>
			<div class="ps-tile-sub">${sub}</div>
		</div>`;
	}

	_compute_score(d) {
		let points = 100;
		if (d.system_manager_count > 5) points -= 10;
		if (d.system_manager_count > 10) points -= 10;
		if (d.users_no_roles_count > 0) points -= Math.min(d.users_no_roles_count * 2, 15);
		if (d.orphan_role_perms.length > 0) points -= 10;
		if (d.sensitive_with_custom.length > 0) points -= d.sensitive_with_custom.length * 5;
		if (d.custom_perm_count > 200) points -= 5;
		points = Math.max(0, points);

		const grade = points >= 85 ? "A" : points >= 70 ? "B" : points >= 50 ? "C" : "D";
		const label = { A: __("Excellent"), B: __("Good"), C: __("Needs Attention"), D: __("Critical") }[grade];
		return { points, grade, label };
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


// ─── Test-as-User Simulation Panel ───────────────────────────────────────────

export function showUserSimulation(user) {
	const dialog = new frappe.ui.Dialog({
		title: __("Access Simulation — {0}", [user]),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "sim_html" }],
	});

	const $w = dialog.fields_dict.sim_html.$wrapper;
	$w.html(`<div class="ps-sim-loading">${frappe.utils.icon("refresh", "md")} ${__("Simulating access…")}</div>`);
	dialog.show();

	frappe.call({
		method: "permission_manager.permission_manager.api.lookup.simulate_user_access",
		args: { user },
		callback: (r) => {
			if (r.message) _render_simulation($w, r.message);
		},
		error: () => {
			$w.html(`<div class="ps-error-state"><div class="ps-error-msg">${__("Simulation failed.")}</div></div>`);
		},
	});
}

function _render_simulation($w, d) {
	const last_login = d.last_login
		? frappe.datetime.str_to_user(d.last_login)
		: __("Never");

	let html = `
		<div class="ps-sim-wrapper">
			<div class="ps-sim-user-card">
				${d.user_image
					? `<img src="${esc(d.user_image)}" class="ps-sim-avatar">`
					: `<div class="ps-sim-avatar ps-avatar-placeholder">${(d.full_name || d.user)[0].toUpperCase()}</div>`}
				<div>
					<div class="ps-sim-name">${esc(d.full_name || d.user)}</div>
					<div class="ps-sim-email">${esc(d.email || d.user)}</div>
					<div class="ps-sim-meta">${__("Last login")}: ${last_login}</div>
					<div class="ps-sim-roles">
						${d.roles.map((r) => `<span class="ps-badge ps-xs-badge">${esc(r)}</span>`).join(" ")}
					</div>
				</div>
				<div class="ps-sim-actions">
					<a href="/app/user/${encodeURIComponent(d.user)}" target="_blank"
					   class="btn btn-xs btn-default">
						${frappe.utils.icon("link-url", "xs")} ${__("Open User Record")}
					</a>
				</div>
			</div>

			<!-- Summary tiles -->
			<div class="ps-sim-tiles">
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.total_accessible_doctypes}</div>
					<div class="ps-tile-label">${__("Accessible DocTypes")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.total_modules}</div>
					<div class="ps-tile-label">${__("Modules")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.roles.length}</div>
					<div class="ps-tile-label">${__("Roles")}</div>
				</div>
			</div>`;

	// Sensitive access
	if (d.sensitive_access.length) {
		html += `<h4 class="ps-sim-section-title">${__("Sensitive DocType Access")}</h4>
		<table class="ps-health-table">
			<thead><tr>
				<th>${__("DocType")}</th>
				<th>${__("Read")}</th><th>${__("Write")}</th>
				<th>${__("Create")}</th><th>${__("Delete")}</th><th>${__("Submit")}</th>
			</tr></thead><tbody>`;

		d.sensitive_access.forEach((s) => {
			const icon = (v) => v ? `<span style="color:var(--ps-green)">✓</span>` : `<span style="color:var(--ps-red)">✗</span>`;
			html += `<tr>
				<td><strong>${esc(s.doctype)}</strong></td>
				<td>${icon(s.read)}</td><td>${icon(s.write)}</td>
				<td>${icon(s.create)}</td><td>${icon(s.delete)}</td><td>${icon(s.submit)}</td>
			</tr>`;
		});

		html += `</tbody></table>`;
	}

	// Module breakdown
	html += `<h4 class="ps-sim-section-title">${__("Module Breakdown")}</h4>
	<div class="ps-sim-module-grid">`;

	d.modules.forEach((mod) => {
		const pct = mod.doctypes.length
			? Math.round((mod.write / mod.read) * 100)
			: 0;
		html += `<div class="ps-sim-module-card">
			<div class="ps-sim-mod-name">${esc(mod.module)}</div>
			<div class="ps-sim-mod-stats">
				<span title="${__("Can read")}" class="ps-sim-stat ps-stat-read">${frappe.utils.icon("eye", "xs")} ${mod.read}</span>
				<span title="${__("Can write")}" class="ps-sim-stat ps-stat-write">${frappe.utils.icon("edit", "xs")} ${mod.write}</span>
				<span title="${__("Can create")}" class="ps-sim-stat ps-stat-create">${frappe.utils.icon("add", "xs")} ${mod.create}</span>
				<span title="${__("Can delete")}" class="ps-sim-stat ps-stat-delete">${frappe.utils.icon("delete", "xs")} ${mod.delete}</span>
			</div>
			<div class="ps-sim-progress" title="${__("Write access: {0}%", [pct])}">
				<div class="ps-sim-progress-bar" style="width:${pct}%"></div>
			</div>
		</div>`;
	});

	html += `</div></div>`;
	$w.html(html);
}
