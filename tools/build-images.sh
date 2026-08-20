#!/usr/bin/env bash
# =====================================================================
#  知上会 — 画像ビルド
#  assets/img/ の JPEG / PNG から WebP を生成します。
#  写真を差し替えたら、このスクリプトを一度実行してください。
#
#    bash tools/build-images.sh
#
#  必要なもの: cwebp（brew install webp）／ macOS 標準の sips
#  HTML は <picture> で「WebP → 元のJPEG」の順に指定しているので、
#  WebP が無い・対応していない環境でも表示は崩れません。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
IMG=assets/img

command -v cwebp >/dev/null || { echo "cwebp がありません: brew install webp"; exit 1; }

# 用途ごとの最大幅（これより大きい画像は縮めてから WebP にする）
#   sol-*      … 案件カードの写真帯（表示幅 約370px → 2倍で740px）
#   その他     … 全幅の背景・メディアカード
max_width_for() {
  case "$1" in
    sol-*)      echo 800 ;;
    hero-ocean) echo 1800 ;;
    *)          echo 1400 ;;
  esac
}

# 画質。sea-reef は下層ページの見出し背景にしか使っておらず、
# CSS で不透明度10%まで落として敷いている（.page-hero .photo-bg img）。
# 素の画質を保つ意味がないので、思い切って落とす。
quality_for() {
  case "$1" in
    sea-reef) echo 40 ;;
    *)        echo 78 ;;
  esac
}

made=0
for src in "$IMG"/*.jpg; do
  [ -e "$src" ] || continue
  name=$(basename "$src" .jpg)
  # OGP画像は SNS 用の完成品。WebP は不要（対応していない配信先がある）
  [ "$name" = "ogp" ] && continue
  out="$IMG/$name.webp"
  # 元画像より新しい WebP があれば作り直さない
  if [ -f "$out" ] && [ "$out" -nt "$src" ]; then continue; fi

  w=$(sips -g pixelWidth "$src" | awk -F': ' '/pixelWidth/{print $2}')
  cap=$(max_width_for "$name")
  if [ "$w" -gt "$cap" ]; then
    tmp=$(mktemp -t chijoukai).jpg
    sips -s format jpeg -Z "$cap" "$src" --out "$tmp" >/dev/null
    cwebp -quiet -q "$(quality_for "$name")" -m 6 -sharp_yuv "$tmp" -o "$out"
    rm -f "$tmp"
  else
    cwebp -quiet -q "$(quality_for "$name")" -m 6 -sharp_yuv "$src" -o "$out"
  fi
  made=$((made+1))
  printf '  %-24s %7s → %7s\n' "$name" "$(du -h "$src" | cut -f1)" "$(du -h "$out" | cut -f1)"
done

# ロゴ（透過PNG）は可逆で。文字のエッジを崩さない
for src in "$IMG"/logo-full.png; do
  [ -e "$src" ] || continue
  out="${src%.png}.webp"
  if [ -f "$out" ] && [ "$out" -nt "$src" ]; then continue; fi
  cwebp -quiet -lossless -m 6 "$src" -o "$out"
  made=$((made+1))
  printf '  %-24s %7s → %7s\n' "$(basename "${src%.png}")" "$(du -h "$src" | cut -f1)" "$(du -h "$out" | cut -f1)"
done

echo "WebP を ${made} 件生成しました。"
