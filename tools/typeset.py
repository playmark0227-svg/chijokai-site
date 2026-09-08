#!/usr/bin/env python3
# =====================================================================
#  知上会 — 日本語の折り返し位置を整える
#
#    python3 tools/typeset.py            … 全ページに適用
#    python3 tools/typeset.py --check    … 差分が出るかだけ見る（書き換えない）
#
#  なぜ必要か
#  ----------
#  CSS の word-break: auto-phrase は文節で折り返してくれるが、
#  対応しているのは Chrome 系だけで Safari では効かない。効かない環境では
#  「しないことをお伝えす／るのが大切だと」のように語の途中で改行される。
#
#  そこで、文節の切れ目を HTML 側に <wbr> として持たせ、
#  CSS 側は word-break: keep-all で「<wbr> のあるところだけで折る」ようにする。
#  これならブラウザに関係なく、どの画面幅でも文節で折り返る。
#
#  文節の判定には budoux（Google 製の日本語分割器）を使う。
#  導入していない場合は、助詞・句読点をもとにした簡易ルールに切り替わる。
#
#  原稿を書き換えたら、このスクリプトを実行し直すこと。
#  すでに入っている <wbr> は毎回いったん消してから入れ直すので、
#  何度実行しても結果は同じになる。
# =====================================================================
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["index.html", "story.html", "service.html", "solutions.html",
         "contact.html", "privacy.html", "404.html"]

# 中身を組版してはいけない要素
SKIP_TAGS = {"script", "style", "pre", "code", "textarea", "title"}

JP = re.compile(r"[ぁ-んァ-ヶ一-龥々〆ヵヶ]")
ENTITY = re.compile(r"&[a-zA-Z#][a-zA-Z0-9]*;")
PUA = 0xE000  # エンティティの一時退避に使う私用領域


def get_parser():
    """budoux があればそれを、無ければ簡易ルールを返す"""
    try:
        import budoux
        p = budoux.load_default_japanese_parser()
        return ("budoux", lambda s: p.parse(s))
    except Exception:
        return ("簡易ルール", simple_split)


def simple_split(s):
    """budoux が無いときの代替。助詞・句読点の後ろで切る。

    文節の精度は budoux に劣るが、「お伝えす／る」のような
    語中での分割は避けられる。
    """
    out, cur = [], ""
    joshi = "はがをにへとでもやかねよなのså"
    for i, ch in enumerate(s):
        cur += ch
        nxt = s[i + 1] if i + 1 < len(s) else ""
        if ch in "、。！？":
            out.append(cur); cur = ""
        elif ch in joshi and nxt and not re.match(r"[、。！？」』）]", nxt) and len(cur) > 1:
            out.append(cur); cur = ""
    if cur:
        out.append(cur)
    return out or [s]


# 1文字に対応する実体参照は、いったん実際の文字に直してから分割器に渡す。
# 置き換えずに伏せ字にすると、分割器が前後の文脈を読めず
# 「数々の“偽物”でした。」のような箇所がひと続きになってしまう。
CHAR_ENTITIES = {
    "&ldquo;": "\u201c", "&rdquo;": "\u201d",
    "&lsquo;": "\u2018", "&rsquo;": "\u2019",
    "&mdash;": "\u2014", "&ndash;": "\u2013",
    "&hellip;": "\u2026", "&nbsp;": "\u00a0",
    "&middot;": "\u00b7", "&times;": "\u00d7",
}
ENTITY_BACK = {v: k for k, v in CHAR_ENTITIES.items()}


def protect_entities(text):
    """分割器に渡せる形に整える。

    1文字ぶんの実体参照は実際の文字へ。
    それ以外（&amp; など）は伏せ字にして、分割で壊れないようにする。
    """
    for ent, ch in CHAR_ENTITIES.items():
        text = text.replace(ent, ch)
    store = []

    def sub(m):
        store.append(m.group(0))
        return chr(PUA + len(store) - 1)

    return ENTITY.sub(sub, text), store


def restore_entities(text, store, original):
    """伏せ字を元に戻す。

    分割器に見せるために実際の文字へ直したものは、
    元の原稿がその書き方をしていた場合だけ実体参照に戻す。
    もともと「——」と直接書かれていた箇所を勝手に &mdash; へ
    書き換えてしまわないようにするため。
    """
    for i, ent in enumerate(store):
        text = text.replace(chr(PUA + i), ent)
    for ch, ent in ENTITY_BACK.items():
        if ent in original:
            text = text.replace(ch, ent)
    return text


# ダッシュや三点リーダは和文の約物として扱われないことがあり、
# word-break: keep-all でも直前で改行されてしまう。
# 改行を禁じるゼロ幅文字（WORD JOINER）を手前に置いて、行頭に落ちないようにする。
WORD_JOINER = "\u2060"
GLUE_BEFORE = "\u2014\u2013\u2015\u2026\u301c\uff5e\uff0f/\uff5c|\u30fb"


# Wi-Fi / ISS-4 のように、英数字をハイフンでつないだ語は
# ハイフンのところで改行されないよう、前後を綴じる。
HYPHENATED = re.compile(r"(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])")


def glue(text):
    out = []
    for i, ch in enumerate(text):
        if ch in GLUE_BEFORE and (not out or out[-1] not in (WORD_JOINER,)) \
           and i > 0 and text[i - 1] not in GLUE_BEFORE:
            out.append(WORD_JOINER)
        out.append(ch)
    joined = "".join(out)
    return HYPHENATED.sub(WORD_JOINER + "-" + WORD_JOINER, joined)


