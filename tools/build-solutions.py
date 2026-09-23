#!/usr/bin/env python3
# =====================================================================
#  知上会 — 「法人の方へ」の案件一覧を書き出す
#
#  案件の中身は data/solutions.json にだけ持つ（管理画面 admin/ が書き換える）。
#  このスクリプトはそれを読んで、次の場所を作り直す。
#
#    solutions.html … <!-- solutions:start --> 〜 <!-- solutions:end --> のあいだ
#    index.html     … data-sol-count の付いた数字（公開中の案件数）
#    assets/img/    … 案件画像の WebP（JPEG から作る。cwebp があるときだけ）
#
#  そのあと tools/typeset.py と同じ規則で、見出しの文節（<wbr>）と
#  改行させない継ぎ目を入れ直す。
#
#    python3 tools/build-solutions.py            書き出す
#    python3 tools/build-solutions.py --check    差分があれば終了コード1（書き換えない）
#    python3 tools/build-solutions.py --import   いまの solutions.html から JSON を作る（初回のみ）
#
#  GitHub Actions（.github/workflows/deploy.yml）が push のたびに実行するので、
#  管理画面から保存すれば 1〜2 分でサイトに反映される。
#  JSON の書式は data/solutions.json の先頭の "schema" と、下の validate() を参照。
# =====================================================================
import hashlib
import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "solutions.json")
PAGE = os.path.join(ROOT, "solutions.html")
INDEX = os.path.join(ROOT, "index.html")
IMG = os.path.join(ROOT, "assets", "img")

START = "<!-- solutions:start"
END = "<!-- solutions:end -->"
MARK_NOTE = ("（ここから下は tools/build-solutions.py が data/solutions.json から"
             "自動で書き出します。直接編集せず、管理画面か JSON を直してください）")

TAG_CLASS = {"": "tag", "gold": "tag tag--gold", "coral": "tag tag--coral"}
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
ADMIN_IMAGE_RE = re.compile(r"^sol-[a-z][a-z0-9-]{0,39}-\d{8}-\d{6}\.jpg$")   # 管理画面が作る画像名
IMAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(jpg|jpeg|png)$")
WEBP_MAX_WIDTH = 800           # 案件カードの写真帯（表示幅 約370px の2倍強）
LIMITS = {"title": 60, "label": 40, "alt": 160, "body": 1200, "topic": 60, "tag": 24, "tags": 6}
FIELD_NAMES = {"title": "案件名", "label": "英字の小見出し", "alt": "画像の説明", "body": "説明文",
               "topic": "お問い合わせに引き継ぐ名前", "image": "画像"}


