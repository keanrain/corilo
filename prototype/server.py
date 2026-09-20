"""Loopback-only development host; no cloud, AI, bot, or runtime dependencies."""
from __future__ import annotations

import argparse
import hmac
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .store import MAX_BYTES, Problem, Vault

WEB = Path(__file__).with_name("web")


def make_server(vault: Vault, port: int = 8765) -> ThreadingHTTPServer:
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not log user note paths, content or session credentials.

        def reply(self, status: int, data: bytes, mime: str = "application/json; charset=utf-8") -> None:
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            self.end_headers()
            self.wfile.write(data)

        def json_reply(self, status: int, value: dict) -> None:
            self.reply(status, json.dumps(value, ensure_ascii=False).encode("utf-8"))

        def guard(self, api: bool = False) -> None:
            port_now = self.server.server_address[1]
            hosts = {f"127.0.0.1:{port_now}", f"localhost:{port_now}"}
            if self.headers.get("Host") not in hosts:
                raise Problem("BAD_HOST", "仅允许本机访问。", 403)
            origin = self.headers.get("Origin")
            if origin and origin not in {f"http://{host}" for host in hosts}:
                raise Problem("BAD_ORIGIN", "拒绝其他网站调用本机服务。", 403)
            if api and not hmac.compare_digest(self.headers.get("X-Xuye-Session", ""), token):
                raise Problem("BAD_SESSION", "会话已失效，请刷新页面后重试；编辑请先复制。", 403)

        def body(self) -> dict:
            if self.headers.get("Transfer-Encoding"):
                raise Problem("BAD_REQUEST", "不支持分块请求。", 400)
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise Problem("BAD_TYPE", "仅接受 JSON。", 415)
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                raise Problem("BAD_REQUEST", "长度无效。", 400) from None
            if not 0 <= size <= MAX_BYTES * 6 + 4096:
                raise Problem("BODY_TOO_LARGE", "请求过大。", 413)
            try:
                value = json.loads(self.rfile.read(size))
                if not isinstance(value, dict):
                    raise ValueError()
                return value
            except (ValueError, UnicodeDecodeError):
                raise Problem("BAD_JSON", "JSON 格式无效。", 400) from None

        def run_request(self, write: bool = False) -> None:
            try:
                route = urlsplit(self.path)
                self.guard(route.path.startswith("/api/"))
                if write:
                    value = self.body()
                    if route.path == "/api/captures":
                        result = vault.capture(value.get("operation_id"), value.get("text"))
                    elif route.path == "/api/commit":
                        required = {"operation_id", "path", "content", "expected_sha256"}
                        if set(value) != required:
                            raise Problem("BAD_COMMAND", "保存命令字段不完整或包含未知字段。", 400)
                        result = vault.commit(**value)
                    else:
                        raise Problem("NOT_FOUND", "接口不存在。", 404)
                    self.json_reply(200, result)
                    return
                query = parse_qs(route.query)
                if route.path == "/api/info":
                    self.json_reply(200, {"vault_id": vault.id, "root": str(vault.root),
                                          "mode": "isolated-local-prototype", "ai": False, "sync": False})
                elif route.path == "/api/notes":
                    self.json_reply(200, vault.list_notes(query.get("q", [""])[0]))
                elif route.path == "/api/note":
                    self.json_reply(200, vault.read(query.get("path", [""])[0]))
                elif route.path.startswith("/api/operations/"):
                    self.json_reply(200, vault.lookup(route.path.removeprefix("/api/operations/")))
                elif route.path in ("/", "/index.html"):
                    html = (WEB / "index.html").read_bytes().replace(b"__SESSION__", token.encode())
                    self.reply(200, html, "text/html; charset=utf-8")
                elif route.path in ("/app.js", "/app.css"):
                    mime = "text/javascript" if route.path.endswith(".js") else "text/css"
                    self.reply(200, (WEB / route.path[1:]).read_bytes(), mime + "; charset=utf-8")
                else:
                    raise Problem("NOT_FOUND", "资源不存在。", 404)
            except Problem as exc:
                self.json_reply(exc.status, {"error": {"code": exc.code, "message": str(exc)}})
            except Exception:
                # Unexpected write failures may follow a durable write: never report a rollback.
                self.json_reply(500, {"error": {"code": "RESULT_UNKNOWN" if write else "READ_FAILED",
                                                "message": "操作未确认，请保留输入并核对结果。"}})

        def do_GET(self):
            self.run_request()

        def do_POST(self):
            self.run_request(True)

        def do_OPTIONS(self):
            self.json_reply(403, {"error": {"code": "CROSS_ORIGIN_DENIED"}})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="续页：仅供测试资料使用的本地原型")
    parser.add_argument("--vault", type=Path, default=Path(".local/xuye-prototype"))
    parser.add_argument("--init", action="store_true", help="只在新建或空目录初始化；绝不接入非空旧库")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("端口应在 0–65535")
    try:
        vault = Vault(args.vault, initialize=args.init)
        server = make_server(vault, args.port)
    except (Problem, OSError) as exc:
        parser.exit(1, f"未启动：{exc}\n")
    print(f"续页本地原型：http://127.0.0.1:{server.server_address[1]}", flush=True)
    print(f"真实 Markdown 测试目录：{vault.root}", flush=True)
    print("仅本机；AI / 同步 / 通知未接入。Ctrl+C 停止，文件不会删除。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        vault.close()


if __name__ == "__main__":
    main()
