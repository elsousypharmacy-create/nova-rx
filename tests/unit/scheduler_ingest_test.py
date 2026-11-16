"""Inbox ingest never overwrites existing task status; ingested files are not re-queued."""
import importlib.util, json, os, tempfile, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("sched_ing", os.path.join(ROOT, ".nova/cloud_scheduler.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)


def _write_inbox(d, fn, tasks):
    path = os.path.join(d, fn)
    with open(path, "w") as f:
        json.dump({"tasks": tasks}, f)
    return fn


class IngestFollowups(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.inbox = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_existing_status_is_not_reset(self):
        items = [
            {"id": "UX443", "status": "done", "pr": 504, "title": "old", "brief": "old"},
            {"id": "UX434", "status": "pr_open", "pr": 510, "title": "old", "brief": "old"},
            {"id": "UX444", "status": "pending", "title": "build", "brief": "build"},
        ]
        byid = {t["id"]: t for t in items}
        q = {"tasks": items}
        _write_inbox(self.inbox, "qa-loop-431-fixes.json", [
            {"id": "UX443", "title": "new title", "brief": "new brief"},
            {"id": "UX434", "title": "new title", "brief": "new brief"},
            {"id": "UX444", "title": "new title", "brief": "new brief"},
        ])
        S.ingest_followups(items, byid, q, inbox_dir=self.inbox)
        self.assertEqual(byid["UX443"]["status"], "done")
        self.assertEqual(byid["UX443"]["pr"], 504)
        self.assertEqual(byid["UX443"]["title"], "old")
        self.assertEqual(byid["UX434"]["status"], "pr_open")
        self.assertEqual(byid["UX444"]["status"], "pending")
        self.assertEqual(byid["UX444"]["title"], "build")
        self.assertIn("qa-loop-431-fixes.json", q["ingested_inbox"])

    def test_new_ids_are_queued_pending_then_file_is_skipped(self):
        items = [{"id": "DONE1", "status": "done", "title": "d", "brief": "d"},
                 {"id": "P1", "status": "pending", "title": "p", "brief": "p"}]
        byid = {t["id"]: t for t in items}
        q = {"tasks": items}
        _write_inbox(self.inbox, "qa-loop-431-fixes.json", [
            {"id": "UX432", "title": "float", "brief": "fix float rerender"},
            {"id": "UX444", "title": "build", "brief": "rebuild artifact", "after": ["UX432"]},
        ])
        S.ingest_followups(items, byid, q, inbox_dir=self.inbox)
        self.assertEqual(byid["UX432"]["status"], "pending")
        self.assertEqual(byid["UX444"]["status"], "pending")
        self.assertEqual(byid["UX444"]["after"], ["UX432"])
        self.assertEqual(byid["UX432"]["source"], "inbox/qa-loop-431-fixes.json")
        # new follow-ups land before the first already-pending task
        ids = [t["id"] for t in items]
        self.assertLess(ids.index("UX432"), ids.index("P1"))
        self.assertIn("qa-loop-431-fixes.json", q["ingested_inbox"])

        # A later run must not re-queue even if the tasks were dropped from the queue
        items[:] = [items[0]]  # only DONE1
        byid.clear(); byid["DONE1"] = items[0]
        S.ingest_followups(items, byid, q, inbox_dir=self.inbox)
        self.assertNotIn("UX432", byid)
        self.assertNotIn("UX444", byid)
        self.assertEqual([t["id"] for t in items], ["DONE1"])

    def test_other_inbox_files_still_ingest(self):
        items = [{"id": "UX432", "status": "done", "title": "t", "brief": "b"}]
        byid = {t["id"]: t for t in items}
        q = {"tasks": items, "ingested_inbox": ["qa-loop-431-fixes.json"]}
        _write_inbox(self.inbox, "qa-loop-431-fixes.json", [
            {"id": "UX432", "title": "again", "brief": "should stay skipped"},
            {"id": "UX999", "title": "ghost", "brief": "must not be added"},
        ])
        _write_inbox(self.inbox, "qa-loop-500-fixes.json", [
            {"id": "UX500", "title": "next", "brief": "new cycle"},
        ])
        S.ingest_followups(items, byid, q, inbox_dir=self.inbox)
        self.assertNotIn("UX999", byid)
        self.assertEqual(byid["UX432"]["status"], "done")
        self.assertEqual(byid["UX500"]["status"], "pending")
        self.assertIn("qa-loop-500-fixes.json", q["ingested_inbox"])


if __name__ == "__main__":
    unittest.main()
