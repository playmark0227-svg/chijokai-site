#!/usr/bin/env bash
# =====================================================================
#  知上会 — CSS / JS のキャッシュ対策
#  style.css と main.js（管理画面は admin.css と admin.js）の中身からハッシュを作り、
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
  perl -0pi -e "s{href=\"((?:/chijokai-site/)?)assets/css/style\.css(\?v=[0-9a-f]+)?\"}{href=\"\${1}assets/css/style.css?v=$css_v\"}g" "$f"
  perl -0pi -e "s{src=\"((?:/chijokai-site/)?)assets/js/main\.js(\?v=[0-9a-f]+)?\"}{src=\"\${1}assets/js/main.js?v=$js_v\"}g" "$f"
done

# 管理画面（admin/）の CSS / JS も同じようにする
admin_css_v=$(shasum -a 256 admin/admin.css | cut -c1-8)
admin_js_v=$(shasum -a 256 admin/admin.js  | cut -c1-8)
perl -0pi -e "s{href=\"admin\.css(\?v=[0-9a-f]+)?\"}{href=\"admin.css?v=$admin_css_v\"}g" admin/index.html
perl -0pi -e "s{src=\"admin\.js(\?v=[0-9a-f]+)?\"}{src=\"admin.js?v=$admin_js_v\"}g" admin/index.html

echo "style.css?v=$css_v / main.js?v=$js_v を全ページに、admin.css?v=$admin_css_v / admin.js?v=$admin_js_v を管理画面に反映しました"
