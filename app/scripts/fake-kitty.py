#!/usr/bin/env python3
"""A fake kitty terminal for testing t3-term's terminal mode without a GUI.

Runs a command in a pty with a pixel size, answers the queries gpui_terminal
sends (DA1, 1016 pixel-mouse mode, the shared-memory probe, inline frame
fences), refuses shared memory so frames arrive inline (the path SSH uses),
decodes each frame to RGBA and writes PNGs on request. Steps drive input with
SGR pixel mouse reports and kitty keyboard protocol keys.

  python3 fake-kitty.py <out-dir> <steps.json> -- <command...>

steps: {"wait": ms} {"shot": name} {"click": [x, y]} {"move": [x, y]}
       {"wheel": [x, y, dy]} {"type": "text"} {"key": "enter"|"escape"|"tab"|"up"|...,
       "mods": ["ctrl","shift","alt","super"]} {"resize": [cols, rows, w, h]} {"quit": true}
Coordinates are terminal pixels (the frame's pixel space).
"""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
import zlib

COLS, ROWS, WIDTH, HEIGHT = 180, 50, 1440, 900

KEYS = {
    "enter": 13, "escape": 27, "tab": 9, "backspace": 127, "space": 32,
    "left": 57417, "right": 57418, "up": 57419, "down": 57420,
    "pageup": 57421, "pagedown": 57422, "home": 57423, "end": 57424, "delete": 57426,
}
MODS = {"shift": 1, "alt": 2, "ctrl": 4, "super": 8}


def write_png(path, width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))


class FakeKitty:
    def __init__(self, out_dir, argv):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.buf = b""
        self.frame = None  # (w, h, rgba)
        self.frames = 0
        self.pending = None  # [w, h, chunks]
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-kitty"
            os.environ["GPUIX_TERMINAL"] = "1"
            os.execvp(argv[0], argv)
        self.pid, self.fd = pid, fd
        self.set_size(COLS, ROWS, WIDTH, HEIGHT)

    def set_size(self, cols, rows, width, height):
        self.size = (cols, rows, width, height)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, width, height))
        try:
            os.kill(self.pid, signal.SIGWINCH)
        except ProcessLookupError:
            pass

    def send(self, data):
        os.write(self.fd, data)

    def pump(self, seconds):
        deadline = time.time() + seconds
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            ready, _, _ = select.select([self.fd], [], [], min(remaining, 0.05))
            if not ready:
                continue
            try:
                data = os.read(self.fd, 1 << 20)
            except OSError:
                return
            if not data:
                return
            self.buf += data
            self.parse()

    def parse(self):
        while True:
            esc = self.buf.find(b"\x1b")
            if esc < 0:
                self.buf = b""
                return
            self.buf = self.buf[esc:]
            if self.buf.startswith(b"\x1b_G"):
                end = self.buf.find(b"\x1b\\")
                if end < 0:
                    return
                self.on_apc(self.buf[3:end])
                self.buf = self.buf[end + 2:]
                continue
            m = re.match(rb"\x1b\[([0-9;?<>=$]*)([A-Za-z@`~])", self.buf)
            if m is None:
                if len(self.buf) < 64:
                    return
                self.buf = self.buf[1:]
                continue
            params, final = m.group(1), m.group(2)
            self.buf = self.buf[m.end():]
            if final == b"c" and params in (b"", b"0"):
                self.send(b"\x1b[?62;22c")
            elif final == b"p" and params == b"?1016$":
                self.send(b"\x1b[?1016;1$y")
            elif final == b"h" and b"2048" in params:
                cols, rows, w, h = self.size
                self.send(f"\x1b[48;{rows};{cols};{h};{w}t".encode())

    def on_apc(self, body):
        head, _, payload = body.partition(b";")
        keys = dict(kv.split(b"=", 1) for kv in head.split(b",") if b"=" in kv)
        action = keys.get(b"a")
        if action == b"q":
            image_id = keys.get(b"i", b"0").decode()
            if keys.get(b"t") == b"s":
                # Refuse shared memory: frames then arrive inline, as over SSH.
                self.send(f"\x1b_Gi={image_id};ENOENT:fake-kitty refuses shm\x1b\\".encode())
            else:
                self.send(f"\x1b_Gi={image_id};OK\x1b\\".encode())
            return
        if action == b"T" and keys.get(b"t") == b"d":
            self.pending = [int(keys[b"s"]), int(keys[b"v"]), [payload]]
            if keys.get(b"m", b"0") == b"0":
                self.finish_frame()
            return
        if action is None and self.pending is not None:
            self.pending[2].append(payload)
            if keys.get(b"m", b"0") == b"0":
                self.finish_frame()

    def finish_frame(self):
        import base64

        w, h, chunks = self.pending
        self.pending = None
        rgba = zlib.decompress(base64.b64decode(b"".join(chunks)))
        if len(rgba) == w * h * 4:
            self.frame = (w, h, rgba)
            self.frames += 1

    def shot(self, name):
        if self.frame is None:
            print(f"no frame yet for {name}", flush=True)
            return
        w, h, rgba = self.frame
        path = os.path.join(self.out_dir, f"{name}.png")
        write_png(path, w, h, rgba)
        print(f"shot {path} {w}x{h} after {self.frames} frames", flush=True)

    def mouse(self, button, x, y, press):
        self.send(f"\x1b[<{button};{int(x)};{int(y)}{'M' if press else 'm'}".encode())

    def key(self, code, mods=(), text=None):
        mask = 1 + sum(MODS[m] for m in mods)
        field = f"{code};{mask}" if mask != 1 or text else f"{code}"
        if text:
            field += ";" + ":".join(str(ord(c)) for c in text)
        self.send(f"\x1b[{field}u".encode())
        self.send(f"\x1b[{code};{mask}:3u".encode())

    def run(self, steps):
        self.pump(0.5)
        for step in steps:
            if "wait" in step:
                self.pump(step["wait"] / 1000)
            if "shot" in step:
                self.pump(0.3)
                self.shot(step["shot"])
            if "move" in step:
                self.mouse(35, *step["move"], True)
            if "click" in step:
                x, y = step["click"]
                self.mouse(35, x, y, True)
                self.pump(0.05)
                self.mouse(0, x, y, True)
                self.pump(0.05)
                self.mouse(0, x, y, False)
            if "wheel" in step:
                x, y, dy = step["wheel"]
                for _ in range(abs(dy)):
                    self.mouse(65 if dy > 0 else 64, x, y, True)
            if "type" in step:
                for ch in step["type"]:
                    self.key(ord(ch.lower()) if ch.isalpha() else ord(ch), ["shift"] if ch.isupper() else [], ch)
                    self.pump(0.01)
            if "key" in step:
                name = step["key"]
                self.key(KEYS.get(name, ord(name[0])), step.get("mods", []))
            if "resize" in step:
                self.set_size(*step["resize"])
            if step.get("quit"):
                self.key(ord("c"), ["ctrl"])
                self.pump(1.0)
            self.pump(0.2)


def main():
    if "--" not in sys.argv:
        print(__doc__)
        sys.exit(2)
    split = sys.argv.index("--")
    out_dir, steps_path = sys.argv[1:split][:2]
    with open(steps_path) as f:
        steps = json.load(f)
    kitty = FakeKitty(out_dir, sys.argv[split + 1:])
    try:
        kitty.run(steps)
    finally:
        try:
            os.kill(kitty.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    print(f"frames received: {kitty.frames}", flush=True)


if __name__ == "__main__":
    main()