def die(msg, code=2):
    print(f"\n  ✖ {msg}\n", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------
#  画像の縦横（Pillow なしで読む）
# ---------------------------------------------------------------------
def image_size(path):
    with open(path, "rb") as f:
        head = f.read(26)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", head[16:24])
            return w, h
        if head[:2] != b"\xff\xd8":
            return None
        f.seek(2)
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            marker = b[0]
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                continue
            seg_len = struct.unpack(">H", f.read(2))[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                f.read(1)
                h, w = struct.unpack(">HH", f.read(4))
                return w, h
            f.seek(seg_len - 2, 1)


# ---------------------------------------------------------------------
#  JSON の読み込みと点検
# ---------------------------------------------------------------------
def load():
    if not os.path.exists(DATA):
        die("data/solutions.json がありません。初回は --import で作ってください。")
    raw = open(DATA, "rb").read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        die(f"data/solutions.json を読めません（JSON の書式が壊れています）: {e}")
    return data, raw


def clean(s):
    """前後の空白を落とし、見えない継ぎ目（typeset が入れ直す）を取り除く"""
    return re.sub(r"[⁠​]", "", str(s or "")).strip()


def page_ids():
    """自動生成部分の外で、ページがすでに使っている id（案件の id と重ねない）"""
    try:
        src = open(PAGE, encoding="utf-8").read()
    except OSError:
        return set()
    i, j = src.find(START), src.find(END)
    outside = src[:i] + src[j:] if i >= 0 and j > i else src
    return {x.lower() for x in re.findall(r'\bid="([^"]+)"', outside)}


def validate(data):
    errors = []
    reserved = page_ids()
    items = data.get("items")
    if not isinstance(items, list):
        die('data/solutions.json に "items"（案件の配列）がありません。')
    seen = set()
    for n, it in enumerate(items, 1):
        where = f"{n}件目（{clean(it.get('title')) or '名前なし'}）"
        if not isinstance(it, dict):
            errors.append(f"{n}件目: 形式が正しくありません")
            continue
        iid = clean(it.get("id"))
        if not ID_RE.match(iid):
            errors.append(f"{where}: ページ内リンク名（id）は半角の小文字・数字・ハイフンで、先頭は英字にしてください: {iid!r}")
        elif iid in seen:
            errors.append(f"{where}: ページ内リンク名（id）「{iid}」が重複しています")
        elif iid in reserved:
            errors.append(f"{where}: ページ内リンク名（id）「{iid}」はページのほかの場所で使っています")
        seen.add(iid)
        visible = it.get("visible", True) is not False
        for key in ("title", "body", "image", "alt"):
            if visible and not clean(it.get(key)):
                errors.append(f"{where}: 「{FIELD_NAMES[key]}」が空です")
        for key in ("title", "label", "alt", "body", "topic"):
            if len(clean(it.get(key))) > LIMITS[key]:
                errors.append(f"{where}: 「{FIELD_NAMES[key]}」が長すぎます（{LIMITS[key]}字まで）")
        img = clean(it.get("image"))
        if img:
            if not IMAGE_RE.match(img):
                errors.append(f"{where}: 画像のファイル名が不正です: {img!r}")
            elif not os.path.exists(os.path.join(IMG, img)):
                errors.append(f"{where}: 画像 assets/img/{img} が見つかりません")
        tags = it.get("tags") or []
        if not isinstance(tags, list) or len(tags) > LIMITS["tags"]:
            errors.append(f"{where}: タグは{LIMITS['tags']}個までです")
            continue
        for t in tags:
            t = t if isinstance(t, dict) else {"text": t}
            if len(clean(t.get("text"))) > LIMITS["tag"]:
                errors.append(f"{where}: タグ「{clean(t.get('text'))}」が長すぎます（{LIMITS['tag']}字まで）")
            if (t.get("color") or "") not in TAG_CLASS:
                errors.append(f"{where}: タグの色は gold / coral / 空欄 のどれかです")
    if errors:
        die("data/solutions.json に直すところがあります:\n    - " + "\n    - ".join(errors))


# ---------------------------------------------------------------------
#  書き出し
# ---------------------------------------------------------------------
def esc(s):
    return html.escape(clean(s), quote=True)


def title_html(title):
    # 「ISS-4 ｜ 空調の省エネ」の区切り線はそのまま。文節の <wbr> は typeset が入れる
    return esc(title)


def paragraphs(body):
    parts = [re.sub(r"\s*\n\s*", "", p) for p in re.split(r"\n\s*\n", clean(body))]
    return "".join(f"<p>{html.escape(p, quote=True)}</p>" for p in parts if p)


DRY_RUN = False   # --check のときは何も書かない


def ensure_webp(name):
    """JPEG / PNG から WebP を作る。使える WebP があるときだけ True

    手元では更新日時を比べて、JPEG の方が新しければ作り直す。
    CI（チェックアウト直後）は更新日時があてにならず、cwebp の版も手元と違うため、
    毎回作り直すと中身が変わらなくても差分が出てしまう。WebP が無いときだけ作る。
    （管理画面は画像に毎回新しい名前を付けるので、CI で差し替えを見逃すことはない。
      同じ名前で画像を差し替えたときは、手元でこのスクリプトを実行してから push する）
    """
    src = os.path.join(IMG, name)
    out = os.path.join(IMG, os.path.splitext(name)[0] + ".webp")
    if os.environ.get("CI"):
        fresh = os.path.exists(out)
    else:
        fresh = os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src)
    if DRY_RUN or fresh:
        return os.path.exists(out)
    cwebp = shutil.which("cwebp")
    if not cwebp:
        return os.path.exists(out)
    size = image_size(src) or (0, 0)
    cmd = [cwebp, "-quiet", "-q", "78", "-m", "6", "-sharp_yuv"]
    if size[0] > WEBP_MAX_WIDTH:
        cmd += ["-resize", str(WEBP_MAX_WIDTH), "0"]
    cmd += [src, "-o", out]
    try:
        subprocess.run(cmd, check=True)
        print(f"  WebP を作成: assets/img/{os.path.basename(out)}")
        return True
    except subprocess.CalledProcessError:
        print(f"  ⚠ WebP を作れませんでした: {name}（JPEG のまま配信します）")
        return os.path.exists(out)


def card(it, n):
    iid = clean(it["id"])
    img = clean(it["image"])
    w, h = image_size(os.path.join(IMG, img)) or (it.get("width") or 800, it.get("height") or 450)
    base = os.path.splitext(img)[0]
    source = (f'<source srcset="assets/img/{base}.webp" type="image/webp">'
              if ensure_webp(img) else "")
    delay = ' data-reveal-delay="1"' if n % 2 else ""
    title = clean(it["title"])
    label = clean(it.get("label"))
    topic = clean(it.get("topic")) or re.sub(r"\s*[｜|]\s*(.+)$", r"（\1）", title)
    aria = re.sub(r"\s*[｜|]\s*", " ", title)
    tags = "".join(
        f'<span class="{TAG_CLASS[(t.get("color") or "") if isinstance(t, dict) else ""]}">'
        f'{esc(t.get("text") if isinstance(t, dict) else t)}</span>'
        for t in (it.get("tags") or []) if clean(t.get("text") if isinstance(t, dict) else t))
    small = f'<small lang="en">{esc(label)}</small>' if label else ""
    href = "contact.html?topic=" + urllib.parse.quote(topic, safe="")
    return f"""
      <!-- {html.escape(title).replace("--", "‐‐")} -->
      <article class="sol" id="{esc(iid)}" data-reveal{delay}>
        <div class="sol__photo"><picture>{source}<img decoding="async" src="assets/img/{esc(img)}" alt="{esc(it["alt"])}" width="{int(w)}" height="{int(h)}" loading="lazy"></picture></div>
        <div class="sol__head">
          <h3 class="sol__title">{title_html(title)}{small}</h3>
        </div>
        <div class="sol__body">{paragraphs(it["body"])}</div>
        <div class="sol__tags">{tags}</div>
        <div class="sol__foot"><a href="{esc(href)}" class="sol__link" aria-label="{esc(aria)} について相談する">この案件を相談する <span class="arrow" aria-hidden="true">→</span></a></div>
      </article>
"""


def render(data, raw):
    visible = [it for it in data["items"] if it.get("visible", True) is not False]
    rev = hashlib.sha256(raw).hexdigest()[:12]
    body = "".join(card(it, n) for n, it in enumerate(visible))
    block = (f'{START}{MARK_NOTE} -->\n'
             f'    <div class="solutions section-body" data-rev="{rev}">\n'
             f'{body}\n'
             f'    </div>\n'
             f'    {END}')
    return block, len(visible), rev


def replace_block(src, block):
    i, j = src.find(START), src.find(END)
    if i < 0 or j < 0 or j < i:
        die("solutions.html に <!-- solutions:start --> と <!-- solutions:end --> の目印が見つかりません。")
    return src[:i] + block + src[j + len(END):]


def replace_counts(src, count):
    pat = re.compile(r'(<(\w+)\b[^>]*\bdata-sol-count\b[^>]*>)\d+(</\2>)')
    return pat.sub(lambda m: f"{m.group(1)}{count}{m.group(3)}", src)


def typeset_pages(texts):
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    sys.dont_write_bytecode = True   # tools/__pycache__ を作らない
    import typeset  # noqa: E402  同じ規則で <wbr> と継ぎ目を入れる
    name, split = typeset.get_parser()
    if name != "budoux":
        # 簡易ルールで組むと、自動生成部分の外の見出しまで改行位置が崩れる。書き出さずに止める
        die("budoux がないため、見出しの改行位置を正しく決められません。\n"
            "    pip install budoux を実行してから、もう一度実行してください。")
    return {k: typeset.typeset(v, split) for k, v in texts.items()}


def orphan_images(data):
    used = {clean(it.get("image")) for it in data["items"]}
    out = []
    for f in sorted(os.listdir(IMG)):
        base, ext = os.path.splitext(f)
        jpg = base + ".jpg"
        if ADMIN_IMAGE_RE.match(jpg) and jpg not in used and ext in (".jpg", ".webp"):
            out.append(f)
    return out


def build(check=False):
    global DRY_RUN
    DRY_RUN = check
    data, raw = load()
    validate(data)
    block, count, rev = render(data, raw)
    page = open(PAGE, encoding="utf-8").read()
    index = open(INDEX, encoding="utf-8").read()
    out = typeset_pages({"page": replace_block(page, block), "index": replace_counts(index, count)})
    changed = [p for p, a, b in ((PAGE, page, out["page"]), (INDEX, index, out["index"])) if a != b]
    print(f"  公開中の案件 {count} 件（版 {rev}）")
    if check:
        for p in changed:
            print(f"  差分あり: {os.path.relpath(p, ROOT)}")
        for f in orphan_images(data):
            print(f"  使われていない画像: assets/img/{f}")
        sys.exit(1 if changed or orphan_images(data) else 0)
    for p, text in ((PAGE, out["page"]), (INDEX, out["index"])):
        if p in changed:
            open(p, "w", encoding="utf-8").write(text)
            print(f"  書き出し: {os.path.relpath(p, ROOT)}")
    for f in orphan_images(data):
        os.remove(os.path.join(IMG, f))
        print(f"  使われなくなった画像を削除: assets/img/{f}")
    if not changed:
        print("  ページの変更はありません。")


# ---------------------------------------------------------------------
#  初回だけ：いまの solutions.html から JSON を作る
# ---------------------------------------------------------------------
def text_of(fragment):
    s = re.sub(r"<wbr\s*/?>", "", fragment)
    s = re.sub(r"<[^>]+>", "", s)
    return clean(html.unescape(s))


def import_from_html(force=False):
    if os.path.exists(DATA) and not force:
        die("data/solutions.json はすでにあります（上書きするときは --import --force）。")
    src = open(PAGE, encoding="utf-8").read()
    items = []
    for m in re.finditer(r'<article class="sol" id="([^"]+)"[^>]*>(.*?)</article>', src, re.S):
        iid, inner = m.group(1), m.group(2)
        img = re.search(r'<img[^>]*src="assets/img/([^"]+)"', inner).group(1)
        alt = html.unescape(re.search(r'<img[^>]*alt="([^"]*)"', inner).group(1))
        th = re.search(r'<h3 class="sol__title">(.*?)</h3>', inner, re.S).group(1)
        label = re.search(r"<small[^>]*>(.*?)</small>", th, re.S)
        title = text_of(re.sub(r"<small.*?</small>", "", th, flags=re.S))
        body = "\n\n".join(text_of(p) for p in re.findall(r"<p>(.*?)</p>", inner, re.S))
        tags = []
        for cls, txt in re.findall(r'<span class="([^"]*\btag\b[^"]*)">(.*?)</span>', inner, re.S):
            color = "gold" if "tag--gold" in cls else "coral" if "tag--coral" in cls else ""
            tags.append({"text": text_of(txt), "color": color})
        href = re.search(r'href="contact\.html\?topic=([^"]+)"', inner)
        topic = urllib.parse.unquote(html.unescape(href.group(1))) if href else ""
        items.append({"id": iid, "visible": True, "title": title,
                      "label": text_of(label.group(1)) if label else "",
                      "image": img, "alt": clean(alt), "body": body, "tags": tags,
                      "topic": clean(topic)})
    if not items:
        die("solutions.html から案件を読み取れませんでした。")
    data = {"schema": "chijoukai-solutions/1",
            "note": "法人の方へ「取り扱っている案件」の一覧。管理画面（/admin/）から編集します。"
                    "並び順がそのまま表示順です。visible: false は非公開（サイトには出ません）。",
            "items": items}
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"  {len(items)} 件を data/solutions.json に書き出しました。")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--import" in args:
        import_from_html(force="--force" in args)
    else:
        build(check="--check" in args)
