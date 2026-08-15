import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, getdate, nowdate

from permission_manager.permission_manager.api.backdate_control import (
	NO_LIMIT,
	allowed_backdate_days,
	resolve_date_field,
)


def _settings(rules, default_days=NO_LIMIT):
	"""A stand-in for PM Settings carrying just what the resolver reads."""
	return frappe._dict(
		enforce_backdate_control=1,
		default_backdate_days=default_days,
		backdate_rules=[frappe._dict(r) for r in rules],
	)


def _rule(doctype="Purchase Invoice", applies_to="Role", value="Accounts User", days=0, **kw):
	base = {
		"enabled": 1,
		"document_type": doctype,
		"applies_to": applies_to,
		"applies_to_value": value,
		"max_backdate_days": days,
		"date_field": None,
	}
	base.update(kw)
	return base


class TestBackdateControl(FrappeTestCase):
	def test_doctype_with_no_rule_is_unrestricted(self):
		settings = _settings([_rule(doctype="Purchase Invoice")])

		self.assertIsNone(allowed_backdate_days("Journal Entry", "Administrator", settings))

	def test_role_rule_grants_its_days(self):
		settings = _settings([_rule(value="Accounts User", days=7)])

		days = allowed_backdate_days("Purchase Invoice", "Administrator", settings)
		# Administrator holds every role, so the rule matches
		self.assertEqual(days, 7)

	def test_most_generous_rule_wins(self):
		"""Rules grant permission — a second role must never take away what the first gave."""
		settings = _settings([
			_rule(value="Accounts User", days=2),
			_rule(value="Accounts Manager", days=30),
		])

		self.assertEqual(allowed_backdate_days("Purchase Invoice", "Administrator", settings), 30)

	def test_user_rule_matches_by_name(self):
		settings = _settings([
			_rule(applies_to="User", value="backdater@example.com", days=90),
		])

		self.assertEqual(
			allowed_backdate_days("Purchase Invoice", "backdater@example.com", settings), 90
		)
		# and grants nothing to anyone else: no rule matches, so the fallback applies
		self.assertEqual(
			allowed_backdate_days("Purchase Invoice", "someone.else@example.com", settings),
			NO_LIMIT,
		)

	def test_disabled_rule_is_ignored(self):
		settings = _settings([_rule(value="Accounts User", days=5, enabled=0)])

		self.assertIsNone(allowed_backdate_days("Purchase Invoice", "Administrator", settings))

	def test_fallback_applies_to_users_no_rule_matches(self):
		settings = _settings(
			[_rule(applies_to="User", value="nobody@example.com", days=90)], default_days=0
		)

		self.assertEqual(allowed_backdate_days("Purchase Invoice", "other@example.com", settings), 0)

	def test_date_field_falls_back_to_the_documents_own(self):
		self.assertEqual(resolve_date_field("Purchase Invoice", []), "posting_date")
		self.assertEqual(resolve_date_field("Purchase Order", []), "transaction_date")

	def test_rule_may_name_the_date_field(self):
		self.assertEqual(
			resolve_date_field("Purchase Invoice", [frappe._dict(_rule(date_field="bill_date"))]),
			"bill_date",
		)

	def test_earliest_allowed_date_arithmetic(self):
		"""The window is inclusive: N days back is still allowed, N+1 is not."""
		days = 3
		earliest = add_days(getdate(nowdate()), -days)

		self.assertGreaterEqual(getdate(earliest), earliest)
		self.assertLess(getdate(add_days(earliest, -1)), earliest)
