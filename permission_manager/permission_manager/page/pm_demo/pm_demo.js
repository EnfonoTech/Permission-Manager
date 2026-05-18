// Permission Manager — PM Workflow Demo Page
// Author: siva <siva@enfono.com>

frappe.pages["pm-demo"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "PM Workflow Demo",
		single_column: true,
	});
	frappe.pm_demo = new PMDemoPage(page);
};

class PMDemoPage {
	constructor(page) {
		this.page = page;
		this.$body = $(this.page.body);
		this._render_shell();
		this._load_all_status();
	}

	// ── Shell ──────────────────────────────────────────────────────────────

	_render_shell() {
		this.$body.html(`
			<div class="pm-demo-wrap container" style="max-width:900px;padding:24px 0;">

				<div style="margin-bottom:32px;">
					<h2 style="margin:0 0 6px;">PM Workflow — Live Demos</h2>
					<p style="color:#6c757d;margin:0;">
						Each demo creates a complete end-to-end setup: demo users, an Employee
						with a 2-level Approval Chain, a PM Workflow, and a sample document.
						Every demo can be deleted independently with one click.
					</p>
				</div>

				<!-- ── Note Demo ───────────────────────────────────────── -->
				<div class="pm-demo-section" style="margin-bottom:40px;">
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
						<span style="font-size:22px;">📝</span>
						<div>
							<h4 style="margin:0;font-weight:600;">Demo 1 — Note (Simple)</h4>
							<small style="color:#6c757d;">Basic 2-level routing on the Note doctype. Good starting point.</small>
						</div>
					</div>
					<div class="pm-status-card pm-note-status" style="background:#fff;border:1px solid #e2e6ea;border-radius:8px;padding:18px 22px;margin-bottom:12px;">
						<div class="pm-spinner" style="color:#aaa;font-size:13px;"><span class="spinner-border spinner-border-sm"></span> Checking…</div>
						<div class="pm-status-content" style="display:none;"></div>
					</div>
					<div style="display:flex;gap:10px;margin-bottom:14px;">
						<button class="btn btn-primary btn-sm pm-note-setup" style="display:none;"><i class="fa fa-play-circle"></i> Setup Note Demo</button>
						<button class="btn btn-danger  btn-sm pm-note-teardown" style="display:none;"><i class="fa fa-trash"></i> Delete Note Demo</button>
					</div>
					<div class="pm-log pm-note-log" style="display:none;">
						<div class="pm-log-items" style="background:#f8f9fa;border-radius:6px;padding:12px 16px;font-size:12px;font-family:monospace;line-height:1.8;max-height:240px;overflow-y:auto;"></div>
					</div>
				</div>

				<!-- ── Purchase Invoice Demo ───────────────────────────── -->
				<div class="pm-demo-section" style="margin-bottom:40px;">
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
						<span style="font-size:22px;">🧾</span>
						<div>
							<h4 style="margin:0;font-weight:600;">Demo 2 — Purchase Invoice (Employee Matrix)</h4>
							<small style="color:#6c757d;">2-level approval on Purchase Invoice — each submitter routes to their named approver.</small>
						</div>
					</div>
					<div class="pm-status-card pm-pi-status" style="background:#fff;border:1px solid #e2e6ea;border-radius:8px;padding:18px 22px;margin-bottom:12px;">
						<div class="pm-spinner" style="color:#aaa;font-size:13px;"><span class="spinner-border spinner-border-sm"></span> Checking…</div>
						<div class="pm-status-content" style="display:none;"></div>
					</div>
					<div style="display:flex;gap:10px;margin-bottom:14px;">
						<button class="btn btn-primary btn-sm pm-pi-setup"    style="display:none;"><i class="fa fa-play-circle"></i> Setup PI Demo</button>
						<button class="btn btn-danger  btn-sm pm-pi-teardown" style="display:none;"><i class="fa fa-trash"></i> Delete PI Demo</button>
					</div>
					<div class="pm-log pm-pi-log" style="display:none;">
						<div class="pm-log-items" style="background:#f8f9fa;border-radius:6px;padding:12px 16px;font-size:12px;font-family:monospace;line-height:1.8;max-height:240px;overflow-y:auto;"></div>
					</div>
				</div>

				<!-- ── PI Walkthrough ──────────────────────────────────── -->
				<div class="pm-pi-guide" style="margin-top:8px;">
					<h5 style="margin-bottom:16px;font-weight:600;">Purchase Invoice Demo — How to try it</h5>
					<div class="pm-pi-steps"></div>
				</div>

			</div>
		`);

		// Note demo wiring
		this.$body.find(".pm-note-setup")   .on("click", () => this._run("note", "setup"));
		this.$body.find(".pm-note-teardown").on("click", () => this._confirm_teardown("note"));

		// PI demo wiring
		this.$body.find(".pm-pi-setup")   .on("click", () => this._run("pi", "setup"));
		this.$body.find(".pm-pi-teardown").on("click", () => this._confirm_teardown("pi"));

		this._render_pi_guide();
	}

