"""Storage for the prompt library: one researched prompt per task, many
model runs scored against it.

One SQLite database, outside the webroot, at
${XDG_DATA_HOME:-~/.local/share}/nginx-explorer/prompts.db unless PROMPTS_DB
overrides it. explorer-server.py imports this module for routing only; every
query and every dataclass lives here. No HTTP, no printing, no sys.exit.

"schema_version" in the design doc is SQLite's own `PRAGMA user_version`: a
fresh database has it at 0, connect() creates the schema and sets it to 1.
"""

import dataclasses
import os
import re
import sqlite3
import time
from typing import List, Optional, Tuple

SCHEMA_VERSION = 1

SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE task (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT '',
  prompt     TEXT    NOT NULL DEFAULT '',
  notes      TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE task_tag (
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (task_id, tag)
) WITHOUT ROWID;
CREATE INDEX task_tag_tag ON task_tag(tag);

CREATE TABLE task_ref (
  id      INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  kind    TEXT    NOT NULL,
  value   TEXT    NOT NULL,
  label   TEXT    NOT NULL DEFAULT '',
  CHECK (kind IN ('path', 'url'))
);
CREATE INDEX task_ref_task ON task_ref(task_id);

CREATE TABLE run (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,
  harness    TEXT    NOT NULL DEFAULT '',
  rating     INTEGER,
  turns      INTEGER,
  notes      TEXT    NOT NULL DEFAULT '',
  ran_at     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CHECK (turns  IS NULL OR turns >= 1)
);
CREATE INDEX run_task  ON run(task_id, ran_at DESC);
CREATE INDEX run_model ON run(model);

-- FTS5 is present on this host (verified: SQLite 3.50.4). If a future
-- interpreter lacks it, this CREATE raises sqlite3.OperationalError and
-- connect() fails loudly rather than silently losing search.
CREATE VIRTUAL TABLE task_fts USING fts5(
  title, prompt, notes,
  content='task', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER task_ai AFTER INSERT ON task BEGIN
  INSERT INTO task_fts(rowid, title, prompt, notes)
    VALUES (new.id, new.title, new.prompt, new.notes);
END;
CREATE TRIGGER task_ad AFTER DELETE ON task BEGIN
  INSERT INTO task_fts(task_fts, rowid, title, prompt, notes)
    VALUES ('delete', old.id, old.title, old.prompt, old.notes);
END;
CREATE TRIGGER task_au AFTER UPDATE ON task BEGIN
  INSERT INTO task_fts(task_fts, rowid, title, prompt, notes)
    VALUES ('delete', old.id, old.title, old.prompt, old.notes);
  INSERT INTO task_fts(rowid, title, prompt, notes)
    VALUES (new.id, new.title, new.prompt, new.notes);
END;
"""


# ============================================================================
# Dataclasses — every field name here is the JSON field name once serialized
# with dataclasses.asdict, snake_case included.
# ============================================================================

@dataclasses.dataclass
class Run:
    id: int
    task_id: int
    model: str
    harness: str
    rating: Optional[int]
    turns: Optional[int]
    notes: str
    ran_at: int


@dataclasses.dataclass
class Ref:
    id: int
    kind: str  # 'path' | 'url'
    value: str
    label: str


@dataclasses.dataclass
class Task:
    id: int
    title: str
    prompt: str
    notes: str
    tags: List[str]
    refs: List[Ref]
    runs: List[Run]
    created_at: int
    updated_at: int


@dataclasses.dataclass
class TaskSummary:
    """One row of the library list. Never carries the prompt body."""
    id: int
    title: str
    tags: List[str]
    prompt_chars: int
    run_count: int
    avg_rating: Optional[float]
    best_model: Optional[str]
    best_rating: Optional[int]
    updated_at: int


@dataclasses.dataclass
class ModelScore:
    """One row of the leaderboard, optionally scoped to a tag."""
    model: str
    runs: int
    rated: int
    avg_rating: Optional[float]
    strong: int  # runs rated 4 or 5
    tasks: int   # distinct tasks attempted


@dataclasses.dataclass
class Facets:
    tags: List[Tuple[str, int]]
    models: List[ModelScore]
    task_count: int


# ============================================================================
# Connection
# ============================================================================

def default_db_path():
    override = os.environ.get("PROMPTS_DB")
    if override:
        return override
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(data_home, "nginx-explorer", "prompts.db")


def connect(path=None):
    """Open the database, creating the schema on first use.

    One connection per request is the intended usage: a local SQLite open is
    microseconds, and it avoids sharing one connection across the threads of
    ThreadingHTTPServer.
    """
    path = path or default_db_path()
    if path != ":memory:":
        os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        conn.executescript(SCHEMA)
        conn.execute("PRAGMA user_version = %d" % SCHEMA_VERSION)
        conn.commit()
    return conn


# ============================================================================
# Pure helpers
# ============================================================================

def parse_tags(raw):
    """'infra, kyverno, infra' -> ['infra', 'kyverno']. Order kept, case-insensitive dedupe."""
    tags = []
    seen = set()
    for part in (raw or "").split(","):
        tag = part.strip()
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def parse_refs(raw):
    """One ref per non-blank line. A line starting with '/' is a path, else a url."""
    refs = []
    for line in (raw or "").splitlines():
        value = line.strip()
        if not value:
            continue
        kind = "path" if value.startswith("/") else "url"
        refs.append(Ref(id=0, kind=kind, value=value, label=""))
    return refs


_FTS_TOKEN_RE = re.compile(r"\S+")


def fts_query(q):
    """User search text -> a MATCH string FTS5 will not raise on.

    Every token is double-quoted (with internal quotes doubled) so that a
    bare '-', '*', '"' or 'AND' in the input is never parsed as FTS5 syntax.
    The last token gets a trailing '*' for search-as-you-type.
    """
    tokens = _FTS_TOKEN_RE.findall(q or "")
    if not tokens:
        return ""
    quoted = ['"%s"' % t.replace('"', '""') for t in tokens]
    quoted[-1] += "*"
    return " AND ".join(quoted)


def _normalize_ref(ref):
    if isinstance(ref, Ref):
        kind, value, label = ref.kind, ref.value, ref.label
    else:
        kind = ref.get("kind")
        value = ref.get("value", "")
        label = ref.get("label") or ""
    if kind not in ("path", "url"):
        raise ValueError("ref kind must be 'path' or 'url'")
    value = str(value).strip()
    if not value:
        raise ValueError("ref value is required")
    return kind, value, str(label)


def _set_tags(conn, task_id, tags):
    raw = tags if isinstance(tags, str) else ",".join(str(t) for t in (tags or []))
    conn.execute("DELETE FROM task_tag WHERE task_id = ?", (task_id,))
    for tag in parse_tags(raw):
        conn.execute("INSERT OR IGNORE INTO task_tag (task_id, tag) VALUES (?, ?)", (task_id, tag))


def _set_refs(conn, task_id, refs):
    conn.execute("DELETE FROM task_ref WHERE task_id = ?", (task_id,))
    for ref in (refs or []):
        kind, value, label = _normalize_ref(ref)
        conn.execute(
            "INSERT INTO task_ref (task_id, kind, value, label) VALUES (?, ?, ?, ?)",
            (task_id, kind, value, label),
        )


# ============================================================================
# Reads
# ============================================================================

_SORTS = {
    "updated": "t.updated_at DESC",
    "rating": "avg_rating IS NULL, avg_rating DESC",
    "title": "t.title COLLATE NOCASE ASC",
}


def _task_filter(q, tag, model, min_rating):
    """(join sql, where sql, params) shared by list_tasks and count_tasks."""
    joins = []
    where = []
    params = []
    if q:
        joins.append("JOIN task_fts ON task_fts.rowid = t.id")
        where.append("task_fts MATCH ?")
        params.append(fts_query(q))
    if tag:
        where.append("t.id IN (SELECT task_id FROM task_tag WHERE tag = ?)")
        params.append(tag)
    if model or min_rating is not None:
        sub = "SELECT task_id FROM run WHERE 1=1"
        if model:
            sub += " AND model = ?"
        if min_rating is not None:
            sub += " AND rating >= ?"
        where.append("t.id IN (%s)" % sub)
        if model:
            params.append(model)
        if min_rating is not None:
            params.append(min_rating)
    join_sql = " ".join(joins)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    return join_sql, where_sql, params


def list_tasks(conn, q="", tag="", model="", min_rating=None, sort="updated", limit=200, offset=0):
    join_sql, where_sql, params = _task_filter(q, tag, model, min_rating)
    order_sql = _SORTS.get(sort, _SORTS["updated"])
    sql = (
        "SELECT t.id AS id, t.title AS title, t.prompt AS prompt, t.updated_at AS updated_at, "
        "(SELECT GROUP_CONCAT(tag, ',') FROM task_tag WHERE task_id = t.id) AS tags_raw, "
        "(SELECT COUNT(*) FROM run WHERE task_id = t.id) AS run_count, "
        "(SELECT AVG(rating) FROM run WHERE task_id = t.id) AS avg_rating, "
        "(SELECT model FROM run WHERE task_id = t.id AND rating IS NOT NULL "
        " ORDER BY rating DESC, id DESC LIMIT 1) AS best_model, "
        "(SELECT rating FROM run WHERE task_id = t.id AND rating IS NOT NULL "
        " ORDER BY rating DESC, id DESC LIMIT 1) AS best_rating "
        "FROM task t %s %s ORDER BY %s LIMIT ? OFFSET ?"
    ) % (join_sql, where_sql, order_sql)
    rows = conn.execute(sql, params + [limit, offset]).fetchall()
    out = []
    for r in rows:
        tags = r["tags_raw"].split(",") if r["tags_raw"] else []
        out.append(TaskSummary(
            id=r["id"],
            title=r["title"],
            tags=tags,
            prompt_chars=len(r["prompt"] or ""),
            run_count=r["run_count"],
            avg_rating=round(r["avg_rating"], 2) if r["avg_rating"] is not None else None,
            best_model=r["best_model"],
            best_rating=r["best_rating"],
            updated_at=r["updated_at"],
        ))
    return out


def count_tasks(conn, q="", tag="", model="", min_rating=None):
    join_sql, where_sql, params = _task_filter(q, tag, model, min_rating)
    row = conn.execute("SELECT COUNT(*) FROM task t %s %s" % (join_sql, where_sql), params).fetchone()
    return row[0]


def get_task(conn, task_id):
    row = conn.execute(
        "SELECT id, title, prompt, notes, created_at, updated_at FROM task WHERE id = ?",
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    tags = [r[0] for r in conn.execute(
        "SELECT tag FROM task_tag WHERE task_id = ? ORDER BY tag COLLATE NOCASE", (task_id,)
    ).fetchall()]
    refs = [Ref(id=r["id"], kind=r["kind"], value=r["value"], label=r["label"])
            for r in conn.execute(
                "SELECT id, kind, value, label FROM task_ref WHERE task_id = ? ORDER BY id", (task_id,)
            ).fetchall()]
    runs = [Run(id=r["id"], task_id=r["task_id"], model=r["model"], harness=r["harness"],
                rating=r["rating"], turns=r["turns"], notes=r["notes"], ran_at=r["ran_at"])
            for r in conn.execute(
                "SELECT id, task_id, model, harness, rating, turns, notes, ran_at "
                "FROM run WHERE task_id = ? ORDER BY ran_at DESC, id DESC", (task_id,)
            ).fetchall()]
    return Task(id=row["id"], title=row["title"], prompt=row["prompt"], notes=row["notes"],
                tags=tags, refs=refs, runs=runs,
                created_at=row["created_at"], updated_at=row["updated_at"])


def facets(conn, tag=""):
    tag_rows = conn.execute(
        "SELECT tag, COUNT(*) AS n FROM task_tag GROUP BY tag ORDER BY tag COLLATE NOCASE"
    ).fetchall()
    tags = [(r["tag"], r["n"]) for r in tag_rows]

    where_sql, params = "", []
    if tag:
        where_sql = "WHERE r.task_id IN (SELECT task_id FROM task_tag WHERE tag = ?)"
        params.append(tag)
    rows = conn.execute(
        "SELECT r.model AS model, COUNT(*) AS runs, "
        "SUM(CASE WHEN r.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated, "
        "AVG(r.rating) AS avg_rating, "
        "SUM(CASE WHEN r.rating >= 4 THEN 1 ELSE 0 END) AS strong, "
        "COUNT(DISTINCT r.task_id) AS tasks "
        "FROM run r %s GROUP BY r.model ORDER BY avg_rating IS NULL, avg_rating DESC" % where_sql,
        params,
    ).fetchall()
    models = [ModelScore(
        model=r["model"], runs=r["runs"], rated=r["rated"],
        avg_rating=round(r["avg_rating"], 2) if r["avg_rating"] is not None else None,
        strong=r["strong"], tasks=r["tasks"],
    ) for r in rows]
    task_count = conn.execute("SELECT COUNT(*) FROM task").fetchone()[0]
    return Facets(tags=tags, models=models, task_count=task_count)


# ============================================================================
# Writes — task
# ============================================================================

_TASK_FIELDS = ("title", "prompt", "notes")


def create_task(conn, title="", prompt="", notes="", tags=(), refs=()):
    now = int(time.time())
    cur = conn.execute(
        "INSERT INTO task (title, prompt, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (title, prompt, notes, now, now),
    )
    task_id = cur.lastrowid
    _set_tags(conn, task_id, tags)
    _set_refs(conn, task_id, refs)
    conn.commit()
    return get_task(conn, task_id)


def update_task(conn, task_id, **fields):
    unknown = set(fields) - set(_TASK_FIELDS) - {"tags", "refs"}
    if unknown:
        raise ValueError("unknown field(s): %s" % ", ".join(sorted(unknown)))
    if get_task(conn, task_id) is None:
        raise KeyError("no task %d" % task_id)

    sets, params = [], []
    for key in _TASK_FIELDS:
        if key in fields:
            sets.append("%s = ?" % key)
            params.append(fields[key])
    touched = bool(sets) or "tags" in fields or "refs" in fields
    if sets:
        conn.execute("UPDATE task SET %s WHERE id = ?" % ", ".join(sets), params + [task_id])
    if "tags" in fields:
        _set_tags(conn, task_id, fields["tags"])
    if "refs" in fields:
        _set_refs(conn, task_id, fields["refs"])
    if touched:
        conn.execute("UPDATE task SET updated_at = ? WHERE id = ?", (int(time.time()), task_id))
    conn.commit()
    return get_task(conn, task_id)


def delete_task(conn, task_id):
    cur = conn.execute("DELETE FROM task WHERE id = ?", (task_id,))
    if cur.rowcount == 0:
        raise KeyError("no task %d" % task_id)
    conn.commit()


# ============================================================================
# Writes — run
# ============================================================================

_RUN_FIELDS = ("model", "harness", "rating", "turns", "notes", "ran_at")


def _get_run(conn, run_id):
    r = conn.execute(
        "SELECT id, task_id, model, harness, rating, turns, notes, ran_at FROM run WHERE id = ?",
        (run_id,),
    ).fetchone()
    if r is None:
        return None
    return Run(id=r["id"], task_id=r["task_id"], model=r["model"], harness=r["harness"],
               rating=r["rating"], turns=r["turns"], notes=r["notes"], ran_at=r["ran_at"])


def create_run(conn, task_id, model, harness="", rating=None, turns=None, notes="", ran_at=None):
    model = (model or "").strip()
    if not model:
        raise ValueError("model is required")
    if get_task(conn, task_id) is None:
        raise KeyError("no task %d" % task_id)
    now = int(time.time())
    ran_at = int(ran_at) if ran_at is not None else now
    try:
        cur = conn.execute(
            "INSERT INTO run (task_id, model, harness, rating, turns, notes, ran_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (task_id, model, harness or "", rating, turns, notes or "", ran_at, now),
        )
    except sqlite3.IntegrityError as err:
        raise ValueError(str(err))
    conn.execute("UPDATE task SET updated_at = ? WHERE id = ?", (now, task_id))
    conn.commit()
    return _get_run(conn, cur.lastrowid)


def update_run(conn, run_id, **fields):
    unknown = set(fields) - set(_RUN_FIELDS)
    if unknown:
        raise ValueError("unknown field(s): %s" % ", ".join(sorted(unknown)))
    row = conn.execute("SELECT task_id FROM run WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise KeyError("no run %d" % run_id)

    sets, params = [], []
    for key in _RUN_FIELDS:
        if key in fields:
            sets.append("%s = ?" % key)
            params.append(fields[key])
    if sets:
        try:
            conn.execute("UPDATE run SET %s WHERE id = ?" % ", ".join(sets), params + [run_id])
        except sqlite3.IntegrityError as err:
            raise ValueError(str(err))
        conn.execute("UPDATE task SET updated_at = ? WHERE id = ?", (int(time.time()), row["task_id"]))
    conn.commit()
    return _get_run(conn, run_id)


def delete_run(conn, run_id):
    row = conn.execute("SELECT task_id FROM run WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise KeyError("no run %d" % run_id)
    conn.execute("DELETE FROM run WHERE id = ?", (run_id,))
    conn.execute("UPDATE task SET updated_at = ? WHERE id = ?", (int(time.time()), row["task_id"]))
    conn.commit()
