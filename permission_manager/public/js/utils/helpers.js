// Permission Manager — Permission Studio Helpers
// Author: siva <siva@enfono.com>

export const MATRIX_RIGHTS = [
	"select", "read", "write", "create", "delete",
	"submit", "cancel", "amend",
	"print", "email", "report", "import", "export", "share",
];

export const RIGHT_LABELS = {
	select: "Se", read: "R", write: "W", create: "C", delete: "D",
	submit: "S", cancel: "X", amend: "A",
	print: "Pr", email: "Em", report: "Rp",
	import: "Im", export: "Ex", share: "Sh",
};

export const RIGHT_FULL_LABELS = {
	select: "Select", read: "Read", write: "Write", create: "Create", delete: "Delete",
	submit: "Submit", cancel: "Cancel", amend: "Amend",
	print: "Print", email: "Email", report: "Report",
	import: "Import", export: "Export", share: "Share",
};

export const PERM_ICONS = {
	allow: "✓",
	deny: "✗",
	cond: "◐",
	na: "—",
};

export function esc(str) {
	return frappe.utils.escape_html(str || "");
}
