"""Single-file Markdown commands for an isolated prototype vault.

Standard library only. SQLite journals operations; Markdown remains the source.
This is NOT a multi-file transaction engine or a concurrent external-editor API.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

MAX_BYTES = 1024 * 1024
MARKER = "xuye-isolated-prototype-v1"


class Problem(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.status = code, status


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_path(value: object) -> str:
    if not isinstance(value, str) or len(value) > 240:
        raise Problem("INVALID_PATH", "请输入不超过 240 字符的相对 Markdown 路径。", 400)
    parts = value.split("/")
    if len(parts) > 10 or any(
        not p or p in (".", "..") or p.startswith(".") or p.endswith((" ", "."))
        or re.search(r'[<>:"\\|?*\x00-\x1f\x7f]', p)
        or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", p)
        for p in parts
    ) or not value.lower().endswith(".md"):
        raise Problem("INVALID_PATH", "只允许库内普通 .md 文件；不允许隐藏路径、越界或保留名称。", 400)
    return value


def validate_operation_id(value: object) -> str:
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError):
        raise Problem("INVALID_OPERATION", "操作号必须为标准 UUID。", 400) from None
    return value


class Vault:
    def __init__(self, root: Path, *, initialize: bool = False,
                 fault: Callable[[str], None] | None = None):
        self.lock = threading.RLock()
        self.fault = fault or (lambda _: None)
        given = Path(root).expanduser().absolute()
        # Canonicalize OS ancestors (e.g. macOS /var), but reject a linked vault itself.
        if given.is_symlink():
            raise Problem("UNSAFE_VAULT", "原型不接受符号链接知识库。")
        self.root = given.resolve()
        if not self.root.exists():
            if not initialize:
                raise Problem("NOT_INITIALIZED", "先使用 --init 创建专用测试库。")
            self.root.mkdir(parents=True)
        if not self.root.is_dir():
            raise Problem("UNSAFE_VAULT", "知识库路径不是目录。")
        self.private = self.root / ".xuye-local"
        marker = self.private / "prototype.json"
        if not marker.is_file():
            if not initialize or any(self.root.iterdir()):
                raise Problem("NOT_ISOLATED", "拒绝接入非空的既有目录；请指定新的测试目录。")
            self.private.mkdir(mode=0o700)
            marker.write_text(json.dumps({"kind": MARKER, "id": str(uuid.uuid4())}), encoding="utf-8")
        if self.private.is_symlink() or marker.is_symlink():
            raise Problem("UNSAFE_VAULT", "测试库状态目录不能是符号链接。")
        try:
            config = json.loads(marker.read_text(encoding="utf-8"))
            if config["kind"] != MARKER:
                raise ValueError()
            self.id = str(uuid.UUID(config["id"]))
        except (ValueError, KeyError, OSError):
            raise Problem("INVALID_VAULT", "测试库标识损坏；不会覆盖或重新初始化。") from None
        lock_path = self.private / "process.lock"
        if lock_path.is_symlink():
            raise Problem("UNSAFE_VAULT", "测试库进程锁不能是符号链接。")
        self._lockfile = open(lock_path, "a+b")
        self._lockfile.seek(0)
        if self._lockfile.read(1) == b"":
            self._lockfile.write(b"0")
            self._lockfile.flush()
        self._lockfile.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self._lockfile.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lockfile.close()
            raise Problem("VAULT_IN_USE", "该测试库已由另一进程打开。") from None
        db_path = self.private / "operations.sqlite"
        if db_path.is_symlink():
            self._lockfile.close()
            raise Problem("UNSAFE_VAULT", "状态数据库不能是符号链接。")
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS operations (
            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, path TEXT NOT NULL,
            before_hash TEXT, after_hash TEXT NOT NULL, payload BLOB,
            state TEXT NOT NULL, created TEXT NOT NULL, committed TEXT)""")
        self.db.commit()
        self.recover()

    def close(self) -> None:
        with self.lock:
            self.db.close()
            self._lockfile.close()

    def _path(self, relative: str, *, create_parents: bool = False) -> Path:
        validate_path(relative)
        current = self.root
        for index, part in enumerate(relative.split("/")):
            # Case-fold collisions are refused even on case-sensitive test hosts.
            if current.exists():
                for sibling in current.iterdir():
                    if sibling.name.casefold() == part.casefold() and sibling.name != part:
                        raise Problem("PATH_COLLISION", "存在仅大小写不同的同名路径。")
            current = current / part
            if current.is_symlink():
                raise Problem("UNSAFE_PATH", "不能通过符号链接读写文件。")
            if index < len(relative.split("/")) - 1:
                if create_parents:
                    current.mkdir(exist_ok=True)
                if current.exists() and not current.is_dir():
                    raise Problem("INVALID_PATH", "父路径不是目录。")
        if current.exists() and not stat.S_ISREG(current.stat().st_mode):
            raise Problem("UNSAFE_PATH", "目标不是普通文件。")
        return current

    def _bytes(self, path: Path) -> bytes | None:
        try:
            if path.stat().st_size > MAX_BYTES:
                raise Problem("FILE_TOO_LARGE", "原型单篇上限为 1 MiB。", 413)
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def _hash(self, path: Path) -> str | None:
        raw = self._bytes(path)
        return None if raw is None else digest(raw)

    @staticmethod
    def _sync_dir(directory: Path) -> None:
        if os.name != "nt":
            fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def _apply(self, row: sqlite3.Row) -> None:
        path = self._path(row["path"], create_parents=True)
        actual = self._hash(path)
        if actual == row["after_hash"]:
            return  # Content was written before the response/receipt was lost.
        if actual != row["before_hash"]:
            raise Problem("VERSION_CONFLICT", "文件已变化，保留双方；没有覆盖当前文件。")
        payload = row["payload"]
        if payload is None or digest(payload) != row["after_hash"]:
            raise Problem("RECOVERY_REQUIRED", "恢复材料不完整；停止写入。")
        fd, name = tempfile.mkstemp(prefix=".xuye-save-", dir=path.parent)
        temp = Path(name)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            # Best-effort external-change check; unrelated editors are NOT locked.
            if self._hash(path) != row["before_hash"]:
                raise Problem("VERSION_CONFLICT", "保存期间文件发生变化；没有覆盖。")
            if row["before_hash"] is None:
                # Atomic, no-clobber creation. Do not fall back to overwrite.
                try:
                    os.link(temp, path)
                except FileExistsError:
                    raise Problem("VERSION_CONFLICT", "同名文件已存在，没有覆盖。") from None
            else:
                os.replace(temp, path)
            self._sync_dir(path.parent)
            if self._hash(path) != row["after_hash"]:
                raise Problem("RECOVERY_REQUIRED", "落盘内容核对失败。")
        finally:
            temp.unlink(missing_ok=True)

    def _finish(self, opid: str) -> None:
        with self.db:
            self.db.execute("UPDATE operations SET state='committed', committed=?, payload=NULL WHERE id=?",
                            (now(), opid))

    def recover(self) -> None:
        with self.lock:
            with self.db:
                # No durable commit decision: leave the operation retryable, not successful.
                self.db.execute("UPDATE operations SET state='aborted' WHERE state='prepared'")
            for row in self.db.execute("SELECT * FROM operations WHERE state='applying'").fetchall():
                try:
                    self._apply(row)
                    self._finish(row["id"])
                except Problem as exc:
                    if exc.code == "VERSION_CONFLICT":
                        with self.db:
                            self.db.execute("UPDATE operations SET state='conflict' WHERE id=?", (row["id"],))
                except OSError:
                    pass  # Remains applying, and does not become a successful receipt.

    def lookup(self, opid: str) -> dict:
        validate_operation_id(opid)
        with self.lock:
            self.recover()
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (opid,)).fetchone()
            if row is None:
                return {"operation_id": opid, "state": "not_found"}
            result = {"operation_id": opid, "state": row["state"], "path": row["path"],
                      "sha256": row["after_hash"], "committed_at": row["committed"]}
            if row["state"] == "committed":
                result.update(local="saved", sync="off", agent="not_connected")
            return result

    def commit(self, *, operation_id: str, path: str, content: str,
               expected_sha256: str | None) -> dict:
        opid = validate_operation_id(operation_id)
        validate_path(path)
        if not isinstance(content, str):
            raise Problem("INVALID_CONTENT", "正文必须是 UTF-8 文字。", 400)
        try:
            payload = content.encode("utf-8")
        except UnicodeEncodeError:
            raise Problem("INVALID_CONTENT", "正文含无效 Unicode。", 400) from None
        if len(payload) > MAX_BYTES:
            raise Problem("FILE_TOO_LARGE", "原型单篇上限为 1 MiB。", 413)
        if expected_sha256 is not None and (not isinstance(expected_sha256, str)
                                           or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256)):
            raise Problem("INVALID_VERSION", "保存需要明确的原文件版本。", 400)
        fp = digest(json.dumps([path, expected_sha256, digest(payload)], separators=(",", ":")).encode())
        with self.lock:
            prior = self.db.execute("SELECT * FROM operations WHERE id=?", (opid,)).fetchone()
            if prior:
                if prior["fingerprint"] != fp:
                    raise Problem("IDEMPOTENCY_MISMATCH", "同一操作号不能用于不同修改。")
                if prior["state"] != "aborted":
                    result = self.lookup(opid)
                    if result["state"] != "committed":
                        raise Problem("RECOVERY_REQUIRED", "之前的保存需要恢复或核对；请保留输入。")
                    return result
            pending = self.db.execute("SELECT id FROM operations WHERE path=? AND state IN ('applying','conflict')",
                                      (path,)).fetchone()
            if pending:
                raise Problem("RECOVERY_REQUIRED", "该文件有尚未核对的保存，不能继续覆盖。")
            target = self._path(path)
            if self._hash(target) != expected_sha256:
                raise Problem("VERSION_CONFLICT", "文件版本已变化，或同名文件已存在；你的编辑仍保留。")
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO operations VALUES (?,?,?,?,?,?,'prepared',?,NULL)",
                                (opid, fp, path, expected_sha256, digest(payload), payload, now()))
            self.fault("prepared")
            with self.db:
                self.db.execute("UPDATE operations SET state='applying' WHERE id=?", (opid,))
            self.fault("applying")
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (opid,)).fetchone()
            self._apply(row)
            self.fault("written")
            self._finish(opid)
            self.fault("committed")
            return self.lookup(opid)

    def capture(self, opid: str, text: str) -> dict:
        validate_operation_id(opid)
        if not isinstance(text, str) or not text.strip():
            raise Problem("EMPTY_INPUT", "记录不能为空。", 400)
        # Stable path means request retries cannot create a second note.
        return self.commit(operation_id=opid, path=f"收集/{opid}.md", content=text, expected_sha256=None)

    def read(self, relative: str) -> dict:
        with self.lock:
            blocked = self.db.execute("SELECT id FROM operations WHERE path=? AND state IN ('applying','conflict')",
                                      (relative,)).fetchone()
            if blocked:
                raise Problem("RECOVERY_REQUIRED", "该文件的保存需要核对；不展示未确认版本。")
            path = self._path(relative)
            raw = self._bytes(path)
            if raw is None:
                raise Problem("NOT_FOUND", "文件不存在。", 404)
            try:
                text = raw.decode("utf-8")  # Preserve BOM and line endings.
            except UnicodeDecodeError:
                raise Problem("INVALID_UTF8", "此文件不是有效 UTF-8；原字节未修改。") from None
            return {"path": relative, "content": text, "sha256": digest(raw), "mtime": path.stat().st_mtime}

    def list_notes(self, query: str = "") -> dict:
        with self.lock:
            results, unavailable = [], []
            def scan_error(error):
                unavailable.append({"path": str(Path(error.filename).relative_to(self.root)), "code": "SCAN_FAILED"})
            for directory, dirs, files in os.walk(self.root, followlinks=False, onerror=scan_error):
                dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (Path(directory) / d).is_symlink())
                for name in sorted(files):
                    if name.startswith(".") or not name.lower().endswith(".md"):
                        continue
                    relative = (Path(directory) / name).relative_to(self.root).as_posix()
                    try:
                        note = self.read(relative)
                    except (Problem, OSError) as exc:
                        unavailable.append({"path": relative, "code": getattr(exc, "code", "READ_FAILED")})
                        continue
                    if query.casefold() not in (relative + "\n" + note["content"]).casefold():
                        continue
                    text = note.pop("content")
                    note["excerpt"] = text[:240]
                    note["capture"] = relative.startswith("收集/")
                    note["title"] = (text.lstrip("\ufeff").splitlines() or ["空白记录"])[0][:60] if note["capture"] else Path(relative).stem
                    results.append(note)
            return {"notes": sorted(results, key=lambda n: (-n["mtime"], n["path"])), "unavailable": unavailable}