	// ── Load both statuses ────────────────────────────────────────────────

	_load_all_status() {
		frappe.call({
			method: "permission_manager.permission_manager.api.demo.get_demo_status",
			callback: (r) => this._apply_status("note", r.message),
		});
		frappe.call({
			method: "permission_manager.permission_manager.api.demo_pi.get_pi_demo_status",
			callback: (r) => this._apply_status("pi", r.message),
		});
	}

	// ── Status card ──────────────────────────────────────────────────────

	_apply_status(key, status) {
		const $section = this.$body.find(`.pm-${key}-status`);
		$section.find(".pm-spinner").hide();
		const $content = $section.find(".pm-status-content").show();

		const badge = status.is_setup
			? `<span class="badge badge-success" style="font-size:12px;padding:3px 9px;">Active</span>`
			: `<span class="badge badge-secondary" style="font-size:12px;padding:3px 9px;">Not Set Up</span>`;

		const rows = Object.entries(status.checks).map(([label, ok]) => `
			<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f1f3f5;">
				<span style="color:${ok ? "#28a745" : "#aaa"};font-size:15px;">${ok ? "✓" : "○"}</span>
				<span style="font-size:13px;color:${ok ? "#212529" : "#6c757d"};">${label}</span>
			</div>
		`).join("");

		const links = Object.entries(status.links || {})
			.filter(([, url]) => url)
			.map(([label, url]) =>
				`<a href="${url}" class="badge badge-light mr-1" style="font-size:11px;">${label}</a>`
			).join("");

		$content.html(`
			<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
				<strong style="font-size:13px;">Status</strong> ${badge}
			</div>
			<div style="margin-bottom:${links ? 12 : 0}px;">${rows}</div>
			${links ? `<div style="margin-top:8px;"><span style="font-size:11px;color:#6c757d;margin-right:6px;">Quick links:</span>${links}</div>` : ""}
		`);

		this.$body.find(`.pm-${key}-setup`)   .toggle(!status.is_setup);
		this.$body.find(`.pm-${key}-teardown`).toggle(!!status.is_setup);
	}

	// ── Run setup / teardown ─────────────────────────────────────────────

	_run(key, action) {
		const methods = {
			note: {
				setup:    "permission_manager.permission_manager.api.demo.setup_demo",
				teardown: "permission_manager.permission_manager.api.demo.teardown_demo",
			},
			pi: {
				setup:    "permission_manager.permission_manager.api.demo_pi.setup_pi_demo",
				teardown: "permission_manager.permission_manager.api.demo_pi.teardown_pi_demo",
			},
		};
		const labels = { setup: ["Setting up…", "Setup"], teardown: ["Deleting…", "Delete"] };

		const $btn = this.$body.find(`.pm-${key}-${action}`);
		$btn.prop("disabled", true).html(
			`<span class="spinner-border spinner-border-sm"></span> ${labels[action][0]}`
		);
		this.$body.find(`.pm-${key}-log`).hide();
		this.$body.find(`.pm-${key}-log .pm-log-items`).empty();

		frappe.call({
			method: methods[key][action],
			callback: (r) => {
				$btn.prop("disabled", false).html(
					`<i class="fa fa-${action === "setup" ? "play-circle" : "trash"}"></i> ${labels[action][1]} ${key === "pi" ? "PI" : "Note"} Demo`
				);
				this._show_log(key, r.message);
				if (r.message.success) {
					frappe.show_alert({ message: `${action === "setup" ? "Setup" : "Deleted"} successfully!`, indicator: "green" });
					this._load_all_status();
				} else {
					frappe.show_alert({ message: r.message.error || `${action} failed.`, indicator: "red" });
				}
			},
		});
	}

