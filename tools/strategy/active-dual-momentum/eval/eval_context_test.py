import unittest

from eval_context import join_ints, resolve_eval_config_context


class EvalContextTest(unittest.TestCase):
    def test_join_ints_uses_comma_separated_values(self):
        self.assertEqual(join_ints([1, 2, 3]), "1,2,3")

    def test_resolve_eval_config_context_loads_shared_defaults(self):
        context = resolve_eval_config_context(
            sizes="5,10",
            windows="1,2",
            end_date="2026-05-27",
        )

        self.assertEqual(context.basket_sizes, [5, 10])
        self.assertEqual(context.windows_years, [1, 2])
        self.assertEqual(context.end_date, "2026-05-27")
        self.assertEqual(context.required_start, "2023-11-06")
        self.assertIn("strategyConfig", context.defaults)
        self.assertGreater(len(context.universe), 0)
        self.assertIsInstance(context.conflict_groups, dict)


if __name__ == "__main__":
    unittest.main()
