"""Read only managed experiment files; preserve immutable result evidence."""

import base64
import codecs
import fcntl
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.common.storage import contained_path
from batteryland.db.contracts import Record
from batteryland.training.materializer import publish_file


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def file_identity(path: Path) -> str:
    info = path.stat()
    return f"{info.st_dev}:{info.st_ino}"


def checkpoint(path: Path, offset: int) -> str:
    with path.open("rb") as stream:
        stream.seek(max(0, offset - 1024))
        return digest(stream.read(min(1024, offset)))


class LocalResultFiles:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self._hashes: dict[str, tuple[tuple[int, int, int, int], str]] = {}

    def scan(self, directory: str, terminal: bool) -> list[Record]:
        base = contained_path(self.root, directory)
        if not base.is_dir():
            return []
        result = []
        for path in sorted(base.rglob("*")):
            # No symlinks, including links into another managed experiment.
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
                continue
            if path.name.endswith(".tmp"):
                continue
            kinds = {
                "metrics.jsonl": "metrics",
                "best_result.json": "result",
                "train.log": "log",
                "console.log": "log",
                "config.yaml": "config",
                "status.json": "status",
                "manifest.json": "input_manifest",
                "provider-input.yaml": "config",
                "prepare-receipt.json": "execution_receipt",
                "process-receipt.json": "execution_receipt",
            }
            kind = kinds.get(
                path.name, "checkpoint" if "checkpoint" in str(path.relative_to(base)) else "file"
            )
            size = path.stat().st_size
            checksum = None
            if terminal or kind in {"result", "config"}:
                info = path.stat()
                stamp = (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_size)
                cached = self._hashes.get(str(path))
                if cached and cached[0] == stamp:
                    checksum = cached[1]
                else:
                    hasher = hashlib.sha256()
                    with path.open("rb") as stream:
                        while chunk := stream.read(1024 * 1024):
                            hasher.update(chunk)
                    checksum = hasher.hexdigest()
                    self._hashes[str(path)] = (stamp, checksum)
            if path.parent != base and kind in {"result", "metrics"}:
                kind = "file"
            result.append(
                {
                    "id": str(uuid4()),
                    "origin": "execution",
                    "kind": kind,
                    "name": path.name,
                    "relative_key": str(path.relative_to(self.root)),
                    "sha256": checksum,
                    "size": size,
                    "availability": "available",
                    "is_directory": False,
                }
            )
        return result

    def read_result(self, key: str) -> bytes:
        path = contained_path(self.root, key)
        with path.open("rb") as stream:
            content = stream.read(16 * 1024 * 1024 + 1)
        if len(content) > 16 * 1024 * 1024:
            raise DomainError("invalid_input", "Result exceeds the 16 MiB import limit")
        return content

    def archive(self, identity: str, content: bytes) -> Record:
        checksum = digest(content)
        key = f"archives/{identity}/{checksum}.json"
        publish_file(contained_path(self.root, key), content)
        return {
            "id": str(uuid4()),
            "origin": "result_archive",
            "kind": "result",
            "name": "best_result.json",
            "relative_key": key,
            "sha256": checksum,
            "size": len(content),
            "availability": "available",
            "is_directory": False,
        }

    def append_report(self, identity: str, stream: str, offset: int, content: bytes) -> Record:
        if stream not in {"console", "train", "metrics"} or offset < 0 or len(content) > 256 * 1024:
            raise DomainError("invalid_input", "Invalid report stream, offset or chunk size")
        filename = "metrics.jsonl" if stream == "metrics" else f"{stream}.log"
        key = f"worker-output/{identity}/{filename}"
        path = contained_path(self.root, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+b") as output:
            fcntl.flock(output, fcntl.LOCK_EX)
            output.seek(0, os.SEEK_END)
            size = output.tell()
            if offset < size:
                overlap_size = min(size - offset, len(content))
                output.seek(offset)
                if output.read(overlap_size) != content[:overlap_size]:
                    raise DomainError("conflict", "Report chunk conflicts with stored bytes")
                content = content[overlap_size:]
            elif offset > size:
                raise DomainError("conflict", "Report chunk is out of order")
            if content:
                output.seek(0, os.SEEK_END)
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            output.seek(0, os.SEEK_END)
            return {"offset": output.tell(), "relative_key": key}

    def metrics_batch(self, key: str, cursor: Record | None) -> Record:
        path = contained_path(self.root, key)
        identity = file_identity(path)
        reset = cursor is None or cursor["file_identity"] != identity
        offset = cursor["byte_offset"] if cursor else 0
        if cursor and (
            path.stat().st_size < offset or checkpoint(path, offset) != cursor["source_hash"]
        ):
            reset = True
        generation = (cursor["generation"] + int(reset)) if cursor else 1
        if reset:
            offset = 0
        with path.open("rb") as stream:
            stream.seek(offset)
            content = stream.read(4 * 1024 * 1024)
        end = content.rfind(b"\n") + 1
        if not end and len(content) == 4 * 1024 * 1024:
            raise DomainError("invalid_input", "A metrics record exceeds the 4 MiB limit")
        return {
            "content": content[:end],
            "start_offset": offset,
            "reset": reset,
            "cursor": {
                "file_identity": identity,
                "generation": generation,
                "byte_offset": offset + end,
                "source_hash": checkpoint(path, offset + end),
            },
        }

    def log_chunk(
        self, identity: str, directory: str | None, stream: str, cursor: str | None, limit: int
    ) -> Record:
        if stream not in {"train", "console"}:
            raise DomainError("invalid_input", "Unknown log stream")
        path = contained_path(self.root, f"{directory}/{stream}.log") if directory else None
        exists = path is not None and path.is_file()
        source = file_identity(path) if exists and path else None
        offset = 0
        if cursor:
            try:
                value = json.loads(base64.urlsafe_b64decode(cursor.encode()))
                offset = value["offset"]
                if (
                    value["v"] != 1
                    or value["experiment"] != identity
                    or value["stream"] != stream
                    or value["source"] not in (None, source)
                    or not isinstance(offset, int)
                    or offset < 0
                    or (value["source"] is None and offset != 0)
                    or (
                        value["source"] is not None
                        and (
                            not path
                            or not exists
                            or path.stat().st_size < offset
                            or checkpoint(path, offset) != value["hash"]
                        )
                    )
                ):
                    raise ValueError("Cursor source changed")
            except (ValueError, TypeError, KeyError, UnicodeError, AttributeError) as exc:
                raise DomainError(
                    "cursor_invalid", "Log cursor is invalid or its file changed"
                ) from exc
        content = b""
        if exists and path:
            with path.open("rb") as handle:
                handle.seek(offset)
                content = handle.read(max(limit, 4))
            # Preserve a partial trailing UTF-8 character for the next read.
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            text = decoder.decode(content, final=False)
            pending, _ = decoder.getstate()
            if pending:
                content = content[: -len(pending)]
        else:
            text = ""
        offset += len(content)
        token = {
            "v": 1,
            "experiment": identity,
            "stream": stream,
            "source": source,
            "offset": offset,
            "hash": checkpoint(path, offset) if exists and path else None,
        }
        return {
            "stream": stream,
            "text": text,
            "next_cursor": base64.urlsafe_b64encode(json.dumps(token).encode()).decode(),
            "exhausted": not exists or bool(path and offset >= path.stat().st_size),
        }