def insert_wbr(text, split):
    """テキストノードひとつぶんに <wbr> を差し込む"""
    lead = re.match(r"^\s*", text).group(0)
    trail = re.search(r"\s*$", text).group(0)
    core = text[len(lead):len(text) - len(trail)] if trail else text[len(lead):]
    if not core or not JP.search(core):
        return text

    safe, store = protect_entities(core)
    chunks = keep_together(refine([c for c in split(safe) if c]))
    if len(chunks) < 2:
        return text
    # 実体参照に戻す前（実際の文字の状態）で、改行を禁じたい位置に印を入れる
    return lead + restore_entities(glue("<wbr>".join(chunks)), store, core) + trail


# 句読点・閉じ括弧の直後は、日本語組版ではいつ折り返しても不自然にならない。
# 分割器がまれに長いひと続きを返すので、ここで必ず切れるようにしておく。
BREAK_AFTER = "、。！？」』）】〕》〉—―〜：；・／/｜|＝\u201d\u2019\u2026"


# 行の先頭に来てはいけない文字（行頭禁則）。
# ここが次に来る位置では折り返さない。
NO_LINE_START = (
    "、。，．！？」』）】〕》〉"
    "ー―—–〜：；・／/｜|"
    "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"
    "\u201d\u2019\u2026"
)


# 分割器がまれに語の途中で切ってしまう語。ここに挙げたものは切らない。
# 原稿を書き足して不自然な改行を見つけたら、ここに足す。
KEEP_TOGETHER = [
    # 分割器が語の途中で切ってしまうもの
    "一生涯", "流行った", "一人ひとり",
    # 固有名詞
    "知上会", "堀之内",
    # ひとまとまりで読ませたい言い回し
    "資産形成", "金融教育", "投資信託", "伴走サポート",
    "価格変動", "関係法令", "法人向け", "全国規模", "初期費用",
]


def keep_together(chunks):
    """保護したい語の内側にある切れ目を取り消す"""
    s = "".join(chunks)
    cuts, at = set(), 0
    for c in chunks[:-1]:
        at += len(c)
        cuts.add(at)
    for w in KEEP_TOGETHER:
        i = s.find(w)
        while i >= 0:
            for k in range(i + 1, i + len(w)):
                cuts.discard(k)
            i = s.find(w, i + 1)
    out, prev = [], 0
    for c in sorted(cuts):
        out.append(s[prev:c])
        prev = c
    out.append(s[prev:])
    return [c for c in out if c]


def refine(chunks):
    """句読点・閉じ括弧の後ろでも折り返せるようにし、
    行頭に来てはいけない文字の前では折り返さないようにする。"""
    out = []
    for c in chunks:
        buf = ""
        for i, ch in enumerate(c):
            buf += ch
            nxt = c[i + 1] if i + 1 < len(c) else ""
            # 記号が続くうちは切らない（「）。」や「——」をばらさない）
            if ch in BREAK_AFTER and nxt and nxt not in BREAK_AFTER and nxt != ch:
                out.append(buf)
                buf = ""
        if buf:
            out.append(buf)

    # 次の塊が禁則文字で始まるなら、その手前では折り返せない。手前の塊とつなぐ。
    merged = []
    for c in out:
        if merged and c and c[0] in NO_LINE_START:
            merged[-1] += c
        # 空白そのものが折り返しの機会なので、隣に印を置く必要はない
        elif merged and (c[:1].isspace() or merged[-1][-1:].isspace()):
            merged[-1] += c
        else:
            merged.append(c)
    return merged


def typeset(html, split):
    """HTML のテキストノードだけを処理する（タグ・属性・コメントは触らない）"""
    html = html.replace("<wbr>", "").replace("<wbr/>", "").replace("<wbr />", "")
    html = html.replace(WORD_JOINER, "")
    out = []
    skip = None
    for m in re.finditer(r"<!--.*?-->|<[^>]*>|[^<]+", html, re.S):
        seg = m.group(0)
        if seg.startswith("<!--"):
            out.append(seg)
            continue
        if seg.startswith("<"):
            tm = re.match(r"</?\s*([a-zA-Z0-9]+)", seg)
            if tm:
                tag = tm.group(1).lower()
                if seg.startswith("</"):
                    if skip == tag:
                        skip = None
                elif skip is None and tag in SKIP_TAGS and not seg.rstrip().endswith("/>"):
                    skip = tag
            out.append(seg)
            continue
        out.append(seg if skip else insert_wbr(seg, split))
    return "".join(out)


def main():
    check = "--check" in sys.argv
    name, split = get_parser()
    print(f"  文節の判定: {name}")
    changed = 0
    for page in PAGES:
        path = os.path.join(ROOT, page)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            src = f.read()
        dst = typeset(src, split)
        n = dst.count("<wbr>")
        if src != dst:
            changed += 1
            if not check:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(dst)
        mark = "変更あり" if src != dst else "変更なし"
        print(f"  {page:<16} {mark}  折り返し候補 {n} 箇所")
    if check:
        print(f"\n  （--check のため書き換えていません。{changed} ファイルに差分）")
    else:
        print(f"\n  {changed} ファイルを更新しました。")


if __name__ == "__main__":
    main()
