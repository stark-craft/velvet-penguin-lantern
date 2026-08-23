import asyncio
import json


class AsgiResponse:
    def __init__(self, status, headers, body):
        self.status_code = status
        self.headers = headers
        self.content = body
        self.text = body.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self.content or b"{}")


def request(app, method, path, *, headers=None, json_body=None, body=None, client_ip="10.0.0.25"):
    async def run():
        payload = b"" if json_body is None else json.dumps(json_body).encode("utf-8")
        if body is not None:
            # Raw request bodies (e.g. multipart uploads) take precedence.
            payload = body
        raw_headers = {
            str(key).lower(): str(value)
            for key, value in (headers or {}).items()
        }
        if json_body is not None:
            raw_headers.setdefault("content-type", "application/json")
        sent = []
        received = False

        async def receive():
            nonlocal received
            if not received:
                received = True
                return {"type": "http.request", "body": payload, "more_body": False}
            await asyncio.sleep(0)
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method.upper(),
                "scheme": "http",
                "path": path,
                "raw_path": path.encode("utf-8"),
                "query_string": b"",
                "root_path": "",
                "headers": [
                    (key.encode("latin-1"), value.encode("latin-1"))
                    for key, value in raw_headers.items()
                ],
                "client": (client_ip, 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
        start = next(message for message in sent if message["type"] == "http.response.start")
        response_headers = {}
        for key, value in start.get("headers", []):
            decoded_key = key.decode("latin-1").lower()
            decoded_value = value.decode("latin-1")
            if decoded_key in response_headers:
                response_headers[decoded_key] += ", " + decoded_value
            else:
                response_headers[decoded_key] = decoded_value
        response_body = b"".join(
            message.get("body", b"")
            for message in sent
            if message["type"] == "http.response.body"
        )
        return AsgiResponse(start["status"], response_headers, response_body)

    return asyncio.run(run())
