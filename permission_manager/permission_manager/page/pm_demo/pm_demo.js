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
		this._load_status();
	}

	// ── Shell ──────────────────────────────────────────────────────────────

	_render_shell() {
		this.$body.html(`
			<div class="pm-demo-wrap container" style="max-width:860px;padding:24px 0;">

				<!-- Header -->
				<div class="pm-demo-header" style="margin-bottom:28px;">
					<h2 style="margin:0 0 6px;">PM Workflow — Live Demo</h2>
					<p style="color:#6c757d;margin:0;">
						Sets up a complete end-to-end example: three demo users, an Employee
						with a two-level Approval Chain, a PM Workflow on the <strong>Note</strong>
						DocType, an active Approver Delegation, and a sample Note ready to submit.
						<br>Everything can be deleted with one click when you are done.
					</p>
				</div>

				<!-- Status card -->
				<div class="pm-demo-card" id="pm-status-card" style="
					background:#fff;border:1px solid #e2e6ea;border-radius:8px;
					padding:20px 24px;margin-bottom:20px;">
					<div class="pm-status-spinner" style="color:#aaa;font-size:13px;">
						<span class="spinner-border spinner-border-sm"></span> Checking status…
					</div>
					<div class="pm-status-content" style="display:none;"></div>
				</div>

				<!-- Action buttons -->
				<div class="pm-demo-actions" style="display:flex;gap:12px;margin-bottom:28px;">
					<button class="btn btn-primary btn-sm pm-btn-setup" style="display:none;">
						<i class="fa fa-play-circle"></i> Setup Demo
					</button>
					<button class="btn btn-danger btn-sm pm-btn-teardown" style="display:none;">
						<i class="fa fa-trash"></i> Delete Demo
					</button>
				</div>

				<!-- Log output -->
				<div class="pm-demo-log" style="display:none;">
					<h6 style="margin-bottom:8px;font-weight:600;">Activity Log</h6>
					<div class="pm-log-items" style="
						background:#f8f9fa;border-radius:6px;padding:14px 18px;
						font-size:12px;font-family:monospace;line-height:1.8;
						max-height:300px;overflow-y:auto;"></div>
				</div>

				<!-- Walkthrough -->
				<div class="pm-demo-guide" style="margin-top:36px;">
					<h5 style="margin-bottom:16px;font-weight:600;">How to try it after setup</h5>
					<div class="pm-steps"></div>
				</div>
			</div>
		`);

		this.$setup    = this.$body.find(".pm-btn-setup");
		this.$teardown = this.$body.find(".pm-btn-teardown");
		this.$log      = this.$body.find(".pm-demo-log");
		this.$logItems = this.$body.find(".pm-log-items");

		this.$setup.on("click",    () => this._run_setup());
		this.$teardown.on("click", () => this._confirm_teardown());

		this._render_guide();
	}

	// ── Status ─────────────────────────────────────────────────────────────

	_load_status() {
		frappe.call({
			method: "permission_manager.permission_manager.api.demo.get_demo_status",
			callback: (r) => this._apply_status(r.message),
		});
	}

	_apply_status(status) {
		const $card = this.$body.find("#pm-status-card");
		$card.find(".pm-status-spinner").hide();
		const $content = $card.find(".pm-status-content").show();

		const badge = status.is_setup
			? `<span class="badge badge-success" style="font-size:13px;padding:4px 10px;">Demo is Active</span>`
			: `<span class="badge badge-secondary" style="font-size:13px;padding:4px 10px;">Not Set Up</span>`;

		const rows = Object.entries(status.checks).map(([label, ok]) => `
			<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f3f5;">
				<span style="color:${ok ? "#28a745" : "#aaa"};font-size:16px;">${ok ? "✓" : "○"}</span>
				<span style="font-size:13px;color:${ok ? "#212529" : "#6c757d"};">${label}</span>
			</div>
		`).join("");

		const links = Object.entries(status.links)
			.filter(([, url]) => url)
			.map(([label, url]) => `<a href="${url}" class="badge badge-light mr-1" style="font-size:11px;">${label}</a>`)
			.join("");

		$content.html(`
			<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
				<strong>Demo Status</strong> ${badge}
			</div>
			<div style="margin-bottom:${links ? 16 : 0}px;">${rows}</div>
			${links ? `<div style="margin-top:10px;"><span style="font-size:11px;color:#6c757d;margin-right:6px;">Quick links:</span>${links}</div>` : ""}
		`);

		this.$setup.toggle(!status.is_setup);
		this.$teardown.toggle(!!status.is_setup);
	}

	// ── Setup ──────────────────────────────────────────────────────────────

	_run_setup() {
		this.$setup.prop("disabled", true).html(
			'<span class="spinner-border spinner-border-sm"></span> Setting up…'
		);
		this.$log.hide();
		this.$logItems.empty();

		frappe.call({
			method: "permission_manager.permission_manager.api.demo.setup_demo",
			callback: (r) => {
				this.$setup.prop("disabled", false).html(
					'<i class="fa fa-play-circle"></i> Setup Demo'
				);
				this._show_log(r.message);
				if (r.message.success) {
					frappe.show_alert({ message: "Demo set up successfully!", indicator: "green" });
					this._load_status();
				} else {
					frappe.show_alert({ message: r.message.error || "Setup failed.", indicator: "red" });
				}
			},
		});
	}

	// ── Teardown ───────────────────────────────────────────────────────────

	_confirm_teardown() {
		frappe.confirm(
			"<strong>Delete all demo data?</strong><br><br>"
			+ "This will permanently remove the 3 demo users, employee, PM Workflow, "
			+ "delegation record, custom field on Note, and the sample Note. "
			+ "<br><br>Continue?",
			() => this._run_teardown()
		);
	}

	_run_teardown() {
		this.$teardown.prop("disabled", true).html(
			'<span class="spinner-border spinner-border-sm"></span> Deleting…'
		);
		this.$log.hide();
		this.$logItems.empty();

		frappe.call({
			method: "permission_manager.permission_manager.api.demo.teardown_demo",
			callback: (r) => {
				this.$teardown.prop("disabled", false).html(
					'<i class="fa fa-trash"></i> Delete Demo'
				);
				this._show_log(r.message);
				if (r.message.success) {
					frappe.show_alert({ message: "Demo deleted successfully.", indicator: "green" });
					this._load_status();
				} else {
					frappe.show_alert({ message: r.message.error || "Teardown failed.", indicator: "red" });
				}
			},
		});
	}

	// ── Log ────────────────────────────────────────────────────────────────

	_show_log(result) {
		const lines = (result.log || []).map((l) =>
			`<div style="color:${l.startsWith("Created") || l.startsWith("Set") ? "#28a745" : l.startsWith("Deleted") ? "#dc3545" : "#6c757d"};">${l}</div>`
		).join("");

		const err = result.error
			? `<div style="color:#dc3545;margin-top:8px;white-space:pre-wrap;">${result.error}</div>`
			: "";

		this.$logItems.html(lines + err);
		this.$log.show();
	}

	// ── Walkthrough guide ──────────────────────────────────────────────────

	_render_guide() {
		const steps = [
			{
				icon: "👤",
				title: "Step 1 — Log in as the Submitter",
				body: `Log in as <code>demo.submitter@pm-demo.test</code> (password set to <code>password</code> by Frappe).<br>
					Open the <strong>Sample Note</strong> → click <strong>PM Demo Submit</strong> in the actions menu.<br>
					The note moves to <em>PM Demo Pending L1</em>. A PM Workflow Action is created
					with <code>assigned_to = demo.approver1@pm-demo.test</code>.`,
			},
			{
				icon: "✅",
				title: "Step 2 — Level 1 approval (or see delegation in action)",
				body: `Log in as <code>demo.approver1@pm-demo.test</code> → open the Note.<br>
					You will see the <strong>PM Demo Approve</strong> and <strong>PM Demo Reject</strong> buttons — nobody else will see them.<br>
					<br>
					<strong>Delegation twist:</strong> The setup also creates an active PM Approver Delegation
					where Approver L1 is covered by Approver L2 for 7 days. Log in as
					<code>demo.approver2@pm-demo.test</code> instead — they will also see the buttons
					because the delegation is active.`,
			},
			{
				icon: "✅",
				title: "Step 3 — Level 2 approval",
				body: `After L1 approves, the note moves to <em>PM Demo Pending L2</em>.<br>
					Log in as <code>demo.approver2@pm-demo.test</code> → click <strong>PM Demo Approve</strong>.<br>
					The note reaches <em>PM Demo Approved</em>.`,
			},
			{
				icon: "🔄",
				title: "Step 4 — Try Reassign Approver (as System Manager)",
				body: `While the note is pending at any level, log back in as <strong>Administrator</strong>.<br>
					Open the note — you will see a <strong>"Reassign Approver"</strong> button under the Workflow menu.<br>
					Pick any user → they become the new assigned approver. The old assignee loses the buttons.`,
			},
			{
				icon: "❌",
				title: "Step 5 — Try Reject with required comment",
				body: `At either pending state, click <strong>PM Demo Reject</strong>.<br>
					A dialog appears requiring a comment before the action can proceed — illustrating the
					<em>Require Comment</em> flag on rejection transitions.`,
			},
			{
				icon: "🗑️",
				title: "Step 6 — Clean up",
				body: `When done, click <strong>Delete Demo</strong> above. All users, the employee,
					the workflow, the custom field, and the sample note are permanently removed.`,
			},
		];

		const html = steps.map((s, i) => `
			<div style="display:flex;gap:16px;margin-bottom:20px;">
				<div style="font-size:26px;flex-shrink:0;line-height:1.3;">${s.icon}</div>
				<div style="
					background:#fff;border:1px solid #e2e6ea;border-radius:8px;
					padding:14px 18px;flex:1;">
					<div style="font-weight:600;margin-bottom:6px;">${s.title}</div>
					<div style="font-size:13px;color:#495057;line-height:1.6;">${s.body}</div>
				</div>
			</div>
		`).join("");

		this.$body.find(".pm-steps").html(html);
	}
}