	_confirm_teardown(key) {
		const label = key === "pi" ? "Purchase Invoice" : "Note";
		frappe.confirm(
			`<strong>Delete all ${label} demo data?</strong><br><br>` +
			`This removes the demo users, employee, PM Workflow, custom field, ` +
			`supplier (PI only), and sample document. Continue?`,
			() => this._run(key, "teardown")
		);
	}

	// ── Log ──────────────────────────────────────────────────────────────

	_show_log(key, result) {
		const lines = (result.log || []).map((l) => {
			const color = l.startsWith("Created") || l.startsWith("Set") || l.startsWith("Granted")
				? "#28a745"
				: l.startsWith("Deleted") || l.startsWith("Removed")
				? "#dc3545"
				: "#6c757d";
			return `<div style="color:${color};">${l}</div>`;
		}).join("");
		const err = result.error
			? `<div style="color:#dc3545;margin-top:8px;white-space:pre-wrap;">${result.error}</div>`
			: "";

		const $log = this.$body.find(`.pm-${key}-log`);
		$log.find(".pm-log-items").html(lines + err);
		$log.show();
	}

	// ── PI Walkthrough ────────────────────────────────────────────────────

	_render_pi_guide() {
		const steps = [
			{
				icon: "👤",
				title: "Step 1 — Log in as PI Submitter",
				body: `Log in as <code>pi.submitter@pm-demo.test</code>.<br>
				Open the sample <strong>Purchase Invoice</strong> (see Quick Link above after setup).<br>
				Click <strong>PI Submit for Approval</strong> in the actions menu →
				document moves to <em>PI Pending L1</em>. A PM Workflow Action is created
				with <code>assigned_to = pi.approver1@pm-demo.test</code> (resolved from the Approval Chain).`,
			},
			{
				icon: "✅",
				title: "Step 2 — Level 1 Approval",
				body: `Log in as <code>pi.approver1@pm-demo.test</code> → open the Purchase Invoice.<br>
				Only this user sees <strong>PI Approve</strong> and <strong>PI Reject</strong>
				— not <em>pi.approver2</em> and not other Accounts Users.<br>
				Click <strong>PI Approve</strong> → moves to <em>PI Pending L2</em>.`,
			},
			{
				icon: "✅",
				title: "Step 3 — Level 2 Approval",
				body: `Log in as <code>pi.approver2@pm-demo.test</code> → open the PI.<br>
				Click <strong>PI Approve</strong> → moves to <em>PI Approved</em>. Done.`,
			},
			{
				icon: "❌",
				title: "Step 4 — Rejection with mandatory comment",
				body: `At either pending state, the approver can click <strong>PI Reject</strong>.<br>
				A dialog appears requiring a comment — the transition has <em>Require Comment</em> enabled.
				The PI moves to <em>PI Rejected</em>.`,
			},
			{
				icon: "🔄",
				title: "Step 5 — Admin Reassignment",
				body: `Log in as <strong>Administrator</strong> while the PI is at any pending state.<br>
				A <strong>"Reassign Approver"</strong> button appears under the Workflow menu.<br>
				Pick any user → they replace the current pending approver immediately.`,
			},
			{
				icon: "🧪",
				title: "Step 6 — Try with a second submitter",
				body: `The key point of the Employee Approver Matrix: create another Employee
				linked to a different user, set a <em>different</em> Level 1 approver in their
				Approval Chain, then have them create a Purchase Invoice. Their PI routes to
				their approver, not to <em>pi.approver1</em> — even though both have the same
				Accounts User role.`,
			},
		];

		const html = steps.map((s) => `
			<div style="display:flex;gap:14px;margin-bottom:18px;">
				<div style="font-size:22px;flex-shrink:0;line-height:1.4;">${s.icon}</div>
				<div style="background:#fff;border:1px solid #e2e6ea;border-radius:8px;padding:12px 16px;flex:1;">
					<div style="font-weight:600;margin-bottom:5px;font-size:13px;">${s.title}</div>
					<div style="font-size:13px;color:#495057;line-height:1.6;">${s.body}</div>
				</div>
			</div>
		`).join("");

		this.$body.find(".pm-pi-steps").html(html);
	}
}
