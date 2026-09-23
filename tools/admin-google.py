#!/usr/bin/env python3
# =====================================================================
#  知上会 — 管理画面の「Google でログイン」を設定する
#
#  Google Cloud で作った OAuth クライアント ID と、中継（worker/ の Cloudflare Worker）の URL を、
#  必要な3か所にまとめて書き込む。手で直すと食い違いやすいので、このスクリプトを使う。
#
#    admin/admin.js      … CONFIG.googleClientId / CONFIG.relay
#    admin/index.html    … Content-Security-Policy の connect-src（中継に送ってよい先）
#    worker/wrangler.jsonc … GOOGLE_CLIENT_ID（中継が「このアプリ宛てのログインか」を確かめる値）
#
#    python3 tools/admin-google.py --client-id 1234-abcd.apps.googleusercontent.com \
#                                  --relay https://chijoukai-admin.xxxx.workers.dev
#    python3 tools/admin-google.py --off        Google のログインを止めて、合言葉だけに戻す
#
#  書き込んだあと、worker/ で `npx wrangler deploy`（GOOGLE_CLIENT_ID を中継に反映）し、
#  サイトを push する。手順の全体は worker/README.md を参照。
# =====================================================================
import argparse
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN_JS = os.path.join(ROOT, "admin", "admin.js")
ADMIN_HTML = os.path.join(ROOT, "admin", "index.html")
WRANGLER = os.path.join(ROOT, "worker", "wrangler.jsonc")

CLIENT_ID_RE = re.compile(r"^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$")


def die(msg):
    print(f"\n  ✖ {msg}\n", file=sys.stderr)
    sys.exit(2)


def origin_of(url):
    u = urllib.parse.urlsplit(url)
    if not u.scheme or not u.netloc:
        return ""
    return f"{u.scheme}://{u.netloc}"


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def sub_once(pattern, repl, s, what):
    out, n = re.subn(pattern, repl, s, count=1)
    if n != 1:
        die(f"{what} が見つかりません（ファイルの形が変わっていないか確かめてください）")
    return out


def main():
    ap = argparse.ArgumentParser(description="管理画面の「Google でログイン」を設定する")
    ap.add_argument("--client-id", help="Google の OAuth クライアント ID（…apps.googleusercontent.com）")
    ap.add_argument("--relay", help="中継（Cloudflare Worker）の URL（https://…workers.dev）")
    ap.add_argument("--off", action="store_true", help="Google のログインを止める（合言葉だけに戻す）")
    a = ap.parse_args()

    if a.off:
        client_id, relay = "", ""
    else:
        if not a.client_id or not a.relay:
            die("--client-id と --relay の両方を指定してください（止めるときは --off）")
        client_id = a.client_id.strip()
        relay = a.relay.strip().rstrip("/")
        if not CLIENT_ID_RE.match(client_id):
            die(f"クライアント ID の形式が違います: {client_id!r}（数字-英数字.apps.googleusercontent.com）")
        u = urllib.parse.urlsplit(relay)
        local = u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")
        if not (u.scheme == "https" or local) or not u.netloc or u.query or u.fragment or u.path not in ("", "/"):
            die(f"中継の URL は https://〜 の形で、後ろに何も付けずに指定してください: {relay!r}")
        if re.search(r"[\s;'\"]", relay):
            die("中継の URL に使えない文字が入っています")

    js = read(ADMIN_JS)
    m = re.search(r'\n    relay: "([^"]*)",', js)
    old_relay = m.group(1) if m else ""
    js = sub_once(r'\n    googleClientId: "[^"]*",', f'\n    googleClientId: "{client_id}",', js, "admin.js の googleClientId")
    js = sub_once(r'\n    relay: "[^"]*",', f'\n    relay: "{relay}",', js, "admin.js の relay")

    html = read(ADMIN_HTML)
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="[^"]*?\bconnect-src ([^;"]*)', html)
    if not m:
        die("admin/index.html の CSP に connect-src が見つかりません")
    srcs = [x for x in m.group(1).split() if x and x != origin_of(old_relay)]
    if relay:
        srcs.append(origin_of(relay))
    html = html[:m.start(1)] + " ".join(srcs) + html[m.end(1):]

    wr = read(WRANGLER)
    wr = sub_once(r'"GOOGLE_CLIENT_ID": "[^"]*"', f'"GOOGLE_CLIENT_ID": "{client_id}"', wr, "wrangler.jsonc の GOOGLE_CLIENT_ID")

    write(ADMIN_JS, js)
    write(ADMIN_HTML, html)
    write(WRANGLER, wr)
    subprocess.run(["bash", os.path.join(ROOT, "tools", "stamp-assets.sh")], check=True, cwd=ROOT)

    if relay:
        print(f"\n  ✔ Google でログインを設定しました\n"
              f"      クライアント ID : {client_id}\n"
              f"      中継            : {relay}\n"
              f"    次に: cd worker && npx wrangler deploy  → サイトを push\n")
    else:
        print("\n  ✔ Google でログインを止めました（合言葉でのログインだけになります）\n")


if __name__ == "__main__":
    main()
