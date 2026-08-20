#!/usr/bin/env bash
# =====================================================================
#  知上会 — CSS / JS のキャッシュ対策
#  style.css と main.js の中身からハッシュを作り、
#  各HTMLの読み込みURLに ?v=… として書き込みます。
#
#    bash tools/stamp-assets.sh
#
#  中身が変われば数字も変わるので、更新後に先方のブラウザが
#  古いデザインを表示したままになるのを防げます。
#  ※ CSS か JS を直したら、公開（push）する前に一度実行してください。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

css_v=$(shasum -a 256 assets/css/style.css | cut -c1-8)
js_v=$(shasum -a 256 assets/js/main.js   | cut -c1-8)

for f in *.html; do
  perl -0pi -e "s{href=\"assets/css/style\.css(\?v=[0-9a-f]+)?\"}{href=\"assets/css/style.css?v=$css_v\"}g" "$f"
  perl -0pi -e "s{src=\"assets/js/main\.js(\?v=[0-9a-f]+)?\"}{src=\"assets/js/main.js?v=$js_v\"}g" "$f"
done

echo "style.css?v=$css_v / main.js?v=$js_v を全ページに反映しました"
